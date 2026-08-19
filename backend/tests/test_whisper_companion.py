import asyncio
import hashlib
import json
import sys
import zipfile
from pathlib import Path

import pytest

# Import the shared API fixture first so module-level runtime paths are redirected
# away from the user's application data before app.db is initialized.
from tests import api_test_support  # noqa: F401
from app import whisper_companion
from app.services import whisper_component_service as service


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_companion_protocol_passes_model_cache(monkeypatch, tmp_path):
    audio_path = tmp_path / "sample.mp3"
    audio_path.write_bytes(b"audio")
    captured = {}

    def fake_transcribe_audio(**kwargs):
        captured.update(kwargs)
        return {
            "language": "zh",
            "model_name": kwargs["model_name"],
            "full_text": "测试",
            "segments": [],
        }

    monkeypatch.setattr(whisper_companion, "transcribe_audio", fake_transcribe_audio)
    response = whisper_companion.handle_request(
        {
            "protocol_version": 1,
            "action": "transcribe",
            "file_path": str(audio_path),
            "model_name": "small",
            "device": "cpu",
            "compute_type": "int8",
            "beam_size": 5,
            "model_cache_dir": str(tmp_path / "models"),
        }
    )

    assert response["ok"] is True
    assert response["result"]["full_text"] == "测试"
    assert captured["download_root"] == str(tmp_path / "models")


def test_install_archive_verifies_and_activates_component(monkeypatch, tmp_path):
    component_root = tmp_path / "components" / "whisper"
    monkeypatch.setattr(service, "WHISPER_COMPONENT_DIR", component_root)
    monkeypatch.setattr(service, "APP_VERSION", "1.2.3")
    monkeypatch.setattr(service, "whisper_target_triple", lambda: "test-target")
    monkeypatch.setattr(service, "_executable_name", lambda: "audux-whisper")

    executable = tmp_path / "audux-whisper"
    executable.write_bytes(b"verified companion")
    archive = tmp_path / "component.zip"
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.write(executable, executable.name)

    service._install_from_archive(
        archive,
        {
            "archive_sha256": _digest(archive),
            "executable_name": executable.name,
            "executable_sha256": _digest(executable),
        },
    )

    installed = component_root / "1.2.3" / "test-target" / executable.name
    metadata = json.loads(installed.with_name("component.json").read_text("utf-8"))
    assert installed.read_bytes() == b"verified companion"
    assert metadata["app_version"] == "1.2.3"
    assert metadata["target"] == "test-target"
    assert metadata["installed_at"]


def test_install_archive_rejects_checksum_mismatch(monkeypatch, tmp_path):
    monkeypatch.setattr(service, "WHISPER_COMPONENT_DIR", tmp_path / "components")
    monkeypatch.setattr(service, "APP_VERSION", "1.2.3")
    monkeypatch.setattr(service, "whisper_target_triple", lambda: "test-target")
    monkeypatch.setattr(service, "_executable_name", lambda: "audux-whisper")
    archive = tmp_path / "component.zip"
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr("audux-whisper", b"payload")

    with pytest.raises(ValueError, match="checksum"):
        service._install_from_archive(
            archive,
            {
                "archive_sha256": "0" * 64,
                "executable_name": "audux-whisper",
                "executable_sha256": "0" * 64,
            },
        )


def test_companion_subprocess_result_and_request(monkeypatch, tmp_path):
    request_path = tmp_path / "request.json"
    script = tmp_path / "fake_companion.py"
    script.write_text(
        "import json, pathlib, sys\n"
        "request = json.loads(sys.stdin.buffer.read())\n"
        f"pathlib.Path({str(request_path)!r}).write_text(json.dumps(request))\n"
        "print(json.dumps({'protocol_version': 1, 'ok': True, 'result': "
        "{'language': 'zh', 'model_name': request['model_name'], "
        "'full_text': 'done', 'segments': []}}))\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(
        service,
        "resolve_whisper_companion_command",
        lambda: [sys.executable, str(script)],
    )
    monkeypatch.setattr(service, "WHISPER_MODEL_CACHE_DIR", tmp_path / "models")

    result = asyncio.run(
        service.transcribe_with_whisper_companion(
            file_path=str(tmp_path / "audio.mp3"),
            model_name="small",
            device="cpu",
            compute_type="int8",
            beam_size=5,
            is_canceled=lambda: False,
        )
    )

    request = json.loads(request_path.read_text("utf-8"))
    assert result["full_text"] == "done"
    assert request["protocol_version"] == 1
    assert request["model_cache_dir"] == str((tmp_path / "models").resolve())


def test_companion_subprocess_is_terminated_on_task_cancel(monkeypatch, tmp_path):
    script = tmp_path / "slow_companion.py"
    script.write_text(
        "import sys, time\n"
        "sys.stdin.buffer.read()\n"
        "time.sleep(30)\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(
        service,
        "resolve_whisper_companion_command",
        lambda: [sys.executable, str(script)],
    )
    monkeypatch.setattr(service, "WHISPER_MODEL_CACHE_DIR", tmp_path / "models")

    with pytest.raises(service.WhisperCompanionCanceled):
        asyncio.run(
            service.transcribe_with_whisper_companion(
                file_path=str(tmp_path / "audio.mp3"),
                model_name="small",
                device="cpu",
                compute_type="int8",
                beam_size=5,
                is_canceled=lambda: True,
            )
        )
