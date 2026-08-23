import asyncio
import contextlib
from typing import Awaitable, TypeVar

from sqlmodel import Session

from . import db
from .logger import get_logger
from .models import AITask, now_iso


logger = get_logger(__name__)
TASK_HEARTBEAT_INTERVAL_SECONDS = 5
T = TypeVar("T")


def touch_task_heartbeat(task_id: int) -> bool:
    with Session(db.engine) as session:
        task = session.get(AITask, task_id)
        if not task or task.status in {"done", "failed", "canceled"}:
            return False

        if task.status in {"running", "cancel_requested"}:
            task.updated_at = now_iso()
            session.add(task)
            session.commit()

        return True


async def task_heartbeat_loop(task_id: int, stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        try:
            if not touch_task_heartbeat(task_id):
                return
        except Exception:
            logger.warning("Failed to update task heartbeat id=%s", task_id, exc_info=True)

        try:
            await asyncio.wait_for(
                stop_event.wait(),
                timeout=TASK_HEARTBEAT_INTERVAL_SECONDS,
            )
        except asyncio.TimeoutError:
            continue


async def run_with_task_heartbeat(task_id: int, awaitable: Awaitable[T]) -> T:
    stop_event = asyncio.Event()
    heartbeat_task = asyncio.create_task(task_heartbeat_loop(task_id, stop_event))

    try:
        return await awaitable
    finally:
        stop_event.set()
        heartbeat_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat_task
