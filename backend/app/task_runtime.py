from typing import Any, Protocol, TypeVar, cast

from sqlalchemy import CursorResult, func, update
from sqlmodel import Session, select

from .models import now_iso


class TaskRowProtocol(Protocol):
    # SQLModel exposes scalar values on instances and SQL expressions on the
    # model class. Any is intentional at this generic class/instance boundary.
    id: Any
    status: Any
    created_at: Any
    started_at: Any
    updated_at: Any


TaskRow = TypeVar("TaskRow", bound=TaskRowProtocol)


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
    result = cast(
        CursorResult[Any],
        session.execute(
            update(model)
            .where(model.id == row_id, model.status == "pending")
            .values(
                status="running",
                started_at=started_at,
                updated_at=timestamp,
            )
        )
    )
    session.commit()
    return session.get(model, row_id) if result.rowcount == 1 else None
