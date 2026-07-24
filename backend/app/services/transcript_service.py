import json

from fastapi.responses import PlainTextResponse, Response
from sqlmodel import Session, select

from ..models import AudioItem, Transcript, TranscriptSegment, now_iso
from ..search import rebuild_audio_search_index
from ..tasks import ActiveTaskConflict, create_task, get_active_task
from .common import (
    BUSY_AUDIO_TASK_STATUSES,
    ServiceError,
    _attachment_headers,
    _mark_audio_missing_if_unavailable,
    _srt_time,
)


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

    audio.transcript_status = "pending"
    audio.updated_at = now_iso()
    session.add(audio)
    session.commit()

    try:
        task = create_task(session, audio_id, "transcribe")
    except ActiveTaskConflict as e:
        raise ServiceError(409, "Transcribe task is already pending, running or canceling") from e

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
