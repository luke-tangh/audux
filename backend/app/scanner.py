from pathlib import Path
from typing import Optional

from sqlmodel import Session, select

from .db import engine
from .models import LibraryRoot, ScanTask, now_iso
from .logger import get_logger
from .services.errors import error_code_for_detail
from .media_probe import (
    SUPPORTED_EXTS,
    get_scan_hash_strategy,
)
from .scan_reconciler import reconcile_audio_candidate, reconcile_missing_items

logger = get_logger(__name__)

INTERRUPTED_SCAN_STATUSES = {"pending", "running", "cancel_requested"}
SCAN_PROGRESS_INTERVAL = 25


class ScanEnumerationError(RuntimeError):
    pass


def _update_scan_task(session: Session, task_id: Optional[int], **kwargs):
    if not task_id:
        return

    task = session.get(ScanTask, task_id)
    if not task:
        return

    next_status = kwargs.get("status")

    # Do not let a stale worker overwrite a user cancel request back to running.
    if next_status == "running" and task.status in {
        "canceled",
        "cancel_requested",
        "done",
        "failed",
    }:
        return

    for key, value in kwargs.items():
        setattr(task, key, value)

    task.updated_at = now_iso()
    session.add(task)
    session.commit()


def _is_scan_canceled(session: Session, task_id: Optional[int]) -> bool:
    if not task_id:
        return False

    session.expire_all()
    task = session.get(ScanTask, task_id)
    return bool(task and task.status in {"canceled", "cancel_requested"})


def _iter_audio_candidates(root_path: Path):
    """
    Streaming audio candidate iterator.

    Avoids materializing the whole library tree before processing. This reduces
    memory usage on large libraries and lets scan cancellation be observed while
    enumeration is still in progress.
    """
    try:
        for p in root_path.rglob("*"):
            try:
                if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS:
                    yield p
            except Exception as e:
                logger.warning("Failed to inspect scan candidate %s: %s", p, e)
                raise ScanEnumerationError(
                    f"Failed to inspect library entry: {p}"
                ) from e

    except Exception as e:
        if isinstance(e, ScanEnumerationError):
            raise
        logger.warning("Failed to enumerate library root %s: %s", root_path, e)
        raise ScanEnumerationError(
            f"Failed to enumerate library root: {root_path}"
        ) from e


