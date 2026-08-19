import asyncio
import contextlib
import hashlib
import importlib.util
import json
import os
import platform
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
from pathlib import Path
from typing import Callable
from urllib.parse import quote, urljoin, urlparse
from zipfile import ZipFile

import httpx
from sqlmodel import Session, select

from ..asr_config import (
    ASR_PROVIDER_FASTER_WHISPER,
    parse_task_input_payload,
    resolve_asr_task_config,
)
from ..db import COMPONENTS_DIR, MODELS_DIR
from ..models import AITask
from ..time_utils import utc_now_iso
from ..version import APP_VERSION
from .common import ServiceError


WHISPER_COMPONENT_ENV = "AUDUX_WHISPER_COMPANION"
WHISPER_MANIFEST_URL_ENV = "AUDUX_WHISPER_MANIFEST_URL"
WHISPER_COMPONENT_DIR = COMPONENTS_DIR / "whisper"
WHISPER_MODEL_CACHE_DIR = MODELS_DIR / "faster-whisper"
WHISPER_PROTOCOL_VERSION = 1
MAX_MANIFEST_BYTES = 1024 * 1024
MAX_COMPONENT_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024
ACTIVE_TASK_STATUSES = {"pending", "running", "cancel_requested"}


class WhisperCompanionCanceled(Exception):
    pass


class _InstallCanceled(Exception):
    pass


_state_lock = threading.RLock()
_cancel_event = threading.Event()
_install_state = {
    "status": "idle",
    "downloaded_bytes": 0,
    "total_bytes": None,
    "error_message": None,
}


def whisper_target_triple() -> str:
    system = platform.system().lower()
    machine = platform.machine().lower()

    if system == "windows":
        return (
            "aarch64-pc-windows-msvc"
            if machine in {"arm64", "aarch64"}
            else "x86_64-pc-windows-msvc"
        )
    if system == "darwin":
        return (
            "aarch64-apple-darwin"
            if machine in {"arm64", "aarch64"}
            else "x86_64-apple-darwin"
        )
    if system == "linux":
        return (
            "aarch64-unknown-linux-gnu"
            if machine in {"arm64", "aarch64"}
            else "x86_64-unknown-linux-gnu"
        )
    raise ServiceError(400, f"Unsupported Whisper component platform: {system} {machine}")


def _executable_name() -> str:
    return "audux-whisper.exe" if os.name == "nt" else "audux-whisper"


def _target_dir() -> Path:
    return WHISPER_COMPONENT_DIR / APP_VERSION / whisper_target_triple()


def _metadata_path() -> Path:
    return _target_dir() / "component.json"


def _installed_executable() -> Path | None:
    metadata_path = _metadata_path()
    if not metadata_path.is_file():
        return None

    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except Exception:
        return None

    if metadata.get("app_version") != APP_VERSION:
        return None
    if metadata.get("target") != whisper_target_triple():
        return None
    if metadata.get("executable_name") != _executable_name():
        return None

    executable = metadata_path.parent / _executable_name()
    return executable if executable.is_file() else None


def _development_command() -> list[str] | None:
    if getattr(sys, "frozen", False):
        return None
    if importlib.util.find_spec("faster_whisper") is None:
        return None
    return [sys.executable, "-m", "app.whisper_companion"]


def resolve_whisper_companion_command() -> list[str] | None:
    configured = os.getenv(WHISPER_COMPONENT_ENV, "").strip()
    if configured:
        path = Path(configured).expanduser()
        return [str(path.resolve())] if path.is_file() else None

    executable = _installed_executable()
    if executable is not None:
        return [str(executable.resolve())]

    return _development_command()


def is_whisper_companion_available() -> bool:
    return resolve_whisper_companion_command() is not None


def _manifest_url() -> str:
    configured = os.getenv(WHISPER_MANIFEST_URL_ENV, "").strip()
    if configured:
        return configured
    return (
        "https://github.com/luke-tangh/audux/releases/download/"
        f"v{APP_VERSION}/whisper-components.json"
    )


def _validate_download_url(value: str) -> str:
    parsed = urlparse(value)
    host = (parsed.hostname or "").lower()
    is_loopback = host in {"localhost", "127.0.0.1", "::1"}

    if parsed.scheme != "https" and not (parsed.scheme == "http" and is_loopback):
        raise ValueError("Whisper component downloads require HTTPS or loopback HTTP")
    if not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise ValueError("Invalid Whisper component download URL")
    return value


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _update_install_state(**changes) -> None:
    with _state_lock:
        _install_state.update(changes)


