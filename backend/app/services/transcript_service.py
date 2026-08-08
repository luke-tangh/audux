import json
from pathlib import Path

from fastapi.responses import PlainTextResponse, Response
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from ..asr_config import (
    ASR_PROVIDER_EXTERNAL,
    ASR_PROVIDER_FASTER_WHISPER,
    build_asr_task_payload,
)
from ..local_security import ensure_asr_endpoint_allowed
from ..logger import get_logger
from ..models import AITask, AudioItem, Transcript, TranscriptSegment, now_iso
from ..search import rebuild_audio_search_index
from ..tasks import get_active_task
from .common import (
    BUSY_AUDIO_TASK_STATUSES,
    ServiceError,
    _attachment_headers,
    _find_library_root_id_for_path,
    _is_unique_constraint_error,
    _mark_audio_missing_if_unavailable,
    _srt_time,
)
from .whisper_component_service import is_whisper_companion_available


logger = get_logger(__name__)


def enqueue_transcribe(session: Session, audio_id: int):
    audio = session.get(AudioItem, audio_id)
    if not audio:
        raise ServiceError(404, "Audio not found")

    if audio.transcript_status in BUSY_AUDIO_TASK_STATUSES:
        raise ServiceError(409, "Transcribe task is already pending, running or canceling")

    if get_active_task(session, audio_id, "transcribe"):
        raise ServiceError(409, "Transcribe task is already pending, running or canceling")

    if not _mark_audio_missing_if_unavailable(session, audio):
        raise ServiceError(400, "Audio file missing")

    if _find_library_root_id_for_path(session, Path(audio.file_path)) is None:
        raise ServiceError(
            400,
            "Audio file path must be within a configured library root",
        )

    try:
        input_payload = build_asr_task_payload(session)
    except ValueError as e:
        raise ServiceError(400, str(e)) from e

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
                "Transcribe uses non-local ASR endpoint: %s",
                asr_config["endpoint"],
            )

    task = AITask(
        audio_id=audio_id,
        task_type="transcribe",
        status="pending",
        input_payload=json.dumps(input_payload, ensure_ascii=False),
        updated_at=now_iso(),
    )

    audio.transcript_status = "pending"
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
                "Transcribe task is already pending, running or canceling",
            ) from e

        raise

    session.refresh(task)
    return task


def get_transcript(session: Session, audio_id: int) -> dict:
    transcript = session.exec(
        select(Transcript).where(Transcript.audio_id == audio_id)
    ).first()

    if not transcript:
        raise ServiceError(404, "Transcript not found")

    segments = session.exec(
        select(TranscriptSegment)
        .where(TranscriptSegment.transcript_id == transcript.id)
        .order_by(TranscriptSegment.segment_index)
    ).all()

    return {
        "transcript": transcript,
        "segments": segments,
    }


def export_transcript_response(
    session: Session,
    audio_id: int,
    format: str = "txt",
):
    audio = session.get(AudioItem, audio_id)
    if not audio:
        raise ServiceError(404, "Audio not found")

    transcript = session.exec(
        select(Transcript).where(Transcript.audio_id == audio_id)
    ).first()

    if not transcript:
        raise ServiceError(404, "Transcript not found")

    segments = session.exec(
        select(TranscriptSegment)
        .where(TranscriptSegment.transcript_id == transcript.id)
        .order_by(TranscriptSegment.segment_index)
    ).all()

    base_name = audio.title_user or audio.title_original or audio.file_name

    if format == "json":
        data = {
            "audio": audio.model_dump(),
            "transcript": transcript.model_dump(),
            "segments": [seg.model_dump() for seg in segments],
        }

        return Response(
            json.dumps(data, ensure_ascii=False, indent=2),
            media_type="application/json",
            headers=_attachment_headers(f"{base_name}.transcript.json"),
        )

    if format == "srt":
        blocks = []
        for idx, seg in enumerate(segments, start=1):
            blocks.append(
                f"{idx}\n"
                f"{_srt_time(seg.start_seconds)} --> {_srt_time(seg.end_seconds)}\n"
                f"{seg.text}\n"
            )

        return PlainTextResponse(
            "\n".join(blocks),
            media_type="application/x-subrip",
            headers=_attachment_headers(f"{base_name}.srt"),
        )

    return PlainTextResponse(
        transcript.full_text,
        media_type="text/plain; charset=utf-8",
        headers=_attachment_headers(f"{base_name}.txt"),
    )


def save_transcript(session: Session, audio_id: int, payload) -> Transcript:
    audio = session.get(AudioItem, audio_id)
    if not audio:
        raise ServiceError(404, "Audio not found")

    existing = session.exec(
        select(Transcript).where(Transcript.audio_id == audio_id)
    ).first()

    if existing:
        old_segments = session.exec(
            select(TranscriptSegment).where(
                TranscriptSegment.transcript_id == existing.id
            )
        ).all()

        for seg in old_segments:
            session.delete(seg)

        session.delete(existing)
        session.flush()

    transcript = Transcript(
        audio_id=audio_id,
        language=payload.language,
        full_text=payload.full_text,
        model_name=payload.model_name,
        status="done",
        generated_at=now_iso(),
        updated_at=now_iso(),
    )
    session.add(transcript)
    session.flush()

    if transcript.id is None:
        raise ServiceError(500, "Failed to create transcript")

    for seg in payload.segments:
        session.add(
            TranscriptSegment(
                transcript_id=transcript.id,
                segment_index=seg.segment_index,
                start_seconds=seg.start_seconds,
                end_seconds=seg.end_seconds,
                text=seg.text,
            )
        )

    audio.transcript_status = "done"
    audio.updated_at = now_iso()
    session.add(audio)
    session.commit()
    session.refresh(transcript)

    rebuild_audio_search_index(session, audio_id)

    return transcript


