from __future__ import annotations

import hashlib
import io
import json
import platform
import re
import sqlite3
import sys
import uuid
import zipfile
from pathlib import Path
from typing import Any

from fastapi.responses import FileResponse
from sqlmodel import Session, select

from .. import db
from ..models import (
    AgentCitation,
    AgentConversation,
    AgentMessage,
    AgentOperationAuditEvent,
    AgentOperationItem,
    AgentOperationPlan,
    AgentRun,
    AgentRunStep,
    AgentToolCall,
    AITask,
    AudioItem,
    AudioTag,
    LibraryRoot,
    LibraryHealthTask,
    McpAuditEvent,
    OrganizationAuditEvent,
    OrganizationProposal,
    OrganizationRun,
    OrganizationRunStep,
    OrganizationRunTarget,
    PlaybackEvent,
    Playlist,
    PlaylistItem,
    SavedView,
    ScanTask,
    Setting,
    Tag,
    Transcript,
    TranscriptChapter,
    TranscriptIssue,
    TranscriptSegment,
)
from ..time_utils import utc_now_iso
from ..version import APP_VERSION
from .download_utils import attachment_headers
from .errors import ServiceError
from ..search import rebuild_audio_search_index


ARCHIVE_FORMAT = "audux-archive"
ARCHIVE_FORMAT_VERSION = 1
MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
SAFE_ARCHIVE_ID = re.compile(r"^[A-Za-z0-9._-]+$")
ARCHIVES_DIR = db.EXPORTS_DIR / "archives"
IMPORTS_DIR = db.APP_DATA_DIR / "archive-imports"

TABLE_MODELS = [
    PlaybackEvent,
    Tag,
    AudioTag,
    Playlist,
    PlaylistItem,
    SavedView,
    Transcript,
    TranscriptSegment,
    TranscriptChapter,
    TranscriptIssue,
    AgentConversation,
    AgentMessage,
    AgentRun,
    AgentRunStep,
    AgentToolCall,
    AgentCitation,
    AgentOperationPlan,
    AgentOperationItem,
    AgentOperationAuditEvent,
    McpAuditEvent,
    OrganizationRun,
    OrganizationRunTarget,
    OrganizationRunStep,
    OrganizationProposal,
    OrganizationAuditEvent,
]
MODEL_BY_TABLE = {model.__tablename__: model for model in TABLE_MODELS}


def _json_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _safe_path(root: Path, archive_id: str, suffix: str) -> Path:
    if not SAFE_ARCHIVE_ID.fullmatch(archive_id) or Path(archive_id).name != archive_id:
        raise ServiceError(400, "Invalid archive id", "archive.invalid_id")
    path = (root / f"{archive_id}{suffix}").resolve()
    if path.parent != root.resolve():
        raise ServiceError(400, "Invalid archive id", "archive.invalid_id")
    return path


def _relative_locator(audio: AudioItem, roots: dict[int, LibraryRoot]) -> tuple[str, int | None]:
    root = roots.get(int(audio.library_root_id)) if audio.library_root_id is not None else None
    if root:
        try:
            return Path(audio.file_path).resolve().relative_to(Path(root.path).resolve()).as_posix(), int(root.id)
        except (OSError, ValueError):
            pass
    return audio.file_name, int(root.id) if root and root.id is not None else None


def _export_payload(session: Session) -> dict[str, Any]:
    roots = {int(row.id): row for row in session.exec(select(LibraryRoot).order_by(LibraryRoot.id)).all() if row.id is not None}
    audio_rows = session.exec(select(AudioItem).order_by(AudioItem.id)).all()
    tables: dict[str, list[dict[str, Any]]] = {
        "library_roots": [
            {"id": row.id, "label": Path(row.path).name or f"root-{row.id}", "is_enabled": row.is_enabled, "created_at": row.created_at, "updated_at": row.updated_at}
            for row in roots.values()
        ],
        "audio_items": [],
    }
    for audio in audio_rows:
        locator, root_id = _relative_locator(audio, roots)
        row = audio.model_dump(exclude={"file_path", "cover_path"})
        row.update({"library_root_id": root_id, "relative_locator": locator, "cover_path": None})
        tables["audio_items"].append(row)
    for model in TABLE_MODELS:
        rows = session.exec(select(model)).all()
        values = []
        for row in rows:
            value = row.model_dump()
            if model is AgentToolCall:
                value["output_json"] = None
            values.append(value)
        tables[model.__tablename__] = values
    return {"tables": tables}


def create_archive(session: Session) -> dict[str, Any]:
    payload = _export_payload(session)
    data = _json_bytes(payload)
    manifest = {
        "format": ARCHIVE_FORMAT,
        "format_version": ARCHIVE_FORMAT_VERSION,
        "app_version": APP_VERSION,
        "schema_version": db.CURRENT_SCHEMA_VERSION,
        "created_at": utc_now_iso(),
        "data_sha256": _sha256(data),
        "credentials_included": False,
        "audio_files_included": False,
        "counts": {name: len(rows) for name, rows in payload["tables"].items()},
    }
    archive_id = f"audux-{utc_now_iso().replace(':', '').replace('-', '').replace('.', '')}-{uuid.uuid4().hex[:8]}"
    ARCHIVES_DIR.mkdir(parents=True, exist_ok=True)
    destination = _safe_path(ARCHIVES_DIR, archive_id, ".audux.zip")
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("manifest.json", _json_bytes(manifest))
            archive.writestr("data.json", data)
        temporary.replace(destination)
        try:
            destination.chmod(0o600)
        except OSError:
            pass
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    return {"id": archive_id, "file_name": destination.name, "size_bytes": destination.stat().st_size, "manifest": manifest}