def scan_library_root(session: Session, root_id: int, scan_task_id: Optional[int] = None) -> dict:
    root = session.get(LibraryRoot, root_id)
    if not root:
        raise ValueError("Library root not found")

    root_path = Path(root.path).expanduser().resolve()
    if not root_path.exists() or not root_path.is_dir():
        raise ValueError("Invalid library root path")

    if _is_scan_canceled(session, scan_task_id):
        _update_scan_task(
            session,
            scan_task_id,
            status="canceled",
            finished_at=now_iso(),
        )
        return {
            "imported": 0,
            "updated": 0,
            "missing": 0,
        }

    hash_strategy = get_scan_hash_strategy(session)

    imported = 0
    updated = 0
    missing = 0
    processed = 0
    discovered = 0
    found_paths: set[str] = set()
    canceled = False

    # Set running before filesystem enumeration so a cancel request made during
    # large-directory walking cannot be overwritten later.
    _update_scan_task(
        session,
        scan_task_id,
        status="running",
        started_at=now_iso(),
        total_files=0,
        processed_files=0,
        imported=0,
        updated=0,
        missing=0,
        error_message=None,
    )

    logger.info(
        "Scanning root %s, hash_strategy=%s",
        root.path,
        hash_strategy,
    )

    def update_progress(force: bool = False):
        if not scan_task_id:
            return

        if not force and processed % SCAN_PROGRESS_INTERVAL != 0:
            return

        _update_scan_task(
            session,
            scan_task_id,
            total_files=discovered,
            processed_files=processed,
            imported=imported,
            updated=updated,
            missing=missing,
        )

    for file_path in _iter_audio_candidates(root_path):
        discovered += 1
        if _is_scan_canceled(session, scan_task_id):
            canceled = True
            break

        result = reconcile_audio_candidate(
            session,
            root_id=int(root.id),
            root_path=root_path,
            candidate=file_path,
            hash_strategy=hash_strategy,
        )
        if result.resolved_path is not None:
            found_paths.add(result.resolved_path)
        imported += result.imported
        updated += result.updated
        processed += 1
        update_progress()

    session.commit()
    if canceled or _is_scan_canceled(session, scan_task_id):
        _update_scan_task(
            session,
            scan_task_id,
            status="canceled",
            total_files=discovered,
            processed_files=processed,
            imported=imported,
            updated=updated,
            missing=missing,
            finished_at=now_iso(),
        )

        logger.info(
            "Scan canceled root=%s imported=%s updated=%s missing=%s",
            root.path,
            imported,
            updated,
            missing,
        )

        return {
            "imported": imported,
            "updated": updated,
            "missing": missing,
        }

    missing, canceled = reconcile_missing_items(
        session,
        root_id=int(root.id),
        found_paths=found_paths,
        should_cancel=lambda index: (
            index % SCAN_PROGRESS_INTERVAL == 0
            and _is_scan_canceled(session, scan_task_id)
        ),
    )

    if canceled:
        session.rollback()

        _update_scan_task(
            session,
            scan_task_id,
            status="canceled",
            total_files=discovered,
            processed_files=processed,
            imported=imported,
            updated=updated,
            missing=missing,
            finished_at=now_iso(),
        )

        logger.info(
            "Scan canceled during missing reconciliation root=%s imported=%s updated=%s missing=%s",
            root.path,
            imported,
            updated,
            missing,
        )

        return {
            "imported": imported,
            "updated": updated,
            "missing": missing,
        }

    session.commit()

    _update_scan_task(
        session,
        scan_task_id,
        status="done",
        total_files=discovered,
        processed_files=processed,
        imported=imported,
        updated=updated,
        missing=missing,
        finished_at=now_iso(),
    )

    logger.info(
        "Scan done root=%s files=%s imported=%s updated=%s missing=%s",
        root.path,
        discovered,
        imported,
        updated,
        missing,
    )

    return {
        "imported": imported,
        "updated": updated,
        "missing": missing,
    }


def recover_interrupted_scan_tasks() -> int:
    """
    FastAPI BackgroundTasks are in-process. If backend exits during a scan,
    pending/running scan_tasks cannot resume automatically, so mark them failed
    with an explicit recovery message.
    """
    recovered = 0

    with Session(engine) as session:
        tasks = session.exec(
            select(ScanTask).where(ScanTask.status.in_(list(INTERRUPTED_SCAN_STATUSES)))
        ).all()

        for task in tasks:
            if task.status == "cancel_requested":
                task.status = "canceled"
            else:
                task.status = "failed"
                task.error_message = task.error_message or "Scan interrupted by backend restart"
                task.error_code = task.error_code or "scan.interrupted"
                task.error_params = task.error_params or "{}"

            task.finished_at = task.finished_at or now_iso()
            task.updated_at = now_iso()
            session.add(task)
            recovered += 1

        if recovered:
            session.commit()
            logger.warning("Recovered interrupted scan tasks count=%s", recovered)

    return recovered


def scan_library_root_task(root_id: int, scan_task_id: int):
    with Session(engine) as session:
        try:
            scan_library_root(session, root_id, scan_task_id=scan_task_id)

        except Exception as e:
            logger.exception("Scan task failed root_id=%s task_id=%s", root_id, scan_task_id)

            task = session.get(ScanTask, scan_task_id)
            if task:
                task.status = "failed"
                task.error_message = str(e)
                task.error_code = error_code_for_detail(str(e))
                task.error_params = "{}"
                task.finished_at = now_iso()
                task.updated_at = now_iso()
                session.add(task)
                session.commit()
