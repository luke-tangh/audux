import hashlib
import json
import logging
import re
import shutil
import sqlite3
import threading
import uuid
from contextlib import closing
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlmodel import Session, select

from .. import db
from ..models import AITask, ScanTask
from ..time_utils import utc_now_iso, utc_timestamp_iso
from ..version import APP_VERSION
from .common import ServiceError


logger = logging.getLogger(__name__)

BACKUPS_DIR = db.BACKUPS_DIR
PENDING_RESTORE_PATH = db.APP_DATA_DIR / "pending-database-restore.json"
RESTORE_RESULT_PATH = db.APP_DATA_DIR / "database-restore-result.json"

ACTIVE_STATUSES = {"pending", "running", "cancel_requested"}
SAFE_SNAPSHOT_ID = re.compile(r"^[A-Za-z0-9._-]+\.sqlite$")
MAX_BACKUP_NAME_LENGTH = 80
MIN_RESTORE_FREE_SPACE = 16 * 1024 * 1024
RESTORE_STATE_LOCK = threading.RLock()


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    try:
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        try:
            temporary.chmod(0o600)
        except OSError:
            logger.debug("Could not restrict file permissions: %s", temporary)
        temporary.replace(path)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def _read_json(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Invalid restore state file: {path.name}") from error
    if not isinstance(value, dict):
        raise RuntimeError(f"Invalid restore state file: {path.name}")
    return value


def _manifest_path(snapshot_path: Path) -> Path:
    return snapshot_path.with_suffix(snapshot_path.suffix + ".json")


def _snapshot_path(snapshot_id: str, *, require_exists: bool = True) -> Path:
    if (
        not snapshot_id
        or Path(snapshot_id).name != snapshot_id
        or not SAFE_SNAPSHOT_ID.fullmatch(snapshot_id)
    ):
        raise ServiceError(
            400,
            "Invalid database backup id",
            code="backup.invalid_id",
        )

    root = BACKUPS_DIR.resolve()
    candidate = BACKUPS_DIR / snapshot_id
    if candidate.is_symlink():
        raise ServiceError(
            400,
            "Invalid database backup id",
            code="backup.invalid_id",
        )

    resolved = candidate.resolve()
    if resolved.parent != root:
        raise ServiceError(
            400,
            "Invalid database backup id",
            code="backup.invalid_id",
        )
    if require_exists and not resolved.is_file():
        raise ServiceError(
            404,
            "Database backup not found",
            code="backup.not_found",
        )
    return resolved


def _database_path_for_session(session: Session) -> Path:
    database = session.get_bind().url.database
    if not database or database == ":memory:":
        raise ServiceError(
            503,
            "Database backup requires a file-backed SQLite database",
            code="backup.file_database_required",
        )
    return Path(database).resolve()


def _normalize_name(name: str | None, fallback: str) -> str:
    normalized = " ".join((name or "").split()).strip()
    if not normalized:
        return fallback
    if len(normalized) > MAX_BACKUP_NAME_LENGTH:
        raise ServiceError(
            422,
            f"Database backup name must not exceed {MAX_BACKUP_NAME_LENGTH} characters",
            code="backup.name_too_long",
            params={"max": MAX_BACKUP_NAME_LENGTH},
        )
    return normalized


def _snapshot_kind(snapshot_id: str) -> str:
    if ".pre-migration-" in snapshot_id:
        return "pre_migration"
    if ".pre-restore-" in snapshot_id:
        return "pre_restore"
    return "manual"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _integrity_error(path: Path) -> str | None:
    try:
        uri = f"file:{path.resolve().as_posix()}?mode=ro"
        with closing(sqlite3.connect(uri, uri=True)) as connection:
            result = connection.execute("PRAGMA quick_check").fetchone()
    except (OSError, sqlite3.Error) as error:
        return str(error)
    if result is None or result[0] != "ok":
        return f"quick_check returned {result!r}"
    return None


def _read_manifest(snapshot_path: Path) -> dict[str, Any]:
    path = _manifest_path(snapshot_path)
    if not path.is_file() or path.is_symlink():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def _write_manifest(snapshot_path: Path, payload: dict[str, Any]) -> None:
    _atomic_write_json(_manifest_path(snapshot_path), payload)


def _schema_state(path: Path) -> tuple[int | None, set[int], str | None]:
    try:
        version, applied = db._database_schema_state(path)
        return version, applied, None
    except (OSError, sqlite3.Error, ValueError) as error:
        return None, set(), str(error)


def _compatibility_error(
    schema_version: int | None,
    applied_versions: set[int],
    schema_error: str | None,
) -> str | None:
    if schema_error:
        return schema_error
    if schema_version is None:
        return "Backup does not contain an application database"
    if schema_version > db.CURRENT_SCHEMA_VERSION:
        return (
            f"Backup schema v{schema_version} is newer than supported "
            f"v{db.CURRENT_SCHEMA_VERSION}"
        )
    expected = set(range(1, schema_version + 1))
    if applied_versions != expected:
        return "Backup has an incomplete migration history"
    return None


def _snapshot_record(snapshot_path: Path) -> dict[str, Any]:
    manifest = _read_manifest(snapshot_path)
    stat = snapshot_path.stat()
    schema_version, applied_versions, schema_error = _schema_state(snapshot_path)
    compatibility_error = _compatibility_error(
        schema_version,
        applied_versions,
        schema_error,
    )
    integrity_status = str(manifest.get("integrity_status") or "unchecked")
    integrity_error = manifest.get("integrity_error")
    if integrity_status == "valid" and manifest.get("size_bytes") != stat.st_size:
        integrity_status = "unchecked"
        integrity_error = "Backup size changed after validation"

    return {
        "id": snapshot_path.name,
        "name": str(manifest.get("name") or snapshot_path.stem),
        "kind": str(manifest.get("kind") or _snapshot_kind(snapshot_path.name)),
        "created_at": str(
            manifest.get("created_at") or utc_timestamp_iso(stat.st_mtime)
        ),
        "app_version": manifest.get("app_version"),
        "schema_version": schema_version,
        "size_bytes": stat.st_size,
        "integrity_status": integrity_status,
        "integrity_error": integrity_error,
        "sha256": manifest.get("sha256"),
        "restore_compatible": compatibility_error is None
        and integrity_status != "invalid",
        "compatibility_error": compatibility_error,
    }


def _validated_snapshot(snapshot_id: str) -> tuple[Path, dict[str, Any]]:
    snapshot_path = _snapshot_path(snapshot_id)
    error = _integrity_error(snapshot_path)
    record = _snapshot_record(snapshot_path)
    record["integrity_status"] = "invalid" if error else "valid"
    record["integrity_error"] = error
    record["sha256"] = _sha256(snapshot_path) if not error else None
    record["restore_compatible"] = bool(
        not error and record["compatibility_error"] is None
    )
    manifest = {
        **_read_manifest(snapshot_path),
        "name": record["name"],
        "kind": record["kind"],
        "created_at": record["created_at"],
        "app_version": record["app_version"],
        "schema_version": record["schema_version"],
        "size_bytes": record["size_bytes"],
        "integrity_status": record["integrity_status"],
        "integrity_error": error,
        "sha256": record["sha256"],
        "validated_at": utc_now_iso(),
    }
    _write_manifest(snapshot_path, manifest)
    return snapshot_path, record


def _create_snapshot_from_path(
    source_path: Path,
    *,
    name: str,
    kind: str,
) -> dict[str, Any]:
    BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = utc_now_iso().replace("-", "").replace(":", "").replace(".", "")
    snapshot_id = f"database.{kind.replace('_', '-')}-{timestamp}Z-{uuid.uuid4().hex[:8]}.sqlite"
    snapshot_path = _snapshot_path(snapshot_id, require_exists=False)
    db._verified_sqlite_backup(source_path, snapshot_path)
    schema_version, _, _ = _schema_state(snapshot_path)
    stat = snapshot_path.stat()
    manifest = {
        "name": name,
        "kind": kind,
        "created_at": utc_now_iso(),
        "app_version": APP_VERSION,
        "schema_version": schema_version,
        "size_bytes": stat.st_size,
        "integrity_status": "valid",
        "integrity_error": None,
        "sha256": _sha256(snapshot_path),
        "validated_at": utc_now_iso(),
    }
    try:
        _write_manifest(snapshot_path, manifest)
    except Exception:
        snapshot_path.unlink(missing_ok=True)
        raise
    return _snapshot_record(snapshot_path)


def list_database_backups() -> list[dict[str, Any]]:
    BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
    rows = []
    for path in BACKUPS_DIR.glob("*.sqlite"):
        if not path.is_file() or path.is_symlink():
            continue
        try:
            rows.append(_snapshot_record(path.resolve()))
        except OSError:
            logger.warning("Could not inspect database backup: %s", path, exc_info=True)
    return sorted(rows, key=lambda row: row["created_at"], reverse=True)


def create_database_backup(session: Session, name: str | None = None) -> dict[str, Any]:
    source_path = _database_path_for_session(session)
    return _create_snapshot_from_path(
        source_path,
        name=_normalize_name(name, "手动备份"),
        kind="manual",
    )


def validate_database_backup(snapshot_id: str) -> dict[str, Any]:
    with RESTORE_STATE_LOCK:
        _, record = _validated_snapshot(snapshot_id)
        return record


def _pending_request() -> dict[str, Any] | None:
    try:
        return _read_json(PENDING_RESTORE_PATH)
    except RuntimeError as error:
        raise ServiceError(
            500,
            str(error),
            code="backup.restore_state_invalid",
        ) from error


def delete_database_backup(snapshot_id: str) -> dict[str, Any]:
    with RESTORE_STATE_LOCK:
        snapshot_path = _snapshot_path(snapshot_id)
        pending = _pending_request()
        protected = {
            pending.get("snapshot_id") if pending else None,
            pending.get("safety_snapshot_id") if pending else None,
        }
        if snapshot_id in protected:
            raise ServiceError(
                409,
                "Database backup is required by the pending restore",
                code="backup.pending_snapshot",
            )
        snapshot_path.unlink()
        _manifest_path(snapshot_path).unlink(missing_ok=True)
        return {"ok": True, "id": snapshot_id}


def _active_task_counts(session: Session) -> tuple[int, int]:
    ai_count = len(
        session.exec(select(AITask.id).where(AITask.status.in_(ACTIVE_STATUSES))).all()
    )
    scan_count = len(
        session.exec(
            select(ScanTask.id).where(ScanTask.status.in_(ACTIVE_STATUSES))
        ).all()
    )
    return ai_count, scan_count


def restore_preflight(session: Session, snapshot_id: str) -> dict[str, Any]:
    _, backup = _validated_snapshot(snapshot_id)
    current_path = _database_path_for_session(session)
    current_size = current_path.stat().st_size if current_path.exists() else 0
    # Scheduling keeps one safety snapshot. On restart, refreshing that snapshot
    # and staging the restore happen sequentially, so reserve the larger temporary
    # copy in addition to the persistent safety snapshot.
    required_bytes = (
        current_size
        + max(current_size, int(backup["size_bytes"]))
        + MIN_RESTORE_FREE_SPACE
    )
    free_bytes = shutil.disk_usage(BACKUPS_DIR).free
    active_ai_tasks, active_scan_tasks = _active_task_counts(session)

    blockers: list[dict[str, Any]] = []
    if backup["integrity_status"] != "valid":
        blockers.append(
            {
                "code": "backup.integrity_invalid",
                "message": backup["integrity_error"] or "Backup integrity check failed",
            }
        )
    if not backup["restore_compatible"]:
        blockers.append(
            {
                "code": "backup.incompatible",
                "message": backup["compatibility_error"] or "Backup is incompatible",
            }
        )
    if active_ai_tasks or active_scan_tasks:
        blockers.append(
            {
                "code": "backup.active_tasks",
                "message": "Finish or cancel active AI, ASR and scan tasks before restoring",
                "params": {
                    "ai_tasks": active_ai_tasks,
                    "scan_tasks": active_scan_tasks,
                },
            }
        )
    if free_bytes < required_bytes:
        blockers.append(
            {
                "code": "backup.insufficient_space",
                "message": "Not enough free disk space for a safe restore",
                "params": {"required_bytes": required_bytes, "free_bytes": free_bytes},
            }
        )
    if PENDING_RESTORE_PATH.exists():
        blockers.append(
            {
                "code": "backup.restore_pending",
                "message": "Another database restore is already pending",
            }
        )

    return {
        "ok": not blockers,
        "backup": backup,
        "blockers": blockers,
        "active_ai_tasks": active_ai_tasks,
        "active_scan_tasks": active_scan_tasks,
        "required_bytes": required_bytes,
        "free_bytes": free_bytes,
        "restart_required": True,
    }


def schedule_database_restore(session: Session, snapshot_id: str) -> dict[str, Any]:
    with RESTORE_STATE_LOCK:
        preflight = restore_preflight(session, snapshot_id)
        if not preflight["ok"]:
            raise ServiceError(
                409,
                "Database restore preflight failed",
                code="backup.preflight_failed",
                params={"blockers": preflight["blockers"]},
            )

        current_path = _database_path_for_session(session)
        safety = _create_snapshot_from_path(
            current_path,
            name="恢复前自动安全快照",
            kind="pre_restore",
        )
        backup = preflight["backup"]
        request = {
            "schema_version": 1,
            "snapshot_id": snapshot_id,
            "snapshot_sha256": backup["sha256"],
            "safety_snapshot_id": safety["id"],
            "requested_at": utc_now_iso(),
            "app_version": APP_VERSION,
        }
        try:
            _atomic_write_json(PENDING_RESTORE_PATH, request)
        except Exception:
            # The safety snapshot is intentionally retained even if scheduling fails.
            logger.exception("Could not write pending database restore request")
            raise
        return {
            "status": "pending",
            "snapshot_id": snapshot_id,
            "safety_snapshot_id": safety["id"],
            "requested_at": request["requested_at"],
            "restart_required": True,
        }


def cancel_pending_database_restore() -> dict[str, Any]:
    with RESTORE_STATE_LOCK:
        if not PENDING_RESTORE_PATH.exists():
            raise ServiceError(
                404,
                "No database restore is pending",
                code="backup.no_restore_pending",
            )
        PENDING_RESTORE_PATH.unlink()
        return {"ok": True}


def get_database_restore_status() -> dict[str, Any]:
    pending = _pending_request()
    try:
        last_result = _read_json(RESTORE_RESULT_PATH)
    except RuntimeError:
        logger.warning("Ignoring invalid database restore result", exc_info=True)
        last_result = None
    return {
        "pending": pending,
        "last_result": last_result,
    }


def _remove_database_sidecars(database_path: Path) -> None:
    for suffix in ("-wal", "-shm"):
        database_path.with_name(database_path.name + suffix).unlink(missing_ok=True)


def _replace_database_from_snapshot(snapshot_path: Path) -> None:
    stage_path = db.DB_PATH.with_name("database.restore-stage.sqlite")
    stage_path.unlink(missing_ok=True)
    stage_path.with_suffix(stage_path.suffix + ".tmp").unlink(missing_ok=True)
    db._verified_sqlite_backup(snapshot_path, stage_path)
    db.engine.dispose()
    _remove_database_sidecars(db.DB_PATH)
    stage_path.replace(db.DB_PATH)


def _record_restore_result(
    *,
    status: str,
    request: dict[str, Any],
    error: str | None = None,
) -> None:
    _atomic_write_json(
        RESTORE_RESULT_PATH,
        {
            "status": status,
            "snapshot_id": request.get("snapshot_id"),
            "safety_snapshot_id": request.get("safety_snapshot_id"),
            "requested_at": request.get("requested_at"),
            "completed_at": utc_now_iso(),
            "error": error,
        },
    )


def initialize_database_with_pending_restore() -> None:
    """Apply a scheduled restore before normal connections and roll back on failure."""
    try:
        request = _read_json(PENDING_RESTORE_PATH)
    except RuntimeError as error:
        logger.exception("Invalid pending database restore request")
        PENDING_RESTORE_PATH.unlink(missing_ok=True)
        _record_restore_result(status="failed", request={}, error=str(error))
        db.create_db_and_tables()
        return

    if request is None:
        db.create_db_and_tables()
        return

    try:
        if request.get("schema_version") != 1:
            raise RuntimeError("Unsupported pending restore request version")
        snapshot_id = str(request.get("snapshot_id") or "")
        safety_snapshot_id = str(request.get("safety_snapshot_id") or "")
        snapshot_path = _snapshot_path(snapshot_id)
        safety_path = _snapshot_path(safety_snapshot_id)
        integrity_error = _integrity_error(snapshot_path)
        if integrity_error:
            raise RuntimeError(f"Restore backup validation failed: {integrity_error}")
        if _sha256(snapshot_path) != request.get("snapshot_sha256"):
            raise RuntimeError("Restore backup changed after preflight")
        version, applied, schema_error = _schema_state(snapshot_path)
        compatibility_error = _compatibility_error(version, applied, schema_error)
        if compatibility_error:
            raise RuntimeError(compatibility_error)

        # Browser-lite may remain open after scheduling. Refresh the safety
        # snapshot at the actual switch point so later committed edits can still
        # be recovered if target initialization fails.
        db._verified_sqlite_backup(db.DB_PATH, safety_path)
        _, safety_record = _validated_snapshot(safety_snapshot_id)
        if safety_record["integrity_status"] != "valid":
            raise RuntimeError("Restore safety snapshot is invalid")
        request["safety_refreshed_at"] = utc_now_iso()
        _atomic_write_json(PENDING_RESTORE_PATH, request)
        _replace_database_from_snapshot(snapshot_path)
    except Exception as error:
        # Validation and staging failures occur before replacing the live database.
        logger.exception("Database restore request failed before database replacement")
        _record_restore_result(status="failed", request=request, error=str(error))
        PENDING_RESTORE_PATH.unlink(missing_ok=True)
        db.create_db_and_tables()
        return

    try:
        db.create_db_and_tables()
    except Exception as restore_error:
        logger.exception("Restored database could not be initialized; rolling back")
        try:
            _replace_database_from_snapshot(safety_path)
            db.create_db_and_tables()
        except Exception as rollback_error:
            _record_restore_result(
                status="rollback_failed",
                request=request,
                error=f"restore: {restore_error}; rollback: {rollback_error}",
            )
            PENDING_RESTORE_PATH.unlink(missing_ok=True)
            raise RuntimeError(
                "Database restore and automatic rollback both failed"
            ) from rollback_error
        _record_restore_result(
            status="rolled_back",
            request=request,
            error=str(restore_error),
        )
        PENDING_RESTORE_PATH.unlink(missing_ok=True)
        return

    _record_restore_result(status="succeeded", request=request)
    PENDING_RESTORE_PATH.unlink(missing_ok=True)
    logger.info("Database restore completed snapshot=%s", snapshot_id)
