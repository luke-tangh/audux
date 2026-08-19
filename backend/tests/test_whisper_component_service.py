import asyncio
import hashlib
import json
import zipfile
from pathlib import Path

import httpx
import pytest

# Import the shared API fixture first so application data paths are redirected
# before app.db (and therefore the component directories) is initialized.
from tests import api_test_support  # noqa: F401
from app.services import whisper_component_service as service


@pytest.mark.parametrize(
    "url",
    [
        "https://downloads.example/component.zip",
        "http://localhost/component.zip",
        "http://127.0.0.1/component.zip",
        "http://[::1]/component.zip",
    ],
)
def test_validate_download_url_accepts_https_and_loopback_http(url):
    assert service._validate_download_url(url) == url


@pytest.mark.parametrize(
    "url",
    [
        "http://downloads.example/component.zip",
        "ftp://downloads.example/component.zip",
        "https:///component.zip",
        "https://user@example.com/component.zip",
        "https://downloads.example/component.zip#fragment",
    ],
)
def test_validate_download_url_rejects_unsafe_urls(url):
    with pytest.raises(ValueError):
        service._validate_download_url(url)


def test_read_manifest_selects_target_and_quotes_asset_name(monkeypatch):
    monkeypatch.setattr(service, "APP_VERSION", "1.2.3")
    monkeypatch.setattr(service, "whisper_target_triple", lambda: "test-target")
    manifest = {
        "schema_version": 1,
        "app_version": "1.2.3",
        "components": {
            "test-target": {
                "asset_name": "whisper component.zip",
                "archive_size": 123,
            }
        },
    }
    client = httpx.Client(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(200, json=manifest, request=request)
        )
    )

    entry, asset_url = service._read_manifest(
        client,
        "https://downloads.example/releases/manifest.json",
    )

    assert entry == manifest["components"]["test-target"]
    assert asset_url == "https://downloads.example/releases/whisper%20component.zip"
    client.close()


@pytest.mark.parametrize("asset_name", ["", "../component.zip", "nested/component.zip"])
def test_read_manifest_rejects_invalid_asset_names(monkeypatch, asset_name):
    monkeypatch.setattr(service, "APP_VERSION", "1.2.3")
    monkeypatch.setattr(service, "whisper_target_triple", lambda: "test-target")
    manifest = {
        "schema_version": 1,
        "app_version": "1.2.3",
        "components": {"test-target": {"asset_name": asset_name}},
    }
    client = httpx.Client(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(200, json=manifest, request=request)
        )
    )

    with pytest.raises(ValueError, match="asset name"):
        service._read_manifest(client, "https://downloads.example/manifest.json")
    client.close()


def test_installed_executable_requires_matching_metadata(monkeypatch, tmp_path):
    target_dir = tmp_path / "component"
    target_dir.mkdir()
    executable = target_dir / "audux-whisper"
    executable.write_bytes(b"companion")
    metadata_path = target_dir / "component.json"

    monkeypatch.setattr(service, "APP_VERSION", "1.2.3")
    monkeypatch.setattr(service, "whisper_target_triple", lambda: "test-target")
    monkeypatch.setattr(service, "_executable_name", lambda: executable.name)
    monkeypatch.setattr(service, "_metadata_path", lambda: metadata_path)

    valid_metadata = {
        "app_version": "1.2.3",
        "target": "test-target",
        "executable_name": executable.name,
    }
    metadata_path.write_text(json.dumps(valid_metadata), encoding="utf-8")
    assert service._installed_executable() == executable

    for field, invalid_value in (
        ("app_version", "9.9.9"),
        ("target", "other-target"),
        ("executable_name", "other-name"),
    ):
        metadata_path.write_text(
            json.dumps({**valid_metadata, field: invalid_value}),
            encoding="utf-8",
        )
        assert service._installed_executable() is None

    metadata_path.write_text("not json", encoding="utf-8")
    assert service._installed_executable() is None


def test_install_archive_rejects_additional_files(monkeypatch, tmp_path):
    monkeypatch.setattr(service, "WHISPER_COMPONENT_DIR", tmp_path / "components")
    monkeypatch.setattr(service, "APP_VERSION", "1.2.3")
    monkeypatch.setattr(service, "whisper_target_triple", lambda: "test-target")
    monkeypatch.setattr(service, "_executable_name", lambda: "audux-whisper")
    archive = tmp_path / "component.zip"
    executable_bytes = b"verified executable"
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr("audux-whisper", executable_bytes)
        bundle.writestr("unexpected.txt", b"not allowed")

    with pytest.raises(ValueError, match="unexpected contents"):
        service._install_from_archive(
            archive,
            {
                "archive_sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
                "executable_name": "audux-whisper",
                "executable_sha256": hashlib.sha256(executable_bytes).hexdigest(),
            },
        )


class _FakeProcess:
    def __init__(self, stdout: bytes, stderr: bytes = b"", returncode: int = 0):
        self.stdout = stdout
        self.stderr = stderr
        self.returncode = returncode

    async def communicate(self, request: bytes):
        assert json.loads(request)["action"] == "transcribe"
        return self.stdout, self.stderr


def _transcribe():
    return service.transcribe_with_whisper_companion(
        file_path="/library/audio.mp3",
        model_name="small",
        device="cpu",
        compute_type="int8",
        beam_size=5,
        is_canceled=lambda: False,
    )


@pytest.mark.parametrize(
    ("process", "message"),
    [
        (_FakeProcess(b"not json", b"traceback"), "invalid output: traceback"),
        (
            _FakeProcess(json.dumps({"protocol_version": 2, "ok": True}).encode()),
            "protocol mismatch",
        ),
        (
            _FakeProcess(
                json.dumps({"protocol_version": 1, "ok": False, "error": "failed"}).encode(),
                returncode=1,
            ),
            "failed",
        ),
        (
            _FakeProcess(
                json.dumps({"protocol_version": 1, "ok": True, "result": {}}).encode()
            ),
            "invalid transcription result",
        ),
    ],
)
def test_transcribe_rejects_invalid_companion_responses(monkeypatch, tmp_path, process, message):
    async def create_process(*args, **kwargs):
        return process

    monkeypatch.setattr(service, "resolve_whisper_companion_command", lambda: ["companion"])
    monkeypatch.setattr(service, "WHISPER_MODEL_CACHE_DIR", tmp_path / "models")
    monkeypatch.setattr(asyncio, "create_subprocess_exec", create_process)

    with pytest.raises(RuntimeError, match=message):
        asyncio.run(_transcribe())


def test_transcribe_requires_an_available_companion(monkeypatch):
    monkeypatch.setattr(service, "resolve_whisper_companion_command", lambda: None)

    with pytest.raises(RuntimeError, match="not installed"):
        asyncio.run(_transcribe())
