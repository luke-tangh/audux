import asyncio
import contextlib
import json

from sqlmodel import Session

from . import db
from .logger import get_logger
from .models import AITask, AudioItem, now_iso
from .services.errors import ServiceError, error_code_for_detail
from .settings_reader import get_setting, get_setting_float, get_setting_int
from .task_handlers import _build_analyze_prompt, handle_analyze_task, handle_transcribe_task
from .task_repository import (
    ActiveTaskConflict,
    CANCEL_REQUEST_STATUSES,
    TaskCanceled,
    TaskSnapshot,
    _snapshot_task,
    _set_audio_task_status_no_commit,
    claim_next_pending_task,
    create_task,
    finalize_canceled_task,
    get_active_task,
    is_task_canceled,
    recover_interrupted_tasks,
    set_audio_task_status,
)


logger = get_logger(__name__)
engine = db.engine
_task_runner_started = False
_worker_task: asyncio.Task[None] | None = None


def _mark_task_done(task_id: int):
    with Session(db.engine) as session:
        fresh = session.get(AITask, task_id)
        if not fresh:
            return

        # handler 正常返回代表业务结果已经完成。
        # 如果 UI 刚好请求 cancel，done 赢，避免“结果已落库但任务显示 canceled”。
        if fresh.status in {"failed", "canceled"}:
            return

        fresh.status = "done"
        fresh.finished_at = now_iso()
        fresh.updated_at = now_iso()
        session.add(fresh)

        # Keep task/audio status in the same transaction. This fixes the race:
        # handler commits business output -> UI requests cancel -> worker marks
        # task done. Without this, task may be done while audio remains
        # cancel_requested.
        _set_audio_task_status_no_commit(
            session,
            fresh.audio_id,
            fresh.task_type,
            "done",
        )

        session.commit()


def _mark_task_failed_or_canceled_after_exception(task_id: int, exc: Exception):
    with Session(db.engine) as session:
        session.expire_all()
        fresh = session.get(AITask, task_id)

        if fresh and fresh.status in CANCEL_REQUEST_STATUSES:
            finalize_canceled_task(session, task_id)
            return

        if not fresh:
            return

        if fresh.status in {"done", "failed", "canceled"}:
            return

        fresh.status = "failed"
        fresh.error_message = str(exc)
        fresh.error_code = (
            exc.code if isinstance(exc, ServiceError) else error_code_for_detail(str(exc))
        )
        fresh.error_params = json.dumps(
            exc.params if isinstance(exc, ServiceError) else {}, ensure_ascii=False
        )
        fresh.finished_at = now_iso()
        fresh.updated_at = now_iso()
        session.add(fresh)

        audio = session.get(AudioItem, fresh.audio_id)
        if audio:
            if fresh.task_type == "transcribe":
                audio.transcript_status = "failed"
            if fresh.task_type == "analyze":
                audio.ai_status = "failed"

            audio.updated_at = now_iso()
            session.add(audio)

        session.commit()


async def worker_loop():
    while True:
        await asyncio.sleep(1)

        snapshot: TaskSnapshot | None = None

        with Session(db.engine) as session:
            task = claim_next_pending_task(session)
            if task:
                snapshot = _snapshot_task(task)

        if not snapshot:
            continue

        try:
            if snapshot.task_type == "transcribe":
                await handle_transcribe_task(snapshot)
            elif snapshot.task_type == "analyze":
                await handle_analyze_task(snapshot)
            else:
                raise ValueError(f"Unknown task type: {snapshot.task_type}")

            _mark_task_done(snapshot.id)

        except TaskCanceled:
            with Session(db.engine) as session:
                finalize_canceled_task(session, snapshot.id)

        except Exception as e:
            logger.exception("AI/ASR task failed id=%s", snapshot.id)
            _mark_task_failed_or_canceled_after_exception(snapshot.id, e)


def start_worker_once() -> asyncio.Task[None]:
    global _task_runner_started, _worker_task

    if _worker_task is not None and not _worker_task.done():
        return _worker_task

    try:
        recover_interrupted_tasks()
    except Exception:
        logger.exception("Failed to recover interrupted AI/ASR tasks")

    _task_runner_started = True
    _worker_task = asyncio.create_task(worker_loop())
    return _worker_task


async def stop_worker() -> None:
    global _task_runner_started, _worker_task
    task = _worker_task
    _worker_task = None
    _task_runner_started = False
    if task is None:
        return
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task