def _read_manifest(client: httpx.Client, manifest_url: str) -> tuple[dict, str]:
    response = client.get(manifest_url)
    response.raise_for_status()
    if len(response.content) > MAX_MANIFEST_BYTES:
        raise ValueError("Whisper component manifest is too large")

    manifest = response.json()
    if not isinstance(manifest, dict) or manifest.get("schema_version") != 1:
        raise ValueError("Unsupported Whisper component manifest")
    if manifest.get("app_version") != APP_VERSION:
        raise ValueError("Whisper component manifest version does not match the app")

    components = manifest.get("components")
    entry = components.get(whisper_target_triple()) if isinstance(components, dict) else None
    if not isinstance(entry, dict):
        raise ValueError("No Whisper component is available for this platform")

    asset_name = entry.get("asset_name")
    if (
        not isinstance(asset_name, str)
        or not asset_name
        or Path(asset_name).name != asset_name
    ):
        raise ValueError("Invalid Whisper component asset name")

    asset_url = urljoin(manifest_url.rsplit("/", 1)[0] + "/", quote(asset_name))
    return entry, _validate_download_url(asset_url)


def _download_archive(
    client: httpx.Client,
    url: str,
    destination: Path,
    expected_size: int,
) -> None:
    downloaded = 0
    with client.stream("GET", url) as response:
        response.raise_for_status()
        content_length = response.headers.get("content-length")
        total = int(content_length) if content_length and content_length.isdigit() else expected_size
        _update_install_state(total_bytes=total)

        with destination.open("wb") as handle:
            for chunk in response.iter_bytes(1024 * 1024):
                if _cancel_event.is_set():
                    raise _InstallCanceled()
                downloaded += len(chunk)
                if downloaded > MAX_COMPONENT_ARCHIVE_BYTES:
                    raise ValueError("Whisper component archive exceeds the size limit")
                handle.write(chunk)
                _update_install_state(downloaded_bytes=downloaded)

    if downloaded != expected_size:
        raise ValueError("Whisper component archive size does not match the manifest")


