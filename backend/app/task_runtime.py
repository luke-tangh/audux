from typing import Any, TypeVar

from sqlalchemy import func, update
from sqlmodel import Session, select

from .models import now_iso


TaskRow = TypeVar("TaskRow")


def claim_next_pending(
    session: Session,
    model: type[TaskRow],
    *,
    preserve_started_at: bool = False,
) -> TaskRow | None:
    row_id = session.exec(
        select(model.id)
        .where(model.status == "pending")
        .order_by(model.created_at)
    ).first()
    if row_id is None:
        return None

    timestamp = now_iso()
    started_at: Any = (
        func.coalesce(model.started_at, timestamp)
        if preserve_started_at
        else timestamp
    )
    result = session.execute(
        update(model)
        .where(model.id == row_id, model.status == "pending")
        .values(
            status="running",
            started_at=started_at,
            updated_at=timestamp,
        )
    )
    session.commit()
    return session.get(model, row_id) if result.rowcount == 1 else None
