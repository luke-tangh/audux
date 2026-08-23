"""Batch AI/ASR task admission for audio items."""

import json
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from ..asr_config import (
    ASR_PROVIDER_EXTERNAL,
    ASR_PROVIDER_FASTER_WHISPER,
    build_asr_task_payload,
)
from ..local_security import ensure_asr_endpoint_allowed, ensure_llm_endpoint_allowed
from ..logger import get_logger
from ..models import AITask, AudioItem, Setting, now_iso
from ..task_repository import get_active_task
from .errors import ServiceError
from .media_paths import mark_audio_missing_if_unavailable_no_commit
from .task_state import BUSY_AUDIO_TASK_STATUSES, is_unique_constraint_error
from .whisper_component_service import is_whisper_companion_available


logger = get_logger(__name__)


def _enqueue_tasks(
    session: Session,
    audio_ids: list[int],
    *,
    task_type: str,
    status_attribute: str,
    input_payload: dict[str, Any],
    require_available_file: bool,
) -> dict:
    created_task_ids: list[int] = []
    skipped: list[int] = []
    errors: list[dict] = []
    seen_audio_ids: set[int] = set()

    for audio_id in audio_ids:
        if audio_id in seen_audio_ids:
            skipped.append(audio_id)
            continue
        seen_audio_ids.add(audio_id)

        try:
            with session.begin_nested():
                audio = session.get(AudioItem, audio_id)
                if not audio:
                    errors.append({"audio_id": audio_id, "error": "Audio not found"})
                    continue
                if getattr(audio, status_attribute) in BUSY_AUDIO_TASK_STATUSES:
                    skipped.append(audio_id)
                    continue
                if get_active_task(session, audio_id, task_type):
                    skipped.append(audio_id)
                    continue
                if require_available_file and not mark_audio_missing_if_unavailable_no_commit(
                    session, audio
                ):
                    errors.append({"audio_id": audio_id, "error": "Audio file missing"})
                    continue

                setattr(audio, status_attribute, "pending")
                audio.updated_at = now_iso()
                session.add(audio)

                task = AITask(
                    audio_id=audio_id,
                    task_type=task_type,
                    status="pending",
                    input_payload=json.dumps(input_payload, ensure_ascii=False),
                    updated_at=now_iso(),
                )
                session.add(task)
                session.flush()
                if task.id is not None:
                    created_task_ids.append(int(task.id))
        except IntegrityError as error:
            if is_unique_constraint_error(error):
                skipped.append(audio_id)
                continue
            raise

    session.commit()
    logger.info(
        "Batch %s created=%s skipped=%s",
        task_type,
        len(created_task_ids),
        len(skipped),
    )
    return {
        "created": len(created_task_ids),
        "skipped": len(skipped),
        "errors": errors,
        "task_ids": created_task_ids,
    }


def batch_transcribe(session: Session, audio_ids: list[int]) -> dict:
    try:
        input_payload = build_asr_task_payload(session)
    except ValueError as error:
        raise ServiceError(400, str(error)) from error

    asr_config = input_payload["asr"]
    if (
        asr_config["provider"] == ASR_PROVIDER_FASTER_WHISPER
        and not is_whisper_companion_available()
    ):
        raise ServiceError(
            409,
            "Whisper component is not installed. Install it from Settings > ASR.",
        )
    if asr_config["provider"] == ASR_PROVIDER_EXTERNAL:
        warning = ensure_asr_endpoint_allowed(session, asr_config["endpoint"])
        if warning:
            logger.warning(
                "Batch transcribe uses non-local ASR endpoint: %s",
                asr_config["endpoint"],
            )

    return _enqueue_tasks(
        session,
        audio_ids,
        task_type="transcribe",
        status_attribute="transcript_status",
        input_payload=input_payload,
        require_available_file=True,
    )


def batch_analyze(session: Session, audio_ids: list[int]) -> dict:
    endpoint = session.get(Setting, "llm.endpoint")
    model_name = session.get(Setting, "llm.model_name")
    if not endpoint or not endpoint.value or not model_name or not model_name.value:
        raise ServiceError(400, "LLM endpoint or model_name is not configured")

    warning = ensure_llm_endpoint_allowed(session, endpoint.value)
    if warning:
        logger.warning("Batch analyze uses non-local LLM endpoint: %s", endpoint.value)

    result = _enqueue_tasks(
        session,
        audio_ids,
        task_type="analyze",
        status_attribute="ai_status",
        input_payload={},
        require_available_file=False,
    )
    return {
        **result,
        "privacy_warning": warning,
        "privacy_warning_code": "llm.remote" if warning else None,
    }
