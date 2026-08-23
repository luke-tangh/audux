import json
from dataclasses import dataclass
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from . import db
from .asr_config import parse_task_input_payload
from .logger import get_logger
from .models import AITask, AudioItem, Transcript, TranscriptSegment, now_iso
from .search import rebuild_audio_search_index
from .task_runtime import claim_next_pending
from .services.task_state import (
    BUSY_AUDIO_TASK_STATUSES as ACTIVE_TASK_STATUSES,
    CANCEL_REQUEST_STATUSES,
    INTERRUPTED_AI_TASK_STATUSES as INTERRUPTED_TASK_STATUSES,
)


logger = get_logger(__name__)


class TaskCanceled(Exception):
    pass


class ActiveTaskConflict(Exception):
    pass


@dataclass(frozen=True)
class TaskSnapshot:
    id: int
    audio_id: int
    task_type: str
    input_payload: dict


def _is_unique_constraint_error(error: IntegrityError) -> bool:
    message = str(getattr(error, "orig", error)).lower()
    return (
        "unique constraint failed" in message
        or "ux_ai_tasks_active" in message
    )


def _snapshot_task(task: AITask) -> TaskSnapshot:
    if task.id is None:
        raise ValueError("Task id is missing")

    return TaskSnapshot(
        id=int(task.id),
        audio_id=int(task.audio_id),
        task_type=str(task.task_type),
        input_payload=parse_task_input_payload(task.input_payload),
    )


def create_task(
    session: Session,
    audio_id: int,
    task_type: str,
    input_payload: dict | None = None,
) -> AITask:
    task = AITask(
        audio_id=audio_id,
        task_type=task_type,
        status="pending",
        input_payload=json.dumps(input_payload or {}, ensure_ascii=False),
        updated_at=now_iso(),
    )
    session.add(task)

    try:
        session.commit()
    except IntegrityError as e:
        session.rollback()

        if _is_unique_constraint_error(e):
            raise ActiveTaskConflict(
                "Another active task already exists for this audio item and task type"
            ) from e

        raise

    session.refresh(task)
    return task


def get_active_task(
    session: Session,
    audio_id: int,
    task_type: str,
    exclude_task_id: Optional[int] = None,
) -> Optional[AITask]:
    stmt = (
        select(AITask)
        .where(AITask.audio_id == audio_id)
        .where(AITask.task_type == task_type)
        .where(AITask.status.in_(list(ACTIVE_TASK_STATUSES)))
    )

    if exclude_task_id is not None:
        stmt = stmt.where(AITask.id != exclude_task_id)

    return session.exec(stmt).first()


def is_task_canceled(session: Session, task_id: int) -> bool:
    session.expire_all()
    task = session.get(AITask, task_id)
    return bool(task and task.status in CANCEL_REQUEST_STATUSES)


def _is_task_canceled_by_id(task_id: int) -> bool:
    with Session(db.engine) as session:
        return is_task_canceled(session, task_id)


def set_audio_task_status(
    session: Session,
    audio_id: int,
    task_type: str,
    status: str,
):
    _set_audio_task_status_no_commit(session, audio_id, task_type, status)
    if session.dirty:
        session.commit()


def _set_audio_task_status_no_commit(
    session: Session,
    audio_id: int,
    task_type: str,
    status: str,
):
    audio = session.get(AudioItem, audio_id)
    if not audio:
        return

    if task_type == "transcribe":
        audio.transcript_status = status

    if task_type == "analyze":
        audio.ai_status = status

    audio.updated_at = now_iso()
    session.add(audio)


def _task_has_completed_output(session: Session, task: AITask) -> bool:
    """
    Backend 异常退出后恢复 running/cancel_requested 任务时使用。

    如果业务结果已经完整落库，则可恢复为 done，避免：
    - transcript 已生成但 task/audio 被恢复为 failed
    - AI 描述已写入但 task/audio 被恢复为 failed
    """
    if task.task_type == "transcribe":
        transcript = session.exec(
            select(Transcript)
            .where(Transcript.audio_id == task.audio_id)
            .where(Transcript.is_current.is_(True))
        ).first()

        return bool(transcript and transcript.status == "done")

    if task.task_type == "analyze":
        audio = session.get(AudioItem, task.audio_id)

        if audio and audio.ai_status == "done" and audio.description_ai:
            return True

        payload = {}
        if task.output_payload:
            try:
                parsed = json.loads(task.output_payload)
                if isinstance(parsed, dict):
                    payload = parsed
            except Exception:
                payload = {}

        return bool(payload.get("description"))

    return False


def recover_interrupted_tasks() -> int:
    """
    恢复 backend 非正常退出前遗留的任务状态。

    in-process worker 无法跨进程恢复正在执行的模型调用：
    - 如果业务结果已经完整落库，恢复为 done
    - running：视为被 backend 重启中断，标记 failed，可在 UI 中 retry
    - cancel_requested：标记 canceled
    """
    recovered = 0

    with Session(db.engine) as session:
        tasks = session.exec(
            select(AITask).where(AITask.status.in_(list(INTERRUPTED_TASK_STATUSES)))
        ).all()

        for task in tasks:
            if task.id is None:
                continue

            if _task_has_completed_output(session, task):
                final_status = "done"
                error_message = None
                task.error_code = None
                task.error_params = None
            elif task.status == "cancel_requested":
                final_status = "canceled"
                error_message = task.error_message
            else:
                final_status = "failed"
                error_message = task.error_message or "Task interrupted by backend restart"
                task.error_code = task.error_code or "task.interrupted"
                task.error_params = task.error_params or "{}"

            task.status = final_status
            task.error_message = error_message
            task.finished_at = task.finished_at or now_iso()
            task.updated_at = now_iso()
            session.add(task)

            _set_audio_task_status_no_commit(
                session,
                task.audio_id,
                task.task_type,
                final_status,
            )

            if final_status == "done":
                rebuild_audio_search_index(session, task.audio_id, commit=False)

            recovered += 1

        if recovered:
            session.commit()
            logger.warning("Recovered interrupted AI/ASR tasks count=%s", recovered)

    return recovered


def finalize_canceled_task(session: Session, task_id: int):
    session.expire_all()
    task = session.get(AITask, task_id)
    if not task:
        return

    task.status = "canceled"
    task.finished_at = task.finished_at or now_iso()
    task.updated_at = now_iso()
    session.add(task)
    session.commit()

    set_audio_task_status(session, task.audio_id, task.task_type, "canceled")


def claim_next_pending_task(session: Session) -> AITask | None:
    return claim_next_pending(session, AITask)