def _editable_transcript(
    session: Session,
    audio_id: int,
    expected_updated_at: str,
) -> tuple[AudioItem, Transcript]:
    audio = session.get(AudioItem, audio_id)
    if not audio:
        raise ServiceError(404, "Audio not found")

    if audio.transcript_status in BUSY_AUDIO_TASK_STATUSES:
        raise ServiceError(409, "Transcript cannot be edited while transcription is active")

    transcript = session.exec(
        select(Transcript).where(Transcript.audio_id == audio_id)
    ).first()
    if not transcript:
        raise ServiceError(404, "Transcript not found")

    if transcript.updated_at != expected_updated_at:
        raise ServiceError(
            409,
            "Transcript has changed since it was loaded; reload before saving",
        )

    return audio, transcript


def _claim_transcript_version(
    session: Session,
    transcript: Transcript,
    expected_updated_at: str,
    new_updated_at: str,
    full_text: str,
) -> None:
    result = session.execute(
        update(Transcript)
        .where(Transcript.id == transcript.id)
        .where(Transcript.updated_at == expected_updated_at)
        .values(full_text=full_text, updated_at=new_updated_at)
    )

    if result.rowcount != 1:
        session.rollback()
        raise ServiceError(
            409,
            "Transcript has changed since it was loaded; reload before saving",
        )


def update_transcript(
    session: Session,
    audio_id: int,
    full_text: str,
    expected_updated_at: str,
) -> dict:
    audio, transcript = _editable_transcript(
        session,
        audio_id,
        expected_updated_at,
    )

    normalized_text = full_text.strip()
    if not normalized_text:
        raise ServiceError(400, "Transcript text is required")

    segments = session.exec(
        select(TranscriptSegment).where(
            TranscriptSegment.transcript_id == transcript.id
        )
    ).all()

    if normalized_text == transcript.full_text:
        return {
            "transcript": transcript,
            "segments": segments,
            "cleared_segments": 0,
        }

    updated_at = now_iso()

    try:
        _claim_transcript_version(
            session,
            transcript,
            expected_updated_at,
            updated_at,
            normalized_text,
        )

        for segment in segments:
            session.delete(segment)

        audio.transcript_status = "done"
        audio.updated_at = updated_at
        session.add(audio)
        session.flush()

        rebuild_audio_search_index(session, audio_id, commit=False)
        session.commit()
        session.refresh(transcript)
    except ServiceError:
        raise
    except Exception:
        session.rollback()
        raise

    return {
        "transcript": transcript,
        "segments": [],
        "cleared_segments": len(segments),
    }


def update_transcript_segments(
    session: Session,
    audio_id: int,
    segment_updates,
    expected_updated_at: str,
) -> dict:
    audio, transcript = _editable_transcript(
        session,
        audio_id,
        expected_updated_at,
    )

    segments = session.exec(
        select(TranscriptSegment)
        .where(TranscriptSegment.transcript_id == transcript.id)
        .order_by(TranscriptSegment.segment_index)
    ).all()
    if not segments:
        raise ServiceError(409, "Transcript has no timeline segments to edit")

    segment_by_id = {
        int(segment.id): segment
        for segment in segments
        if segment.id is not None
    }
    requested_ids = [int(update_item.id) for update_item in segment_updates]
    if len(requested_ids) != len(set(requested_ids)):
        raise ServiceError(400, "Transcript segment IDs must be unique")

    normalized_updates: dict[int, str] = {}
    for update_item in segment_updates:
        segment_id = int(update_item.id)
        if segment_id not in segment_by_id:
            raise ServiceError(404, f"Transcript segment {segment_id} not found")

        normalized_text = update_item.text.strip()
        if not normalized_text:
            raise ServiceError(400, "Transcript segment text is required")

        normalized_updates[segment_id] = normalized_text

    changed_segments = [
        segment
        for segment_id, segment in segment_by_id.items()
        if segment_id in normalized_updates
        and segment.text != normalized_updates[segment_id]
    ]

    if not changed_segments:
        return {
            "transcript": transcript,
            "segments": segments,
            "updated_segments": 0,
        }

    full_text = "\n".join(
        normalized_updates.get(int(segment.id), segment.text.strip())
        for segment in segments
        if segment.id is not None
    )
    updated_at = now_iso()

    try:
        _claim_transcript_version(
            session,
            transcript,
            expected_updated_at,
            updated_at,
            full_text,
        )

        for segment in changed_segments:
            segment.text = normalized_updates[int(segment.id)]
            session.add(segment)

        audio.transcript_status = "done"
        audio.updated_at = updated_at
        session.add(audio)
        session.flush()

        rebuild_audio_search_index(session, audio_id, commit=False)
        session.commit()
        session.refresh(transcript)

        stored_segments = session.exec(
            select(TranscriptSegment)
            .where(TranscriptSegment.transcript_id == transcript.id)
            .order_by(TranscriptSegment.segment_index)
        ).all()
    except ServiceError:
        raise
    except Exception:
        session.rollback()
        raise

    return {
        "transcript": transcript,
        "segments": stored_segments,
        "updated_segments": len(changed_segments),
    }
