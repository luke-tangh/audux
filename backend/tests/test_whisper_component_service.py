import asyncio
import hashlib
import json
import zipfile
from pathlib import Path

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

# Import the shared API fixture first so application data paths are redirected
# before app.db (and therefore the component directories) is initialized.
from tests import api_test_support  # noqa: F401
from app.services import whisper_component_service as service


def _signed_manifest_client(
    manifest: dict,
    private_key: Ed25519PrivateKey,
    *,
    tamper_signature: bool = False,
) -> httpx.Client:
    manifest_bytes = json.dumps(manifest).encode("utf-8")
    signature = private_key.sign(manifest_bytes)
    if tamper_signature:
        signature = bytes([signature[0] ^ 1]) + signature[1:]

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith(".sig"):
            import base64

            return httpx.Response(
                200,
                content=base64.b64encode(signature),
                request=request,
            )
        return httpx.Response(200, content=manifest_bytes, request=request)

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_manifest_url_defaults_to_audux_release(monkeypatch):
    monkeypatch.delenv(service.WHISPER_MANIFEST_URL_ENV, raising=False)
    monkeypatch.setattr(service, "APP_VERSION", "1.2.3")

    assert service._manifest_url() == (
        "https://github.com/luke-tangh/audux/releases/download/"
        "v1.2.3/whisper-components.json"
    )


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
    private_key = Ed25519PrivateKey.generate()
    client = _signed_manifest_client(manifest, private_key)

    entry, asset_url = service._read_manifest(
        client,
        "https://downloads.example/releases/manifest.json",
        private_key.public_key(),
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
    private_key = Ed25519PrivateKey.generate()
    client = _signed_manifest_client(manifest, private_key)

    with pytest.raises(ValueError, match="asset name"):
        service._read_manifest(
            client,
            "https://downloads.example/manifest.json",
            private_key.public_key(),
        )
    client.close()


def test_read_manifest_rejects_invalid_signature(monkeypatch):
    monkeypatch.setattr(service, "APP_VERSION", "1.2.3")
    monkeypatch.setattr(service, "whisper_target_triple", lambda: "test-target")
    manifest = {
        "schema_version": 1,
        "app_version": "1.2.3",
        "components": {"test-target": {"asset_name": "component.zip"}},
    }
    private_key = Ed25519PrivateKey.generate()
    client = _signed_manifest_client(manifest, private_key, tamper_signature=True)

    with pytest.raises(ValueError, match="signature verification failed"):
        service._read_manifest(
            client,
            "https://downloads.example/manifest.json",
            private_key.public_key(),
        )
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
        "executable_sha256": hashlib.sha256(executable.read_bytes()).hexdigest(),
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

    metadata_path.write_text(json.dumps(valid_metadata), encoding="utf-8")
    executable.write_bytes(b"tampered")
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
                "executable_size": len(executable_bytes),
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


class _HangingProcess:
    def __init__(self):
        self.returncode = None
        self.terminated = False
        self.killed = False
        self.finished = asyncio.Event()

    async def communicate(self, request: bytes):
        assert json.loads(request)["action"] == "transcribe"
        await self.finished.wait()
        return b"", b""

    def terminate(self):
        self.terminated = True
        self.returncode = -15
        self.finished.set()

    def kill(self):
        self.killed = True
        self.returncode = -9
        self.finished.set()


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


def test_transcribe_cancellation_terminates_companion(monkeypatch, tmp_path):
    process = _HangingProcess()

    async def create_process(*args, **kwargs):
        return process

    async def cancel_transcription():
        task = asyncio.create_task(_transcribe())
        await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    monkeypatch.setattr(service, "resolve_whisper_companion_command", lambda: ["companion"])
    monkeypatch.setattr(service, "WHISPER_MODEL_CACHE_DIR", tmp_path / "models")
    monkeypatch.setattr(asyncio, "create_subprocess_exec", create_process)

    asyncio.run(cancel_transcription())
    assert process.terminated is True
    assert process.killed is False