def archive_response(archive_id: str):
    path = _safe_path(ARCHIVES_DIR, archive_id, ".audux.zip")
    if not path.is_file() or path.is_symlink():
        raise ServiceError(404, "Archive not found", "archive.not_found")
    return FileResponse(path, media_type="application/zip", headers=attachment_headers(path.name))


def _read_archive(data: bytes) -> tuple[dict[str, Any], dict[str, Any]]:
    if len(data) > MAX_ARCHIVE_BYTES:
        raise ServiceError(413, "Archive is too large", "archive.too_large")
    try:
        with zipfile.ZipFile(io.BytesIO(data), "r") as archive:
            names = set(archive.namelist())
            if names != {"manifest.json", "data.json"}:
                raise ValueError("unexpected archive members")
            if sum(info.file_size for info in archive.infolist()) > MAX_ARCHIVE_BYTES:
                raise ValueError("expanded archive is too large")
            manifest_bytes = archive.read("manifest.json")
            payload_bytes = archive.read("data.json")
        manifest = json.loads(manifest_bytes)
        payload = json.loads(payload_bytes)
    except (ValueError, KeyError, zipfile.BadZipFile, json.JSONDecodeError) as error:
        raise ServiceError(400, "Archive is invalid", "archive.invalid") from error
    if (
        not isinstance(manifest, dict)
        or manifest.get("format") != ARCHIVE_FORMAT
        or manifest.get("format_version") != ARCHIVE_FORMAT_VERSION
        or manifest.get("schema_version") != db.CURRENT_SCHEMA_VERSION
        or manifest.get("data_sha256") != _sha256(payload_bytes)
        or not isinstance(payload, dict)
        or not isinstance(payload.get("tables"), dict)
    ):
        raise ServiceError(409, "Archive format or schema is incompatible", "archive.incompatible")
    return manifest, payload


def _id_conflicts(session: Session, tables: dict[str, Any]) -> dict[str, int]:
    conflicts: dict[str, int] = {}
    for name, rows in tables.items():
        model = AudioItem if name == "audio_items" else LibraryRoot if name == "library_roots" else MODEL_BY_TABLE.get(name)
        if model is None or not isinstance(rows, list):
            continue
        ids = [row.get("id") for row in rows if isinstance(row, dict) and row.get("id") is not None]
        if ids and session.exec(select(model).where(model.id.in_(ids))).first() is not None:
            conflicts[name] = len(ids)
    return conflicts


def _has_importable_data(session: Session) -> bool:
    models = [AudioItem, LibraryRoot, *TABLE_MODELS]
    return any(session.exec(select(model)).first() is not None for model in models)


def import_dry_run(session: Session, data: bytes) -> dict[str, Any]:
    manifest, payload = _read_archive(data)
    tables = payload["tables"]
    conflicts = _id_conflicts(session, tables)
    current_data = _has_importable_data(session)
    archive_id = f"import-{uuid.uuid4().hex}"
    IMPORTS_DIR.mkdir(parents=True, exist_ok=True)
    destination = _safe_path(IMPORTS_DIR, archive_id, ".audux.zip")
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    temporary.write_bytes(data)
    temporary.replace(destination)
    try:
        destination.chmod(0o600)
    except OSError:
        pass
    fingerprint = _sha256(data)
    return {
        "archive_id": archive_id,
        "fingerprint": fingerprint,
        "compatible": True,
        "schema_version": manifest["schema_version"],
        "counts": manifest.get("counts", {}),
        "missing_audio": len(tables.get("audio_items", [])),
        "id_conflicts": conflicts,
        "merge_strategy": "empty_library_only",
        "can_import": not current_data and not conflicts,
        "blockers": (["current library is not empty"] if current_data else []) + (["id conflicts detected"] if conflicts else []),
    }


def _normalize_import_row(table: str, row: dict[str, Any], archive_id: str) -> dict[str, Any]:
    value = dict(row)
    if table == "library_roots":
        return {
            "id": value["id"],
            "path": f"audux-archive://{archive_id}/root/{value['id']}",
            "is_enabled": False,
            "created_at": value["created_at"],
            "updated_at": value["updated_at"],
        }
    if table == "audio_items":
        locator = str(value.pop("relative_locator", value.get("file_name") or value["id"]))
        value["file_path"] = f"audux-archive://{archive_id}/audio/{value['id']}/{Path(locator).name}"
        value["cover_path"] = None
        value["is_missing"] = True
        value["library_root_id"] = None
    if table in {"agent_runs", "organization_runs"} and value.get("status") in {"pending", "running", "cancel_requested", "awaiting_review"}:
        value["status"] = "failed"
        value["error_message"] = "Imported interrupted run"
        value["error_code"] = "archive.imported_interrupted"
    if table == "agent_operation_plans" and value.get("status") in {"awaiting_approval", "executing"}:
        value["status"] = "canceled"
        value["error_message"] = "Imported approval cannot be replayed"
    return value


