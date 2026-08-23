"""Persistence lifecycle for library-health background tasks."""

import json

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from ..models import LibraryHealthTask, now_iso
from .errors import ServiceError


ACTIVE_HEALTH_STATUSES = {"pending", "running", "cancel_requested"}


def parse_task_json(value: str | None, fallback):
    if not value:
        return fallback
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return fallback


def serialize_health_task(task: LibraryHealthTask) -> dict:
    return {
        **task.model_dump(exclude={"input_json", "result_json"}),
        "input": parse_task_json(task.input_json, {}),
        "result": parse_task_json(task.result_json, None),
    }


def list_health_tasks(session: Session, limit: int = 20) -> list[dict]:
    rows = session.exec(
        select(LibraryHealthTask)
        .order_by(LibraryHealthTask.created_at.desc(), LibraryHealthTask.id.desc())
        .limit(limit)
    ).all()
    return [serialize_health_task(row) for row in rows]


def _active_task(session: Session, task_type: str) -> LibraryHealthTask | None:
    return session.exec(
        select(LibraryHealthTask)
        .where(LibraryHealthTask.task_type == task_type)
        .where(LibraryHealthTask.status.in_(list(ACTIVE_HEALTH_STATUSES)))
        .order_by(LibraryHealthTask.created_at)
    ).first()


def create_health_task(
    session: Session,
    task_type: str = "health_check",
    audio_ids: list[int] | None = None,
) -> LibraryHealthTask:
    if task_type not in {"health_check", "duplicate_hash"}:
        raise ServiceError(400, "Unsupported library health task type", "health.task_type")
    active = _active_task(session, task_type)
    if active:
        raise ServiceError(
            409,
            "Library health task is already active",
            "health.task_active",
            {"task_id": active.id, "task_type": task_type},
        )
    unique_audio_ids = list(dict.fromkeys(audio_ids or []))
    if task_type == "duplicate_hash" and len(unique_audio_ids) < 2:
        raise ServiceError(400, "At least two audio items are required", "health.hash_minimum")
    task = LibraryHealthTask(
        task_type=task_type,
        input_json=json.dumps({"audio_ids": unique_audio_ids}, separators=(",", ":")),
        total_items=len(unique_audio_ids),
    )
    session.add(task)
    try:
        session.commit()
        session.refresh(task)
    except IntegrityError as error:
        session.rollback()
        raise ServiceError(
            409,
            "Library health task is already active",
            "health.task_active",
        ) from error
    return task


def cancel_health_task(session: Session, task_id: int) -> dict:
    task = session.get(LibraryHealthTask, task_id)
    if not task:
        raise ServiceError(404, "Library health task not found", "health.task_not_found")
    if task.status not in ACTIVE_HEALTH_STATUSES:
        raise ServiceError(400, "Library health task cannot be canceled", "health.cannot_cancel")
    timestamp = now_iso()
    if task.status == "pending":
        task.status = "canceled"
        task.finished_at = timestamp
    else:
        task.status = "cancel_requested"
    task.updated_at = timestamp
    session.add(task)
    session.commit()
    session.refresh(task)
    return serialize_health_task(task)


def retry_health_task(session: Session, task_id: int) -> LibraryHealthTask:
    source = session.get(LibraryHealthTask, task_id)
    if not source:
        raise ServiceError(404, "Library health task not found", "health.task_not_found")
    if source.status not in {"failed", "canceled"}:
        raise ServiceError(400, "Only failed or canceled health tasks can be retried", "health.cannot_retry")
    payload = parse_task_json(source.input_json, {})
    return create_health_task(
        session,
        task_type=source.task_type,
        audio_ids=payload.get("audio_ids") or [],
    )


def recover_interrupted_health_tasks(engine) -> int:
    recovered = 0
    with Session(engine) as session:
        rows = session.exec(
            select(LibraryHealthTask).where(
                LibraryHealthTask.status.in_(["pending", "running", "cancel_requested"])
            )
        ).all()
        timestamp = now_iso()
        for task in rows:
            task.status = "canceled" if task.status == "cancel_requested" else "failed"
            task.error_code = "health.interrupted"
            task.error_message = "Library health task was interrupted by backend restart"
            task.finished_at = timestamp
            task.updated_at = timestamp
            session.add(task)
            recovered += 1
        if rows:
            session.commit()
    return recovered


def task_cancel_requested(session: Session, task_id: int) -> bool:
    bind = session.get_bind()
    engine = getattr(bind, "engine", bind)
    with Session(engine) as cancellation_session:
        status = cancellation_session.exec(
            select(LibraryHealthTask.status).where(LibraryHealthTask.id == task_id)
        ).first()
    return status in {"cancel_requested", "canceled"}


def update_task_progress(
    session: Session,
    task: LibraryHealthTask,
    *,
    processed: int,
    total: int | None = None,
) -> None:
    task.processed_items = processed
    if total is not None:
        task.total_items = total
    task.updated_at = now_iso()
    session.add(task)
    session.commit()
    session.refresh(task)


def finish_task(
    session: Session,
    task: LibraryHealthTask,
    status: str,
    *,
    result: dict | None = None,
    error: Exception | None = None,
) -> None:
    timestamp = now_iso()
    task.status = status
    task.result_json = (
        json.dumps(result, ensure_ascii=False, separators=(",", ":"))
        if result is not None
        else None
    )
    task.error_message = str(error) if error else None
    task.error_code = "health.check_failed" if error else None
    task.finished_at = timestamp
    task.updated_at = timestamp
    session.add(task)
    session.commit()
