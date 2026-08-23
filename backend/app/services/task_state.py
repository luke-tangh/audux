import json

from sqlmodel import Session, select

from ..models import ScanTask


BUSY_AUDIO_TASK_STATUSES = {"pending", "running", "cancel_requested"}
ACTIVE_SCAN_TASK_STATUSES = {"pending", "running", "cancel_requested"}
CANCEL_REQUEST_STATUSES = {"canceled", "cancel_requested"}
INTERRUPTED_AI_TASK_STATUSES = {"running", "cancel_requested"}
TERMINAL_TASK_STATUSES = {"done", "failed", "canceled"}


def parse_task_output_payload(value: str | None) -> dict:
    if not value:
        return {}

    try:
        parsed = json.loads(value)
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def is_unique_constraint_error(error: Exception) -> bool:
    message = str(getattr(error, "orig", error)).lower()
    return (
        "unique constraint failed" in message
        or "ux_ai_tasks_active" in message
        or "ux_scan_tasks_active_root" in message
    )


def get_active_scan_task(session: Session, root_id: int) -> ScanTask | None:
    return session.exec(
        select(ScanTask)
        .where(ScanTask.root_id == root_id)
        .where(ScanTask.status.in_(list(ACTIVE_SCAN_TASK_STATUSES)))
        .order_by(ScanTask.created_at)
    ).first()