def execute_import(session: Session, archive_id: str, fingerprint: str) -> dict[str, Any]:
    path = _safe_path(IMPORTS_DIR, archive_id, ".audux.zip")
    if not path.is_file() or path.is_symlink():
        raise ServiceError(404, "Pending archive import not found", "archive.not_found")
    data = path.read_bytes()
    if _sha256(data) != fingerprint:
        raise ServiceError(409, "Archive changed after dry-run", "archive.fingerprint_mismatch")
    manifest, payload = _read_archive(data)
    tables = payload["tables"]
    if _has_importable_data(session) or _id_conflicts(session, tables):
        raise ServiceError(409, "Archive import requires an empty current library", "archive.import_conflict")
    try:
        root_rows = tables.get("library_roots", [])
        for row in root_rows:
            session.add(LibraryRoot(**_normalize_import_row("library_roots", row, archive_id)))
        for row in tables.get("audio_items", []):
            session.add(AudioItem(**_normalize_import_row("audio_items", row, archive_id)))
        session.flush()
        for model in TABLE_MODELS:
            for row in tables.get(model.__tablename__, []):
                session.add(model(**_normalize_import_row(model.__tablename__, row, archive_id)))
            session.flush()
        for audio_id in session.exec(select(AudioItem.id)).all():
            rebuild_audio_search_index(session, int(audio_id), commit=False)
        session.commit()
    except Exception:
        session.rollback()
        raise
    path.unlink(missing_ok=True)
    return {"ok": True, "schema_version": manifest["schema_version"], "counts": manifest.get("counts", {}), "missing_audio": len(tables.get("audio_items", []))}


def create_diagnostic_bundle(session: Session) -> dict[str, Any]:
    safe_setting_keys = {
        "scanner.hash_strategy",
        "asr.provider",
        "asr.model_name",
        "asr.device",
        "asr.compute_type",
        "llm.model_name",
        "llm.timeout",
        "llm.max_tokens",
    }
    settings = {
        row.key: (
            "<redacted-path>"
            if Path(row.value).is_absolute()
            else row.value
        )
        for row in session.exec(select(Setting).where(Setting.key.in_(safe_setting_keys))).all()
    }
    database_path = session.get_bind().url.database
    integrity = "unavailable"
    if database_path and database_path != ":memory:":
        try:
            with sqlite3.connect(f"file:{Path(database_path).resolve().as_posix()}?mode=ro", uri=True) as connection:
                value = connection.execute("PRAGMA quick_check").fetchone()
                integrity = str(value[0]) if value else "no result"
        except sqlite3.Error:
            integrity = "check failed"
    task_states = {}
    for model in (AITask, ScanTask, LibraryHealthTask, AgentRun, OrganizationRun):
        rows = session.exec(select(model.status)).all()
        counts: dict[str, int] = {}
        for status in rows:
            counts[str(status)] = counts.get(str(status), 0) + 1
        task_states[model.__tablename__] = counts
    diagnostic = {
        "generated_at": utc_now_iso(),
        "app_version": APP_VERSION,
        "schema_version": db.CURRENT_SCHEMA_VERSION,
        "platform": {"system": platform.system(), "release": platform.release(), "machine": platform.machine(), "python": sys.version.split()[0]},
        "settings": settings,
        "database": {"integrity": integrity},
        "state_summary": task_states,
        "resource_policy": {
            "ai_asr_task_workers": 1,
            "agent_run_workers": 1,
            "organization_run_workers": 1,
            "external_asr_chunk_concurrency_max": 4,
            "agent_transcript_characters_max": 24000,
            "organization_transcript_characters_per_target_max": 12000,
            "organization_pause_state": "awaiting_review",
            "shutdown_owner": "tauri_sidecar_or_stdio_eof",
        },
        "privacy": {"transcripts_included": False, "credentials_included": False, "tokens_included": False, "absolute_paths_included": False, "logs_included": False},
    }
    data = _json_bytes(diagnostic)
    bundle_id = f"diagnostic-{uuid.uuid4().hex}"
    ARCHIVES_DIR.mkdir(parents=True, exist_ok=True)
    path = _safe_path(ARCHIVES_DIR, bundle_id, ".zip")
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("diagnostic.json", data)
    return {"id": bundle_id, "file_name": path.name, "size_bytes": path.stat().st_size}


def diagnostic_response(bundle_id: str):
    path = _safe_path(ARCHIVES_DIR, bundle_id, ".zip")
    if not path.is_file() or path.is_symlink():
        raise ServiceError(404, "Diagnostic bundle not found", "diagnostic.not_found")
    return FileResponse(path, media_type="application/zip", headers=attachment_headers(path.name))