def _install_from_archive(archive_path: Path, entry: dict) -> None:
    archive_sha256 = str(entry.get("archive_sha256") or "").lower()
    executable_sha256 = str(entry.get("executable_sha256") or "").lower()
    expected_name = _executable_name()

    if len(archive_sha256) != 64 or _sha256(archive_path) != archive_sha256:
        raise ValueError("Whisper component archive checksum mismatch")
    if entry.get("executable_name") != expected_name or len(executable_sha256) != 64:
        raise ValueError("Whisper component executable metadata is invalid")

    target_dir = _target_dir()
    target_dir.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(
        prefix="whisper-install-",
        dir=target_dir.parent,
    ) as temporary_dir_value:
        staging_dir = Path(temporary_dir_value) / "component"
        staging_dir.mkdir()
        executable = staging_dir / expected_name

        with ZipFile(archive_path) as bundle:
            members = bundle.infolist()
            if len(members) != 1 or members[0].filename != expected_name:
                raise ValueError("Whisper component archive has unexpected contents")
            member_mode = members[0].external_attr >> 16
            if stat.S_ISLNK(member_mode):
                raise ValueError("Whisper component archive must not contain links")
            with bundle.open(members[0]) as source, executable.open("wb") as destination:
                shutil.copyfileobj(source, destination, length=1024 * 1024)

        if _sha256(executable) != executable_sha256:
            raise ValueError("Whisper component executable checksum mismatch")
        if os.name != "nt":
            executable.chmod(executable.stat().st_mode | 0o111)

        metadata = {
            "app_version": APP_VERSION,
            "target": whisper_target_triple(),
            "executable_name": expected_name,
            "executable_sha256": executable_sha256,
            "installed_at": utc_now_iso(),
        }
        (staging_dir / "component.json").write_text(
            json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

        previous_dir = target_dir.with_name(target_dir.name + ".previous")
        if previous_dir.exists():
            shutil.rmtree(previous_dir)
        if target_dir.exists():
            target_dir.replace(previous_dir)

        try:
            staging_dir.replace(target_dir)
        except Exception:
            if previous_dir.exists() and not target_dir.exists():
                previous_dir.replace(target_dir)
            raise
        finally:
            if previous_dir.exists():
                shutil.rmtree(previous_dir)


def _install_worker() -> None:
    try:
        manifest_url = _validate_download_url(_manifest_url())
        with httpx.Client(follow_redirects=True, timeout=60) as client:
            entry, asset_url = _read_manifest(client, manifest_url)
            archive_size = int(entry.get("archive_size") or 0)
            if archive_size <= 0 or archive_size > MAX_COMPONENT_ARCHIVE_BYTES:
                raise ValueError("Whisper component archive size is invalid")

            WHISPER_COMPONENT_DIR.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(
                prefix="whisper-download-",
                dir=WHISPER_COMPONENT_DIR,
            ) as temporary_dir:
                archive_path = Path(temporary_dir) / "component.zip"
                _download_archive(client, asset_url, archive_path, archive_size)
                if _cancel_event.is_set():
                    raise _InstallCanceled()
                _update_install_state(status="installing")
                _install_from_archive(archive_path, entry)

        _update_install_state(status="installed", error_message=None)
    except _InstallCanceled:
        _update_install_state(
            status="not_installed",
            downloaded_bytes=0,
            total_bytes=None,
            error_message=None,
        )
    except Exception as error:
        _update_install_state(status="failed", error_message=str(error))
    finally:
        _cancel_event.clear()


def get_whisper_component_status() -> dict:
    command = resolve_whisper_companion_command()
    with _state_lock:
        install_state = dict(_install_state)

    if install_state["status"] not in {"downloading", "installing", "failed"}:
        install_state["status"] = "installed" if command else "not_installed"

    source = None
    if command:
        source = "development" if _development_command() == command else "component"

    return {
        "status": install_state["status"],
        "available": command is not None,
        "source": source,
        "app_version": APP_VERSION,
        "target": whisper_target_triple(),
        "downloaded_bytes": install_state["downloaded_bytes"],
        "total_bytes": install_state["total_bytes"],
        "error_message": install_state["error_message"],
    }


def start_whisper_component_install() -> dict:
    with _state_lock:
        if _install_state["status"] in {"downloading", "installing"}:
            raise ServiceError(409, "Whisper component installation is already running")
        _cancel_event.clear()
        _install_state.update(
            status="downloading",
            downloaded_bytes=0,
            total_bytes=None,
            error_message=None,
        )

    thread = threading.Thread(
        target=_install_worker,
        name="whisper-component-installer",
        daemon=True,
    )
    thread.start()
    return get_whisper_component_status()


def cancel_whisper_component_install() -> dict:
    with _state_lock:
        if _install_state["status"] not in {"downloading", "installing"}:
            raise ServiceError(409, "Whisper component installation is not running")
        _cancel_event.set()
    return get_whisper_component_status()


def _has_active_local_transcription(session: Session) -> bool:
    tasks = session.exec(
        select(AITask)
        .where(AITask.task_type == "transcribe")
        .where(AITask.status.in_(list(ACTIVE_TASK_STATUSES)))
    ).all()
    for task in tasks:
        try:
            config = resolve_asr_task_config(
                parse_task_input_payload(task.input_payload)
            )
        except ValueError:
            continue
        if config["provider"] == ASR_PROVIDER_FASTER_WHISPER:
            return True
    return False


def remove_whisper_component(session: Session) -> dict:
    with _state_lock:
        if _install_state["status"] in {"downloading", "installing"}:
            raise ServiceError(409, "Cancel the Whisper component installation first")
    if _has_active_local_transcription(session):
        raise ServiceError(409, "Whisper component is in use by an active task")

    target_dir = _target_dir()
    if target_dir.exists():
        shutil.rmtree(target_dir)
    _update_install_state(
        status="not_installed",
        downloaded_bytes=0,
        total_bytes=None,
        error_message=None,
    )
    return get_whisper_component_status()


async def transcribe_with_whisper_companion(
    *,
    file_path: str,
    model_name: str,
    device: str,
    compute_type: str,
    beam_size: int,
    is_canceled: Callable[[], bool],
) -> dict:
    command = resolve_whisper_companion_command()
    if command is None:
        raise RuntimeError(
            "Whisper component is not installed. Install it from Settings > ASR."
        )

    WHISPER_MODEL_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    request = {
        "protocol_version": WHISPER_PROTOCOL_VERSION,
        "action": "transcribe",
        "file_path": file_path,
        "model_name": model_name,
        "device": device,
        "compute_type": compute_type,
        "beam_size": beam_size,
        "model_cache_dir": str(WHISPER_MODEL_CACHE_DIR.resolve()),
    }
    creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    process = await asyncio.create_subprocess_exec(
        *command,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        creationflags=creationflags,
    )
    communication = asyncio.create_task(
        process.communicate(json.dumps(request, ensure_ascii=False).encode("utf-8"))
    )

    canceled = False
    while not communication.done():
        await asyncio.wait({communication}, timeout=0.5)
        if not communication.done() and is_canceled():
            canceled = True
            with contextlib.suppress(ProcessLookupError):
                process.terminate()
            try:
                await asyncio.wait_for(communication, timeout=5)
            except asyncio.TimeoutError:
                with contextlib.suppress(ProcessLookupError):
                    process.kill()
                await communication

    stdout, stderr = await communication
    if canceled:
        raise WhisperCompanionCanceled()

    try:
        response = json.loads(stdout.decode("utf-8"))
    except Exception as error:
        detail = stderr.decode("utf-8", errors="replace")[-4000:]
        raise RuntimeError(
            f"Whisper companion returned invalid output: {detail or 'empty response'}"
        ) from error

    if not isinstance(response, dict) or response.get("protocol_version") != 1:
        raise RuntimeError("Whisper companion protocol mismatch")
    if process.returncode != 0 or not response.get("ok"):
        raise RuntimeError(str(response.get("error") or "Whisper companion failed"))
    result = response.get("result")
    if not isinstance(result, dict) or not isinstance(result.get("full_text"), str):
        raise RuntimeError("Whisper companion returned an invalid transcription result")
    return result
