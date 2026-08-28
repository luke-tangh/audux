from pathlib import Path
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from ..logger import get_logger
from ..models import AudioItem, LibraryRoot, ScanTask, now_iso
from ..scanner import scan_library_root
from .errors import ServiceError
from .task_state import get_active_scan_task, is_unique_constraint_error


logger = get_logger(__name__)


def _validated_library_path(path_value: str) -> str:
    path = str(Path(path_value).expanduser().resolve())

    if not Path(path).exists() or not Path(path).is_dir():
        raise ServiceError(400, "Invalid directory")
    return path


def _ensure_library_path_available(session: Session, path: str) -> None:
    if session.exec(select(LibraryRoot.id).where(LibraryRoot.path == path)).first():
        raise ServiceError(409, "Library root already exists")


def create_library_root(session: Session, path_value: str) -> LibraryRoot:
    path = _validated_library_path(path_value)
    _ensure_library_path_available(session, path)

    root = LibraryRoot(path=path)
    session.add(root)
    try:
        session.commit()
        session.refresh(root)
    except IntegrityError as error:
        session.rollback()
        if session.exec(select(LibraryRoot.id).where(LibraryRoot.path == path)).first():
            raise ServiceError(409, "Library root already exists") from error
        raise

    logger.info("Library root created: %s", path)
    return root


def create_library_import(
    session: Session,
    path_value: str,
) -> tuple[LibraryRoot, ScanTask]:
    """Create a library root and its initial scan task atomically."""
    path = _validated_library_path(path_value)
    _ensure_library_path_available(session, path)
    root = LibraryRoot(path=path)
    session.add(root)

    try:
        session.flush()
        task = ScanTask(root_id=int(root.id), status="pending")
        session.add(task)
        session.commit()
        session.refresh(root)
        session.refresh(task)
    except IntegrityError as error:
        session.rollback()
        if session.exec(select(LibraryRoot.id).where(LibraryRoot.path == path)).first():
            raise ServiceError(409, "Library root already exists") from error
        raise
    except Exception:
        session.rollback()
        raise

    logger.info("Library root import queued: %s task=%s", path, task.id)
    return root, task


def list_library_roots(session: Session) -> list[LibraryRoot]:
    return session.exec(select(LibraryRoot).order_by(LibraryRoot.created_at)).all()


def update_library_root(
    session: Session,
    root_id: int,
    is_enabled: Optional[bool] = None,
) -> LibraryRoot:
    root = session.get(LibraryRoot, root_id)
    if not root:
        raise ServiceError(404, "Library root not found")

    if is_enabled is not None:
        root.is_enabled = is_enabled

    root.updated_at = now_iso()
    session.add(root)
    session.commit()
    session.refresh(root)

    logger.info("Library root updated id=%s enabled=%s", root.id, root.is_enabled)
    return root


def delete_library_root(session: Session, root_id: int) -> dict:
    root = session.get(LibraryRoot, root_id)
    if not root:
        raise ServiceError(404, "Library root not found")

    active_task = get_active_scan_task(session, root_id)
    if active_task:
        raise ServiceError(
            409,
            "Cancel or finish the active scan task before removing this library root",
        )

    audio_items = session.exec(
        select(AudioItem).where(AudioItem.library_root_id == root_id)
    ).all()
    scan_tasks = session.exec(
        select(ScanTask).where(ScanTask.root_id == root_id)
    ).all()

    for audio in audio_items:
        audio.library_root_id = None
        audio.updated_at = now_iso()
        session.add(audio)

    for task in scan_tasks:
        session.delete(task)

    session.flush()
    session.delete(root)
    session.commit()

    logger.info(
        "Library root removed id=%s detached_audio=%s removed_scan_tasks=%s",
        root_id,
        len(audio_items),
        len(scan_tasks),
    )
    return {
        "ok": True,
        "detached_audio_items": len(audio_items),
        "removed_scan_tasks": len(scan_tasks),
    }


def create_scan_task(session: Session, root_id: int) -> ScanTask:
    root = session.get(LibraryRoot, root_id)
    if not root:
        raise ServiceError(404, "Library root not found")

    active_task = get_active_scan_task(session, root_id)
    if active_task:
        raise ServiceError(
            409,
            "Scan task is already pending or running for this library root",
        )

    task = ScanTask(root_id=root_id, status="pending")
    session.add(task)

    try:
        session.commit()
        session.refresh(task)
    except IntegrityError as e:
        session.rollback()

        if is_unique_constraint_error(e):
            raise ServiceError(
                409,
                "Scan task is already pending or running for this library root",
            )

        raise

    logger.info("Scan task created id=%s root=%s", task.id, root.path)
    return task


def scan_root_sync(session: Session, root_id: int) -> dict:
    root = session.get(LibraryRoot, root_id)
    if not root:
        raise ServiceError(404, "Library root not found")

    active_task = get_active_scan_task(session, root_id)
    if active_task:
        raise ServiceError(
            409,
            "Scan task is already pending or running for this library root",
        )

    try:
        return scan_library_root(session, root_id)
    except ValueError as e:
        raise ServiceError(400, str(e)) from e


def list_scan_tasks(
    session: Session,
    root_id: Optional[int] = None,
    limit: int = 50,
) -> list[ScanTask]:
    stmt = select(ScanTask)

    if root_id is not None:
        stmt = stmt.where(ScanTask.root_id == root_id)

    stmt = stmt.order_by(ScanTask.created_at.desc()).limit(limit)
    return session.exec(stmt).all()


def get_scan_task(session: Session, task_id: int) -> ScanTask:
    task = session.get(ScanTask, task_id)
    if not task:
        raise ServiceError(404, "Scan task not found")

    return task


def cancel_scan_task(session: Session, task_id: int) -> ScanTask:
    task = session.get(ScanTask, task_id)
    if not task:
        raise ServiceError(404, "Scan task not found")

    if task.status in ["done", "failed", "canceled"]:
        raise ServiceError(400, "Scan task cannot be canceled")

    if task.status == "cancel_requested":
        return task

    task.updated_at = now_iso()

    if task.status == "running":
        task.status = "cancel_requested"
    else:
        task.status = "canceled"
        task.finished_at = now_iso()

    session.add(task)
    session.commit()
    session.refresh(task)

    logger.info("Scan task cancel requested id=%s status=%s", task.id, task.status)
    return task
