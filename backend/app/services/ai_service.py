import json
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from ..asr_config import (
    ASR_PROVIDER_EXTERNAL,
    ASR_PROVIDER_FASTER_WHISPER,
    parse_task_input_payload,
    resolve_asr_task_config,
)
from ..ai_client import call_openai_compatible_chat, get_ai_message_content
from ..local_security import (
    _llm_privacy_warning,
    ensure_asr_endpoint_allowed,
    ensure_llm_endpoint_allowed,
)
from ..logger import get_logger
from ..models import AITask, AudioItem, Setting, now_iso
from ..tasks import get_active_task
from .common import BUSY_AUDIO_TASK_STATUSES, ServiceError, _is_unique_constraint_error
from .whisper_component_service import is_whisper_companion_available


logger = get_logger(__name__)


def enqueue_analyze(session: Session, audio_id: int) -> dict:
    audio = session.get(AudioItem, audio_id)
    if not audio:
        raise ServiceError(404, "Audio not found")

    if audio.ai_status in BUSY_AUDIO_TASK_STATUSES:
        raise ServiceError(409, "Analyze task is already pending, running or canceling")

    if get_active_task(session, audio_id, "analyze"):
        raise ServiceError(409, "Analyze task is already pending, running or canceling")

    endpoint = session.get(Setting, "llm.endpoint")
    model_name = session.get(Setting, "llm.model_name")

    if not endpoint or not endpoint.value or not model_name or not model_name.value:
        raise ServiceError(400, "LLM endpoint or model_name is not configured")

    warning = ensure_llm_endpoint_allowed(session, endpoint.value)
    if warning:
        logger.warning("Analyze uses non-local LLM endpoint: %s", endpoint.value)

    task = AITask(
        audio_id=audio_id,
        task_type="analyze",
        status="pending",
        input_payload=json.dumps({}, ensure_ascii=False),
        updated_at=now_iso(),
    )

    audio.ai_status = "pending"
    audio.updated_at = now_iso()

    session.add(audio)
    session.add(task)

    try:
        session.commit()
    except IntegrityError as e:
        session.rollback()

        if _is_unique_constraint_error(e):
            raise ServiceError(
                409,
                "Analyze task is already pending, running or canceling",
            ) from e

        raise

    session.refresh(task)

    return {
        **task.model_dump(),
        "privacy_warning": warning,
        "privacy_warning_code": "llm.remote" if warning else None,
    }


async def test_llm_config(payload) -> dict:
    if not payload.endpoint or not payload.model_name:
        raise ServiceError(400, "endpoint and model_name are required")

    warning = _llm_privacy_warning(payload.endpoint)

    try:
        response = await call_openai_compatible_chat(
            endpoint=payload.endpoint,
            model_name=payload.model_name,
            api_key=payload.api_key or None,
            timeout=payload.timeout,
            max_tokens=payload.max_tokens or 64,
            temperature=payload.temperature if payload.temperature is not None else 0,
            messages=[
                {
                    "role": "system",
                    "content": "You are a connection test assistant. Reply briefly.",
                },
                {
                    "role": "user",
                    "content": "Return exactly: ok",
                },
            ],
        )

        content = get_ai_message_content(response)

        return {
            "ok": True,
            "content": content,
            "is_local_endpoint": warning is None,
            "privacy_warning": warning,
            "privacy_warning_code": "llm.remote" if warning else None,
        }

    except Exception as e:
        raise ServiceError(400, str(e)) from e


def list_ai_tasks(
    session: Session,
    status: Optional[str] = None,
    task_type: Optional[str] = None,
    audio_id: Optional[int] = None,
    limit: int = 100,
    offset: int = 0,
) -> list[AITask]:
    stmt = select(AITask)

    if status:
        stmt = stmt.where(AITask.status == status)

    if task_type:
        stmt = stmt.where(AITask.task_type == task_type)

    if audio_id is not None:
        stmt = stmt.where(AITask.audio_id == audio_id)

    stmt = stmt.order_by(AITask.created_at.desc()).offset(offset).limit(limit)
    return session.exec(stmt).all()


def get_ai_task(session: Session, task_id: int) -> AITask:
    task = session.get(AITask, task_id)
    if not task:
        raise ServiceError(404, "Task not found")
    return task


def retry_ai_task(session: Session, task_id: int) -> AITask:
    task = session.get(AITask, task_id)
    if not task:
        raise ServiceError(404, "Task not found")

    if task.status not in ["failed", "canceled"]:
        raise ServiceError(400, "Only failed/canceled task can be retried")

    if get_active_task(session, task.audio_id, task.task_type, exclude_task_id=task.id):
        raise ServiceError(409, "Another task is already active")

    if task.task_type == "analyze":
        endpoint = session.get(Setting, "llm.endpoint")
        model_name = session.get(Setting, "llm.model_name")

        if not endpoint or not endpoint.value or not model_name or not model_name.value:
            raise ServiceError(400, "LLM endpoint or model_name is not configured")

        warning = ensure_llm_endpoint_allowed(session, endpoint.value)
        if warning:
            logger.warning("Retry analyze uses non-local LLM endpoint: %s", endpoint.value)

    if task.task_type == "transcribe":
        try:
            current_payload = parse_task_input_payload(task.input_payload)
            asr_config = resolve_asr_task_config(current_payload)
        except ValueError as e:
            raise ServiceError(400, str(e)) from e

        if asr_config["provider"] == ASR_PROVIDER_EXTERNAL:
            warning = ensure_asr_endpoint_allowed(session, asr_config["endpoint"])
            if warning:
                logger.warning(
                    "Retry transcribe uses non-local ASR endpoint: %s",
                    asr_config["endpoint"],
                )
        elif (
            asr_config["provider"] == ASR_PROVIDER_FASTER_WHISPER
            and not is_whisper_companion_available()
        ):
            raise ServiceError(
                409,
                "Whisper component is not installed. Install it from Settings > ASR.",
            )

        task.input_payload = json.dumps({"asr": asr_config}, ensure_ascii=False)

    task.status = "pending"
    task.retry_count += 1
    task.error_message = None
    task.error_code = None
    task.error_params = None
    task.output_payload = None
    task.started_at = None
    task.finished_at = None
    task.updated_at = now_iso()
    session.add(task)

    audio = session.get(AudioItem, task.audio_id)
    if audio:
        if task.task_type == "transcribe":
            audio.transcript_status = "pending"
        if task.task_type == "analyze":
            audio.ai_status = "pending"

        audio.updated_at = now_iso()
        session.add(audio)

    try:
        session.commit()
    except IntegrityError as e:
        session.rollback()

        if _is_unique_constraint_error(e):
            raise ServiceError(409, "Another task is already active") from e

        raise

    session.refresh(task)
    return task


def cancel_ai_task(session: Session, task_id: int) -> AITask:
    task = session.get(AITask, task_id)
    if not task:
        raise ServiceError(404, "Task not found")

    if task.status in ["done", "failed", "canceled"]:
        raise ServiceError(400, "Task cannot be canceled")

    if task.status == "cancel_requested":
        return task

    task.updated_at = now_iso()

    if task.status == "running":
        task.status = "cancel_requested"
        audio_status = "cancel_requested"
    else:
        task.status = "canceled"
        task.finished_at = now_iso()
        audio_status = "canceled"

    session.add(task)

    audio = session.get(AudioItem, task.audio_id)
    if audio:
        if task.task_type == "transcribe":
            audio.transcript_status = audio_status
        if task.task_type == "analyze":
            audio.ai_status = audio_status

        audio.updated_at = now_iso()
        session.add(audio)

    session.commit()
    session.refresh(task)
    return task
