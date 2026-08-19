import json
from pathlib import Path
from typing import Any

from fastapi.responses import PlainTextResponse, Response
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from ..asr_config import (
    ASR_PROVIDER_EXTERNAL,
    ASR_PROVIDER_FASTER_WHISPER,
    build_asr_task_payload,
)
from ..local_security import ensure_asr_endpoint_allowed
from ..logger import get_logger
from ..models import (
    AgentCitation,
    AITask,
    AudioItem,
    Transcript,
    TranscriptChapter,
    TranscriptIssue,
    TranscriptSegment,
    now_iso,
)
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
from .transcript_validation_service import store_validation_issues
from .whisper_component_service import is_whisper_companion_available


logger = get_logger(__name__)
_SECRET_KEYS = {"api_key", "authorization", "token", "secret", "password"}


def _is_secret_key(key: object) -> bool:
    normalized = str(key).lower()
    return (
        normalized in _SECRET_KEYS
        or normalized.endswith(("_api_key", "_token", "_password", "_secret"))
    )


def _json_summary(value: Any) -> str | None:
    if value is None:
        return None

    def redact(item: Any) -> Any:
        if isinstance(item, dict):
            return {
                str(key): "[redacted]" if _is_secret_key(key) else redact(child)
                for key, child in item.items()
            }
        if isinstance(item, list):
            return [redact(child) for child in item]
        return item

    return json.dumps(redact(value), ensure_ascii=False, sort_keys=True)


def _parsed_json(value: str | None) -> dict | None:
    if not value:
        return None
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _current_transcript(session: Session, audio_id: int) -> Transcript | None:
    return session.exec(
        select(Transcript)
        .where(Transcript.audio_id == audio_id)
        .where(Transcript.is_current.is_(True))
    ).first()


def _revision_segments(session: Session, transcript_id: int) -> list[TranscriptSegment]:
    return list(
        session.exec(
            select(TranscriptSegment)
            .where(TranscriptSegment.transcript_id == transcript_id)
            .order_by(TranscriptSegment.segment_index)
        ).all()
    )


def _revision_chapters(session: Session, transcript_id: int) -> list[TranscriptChapter]:
    return list(
        session.exec(
            select(TranscriptChapter)
            .where(TranscriptChapter.transcript_id == transcript_id)
            .order_by(TranscriptChapter.chapter_index)
        ).all()
    )


def _revision_issues(session: Session, transcript_id: int) -> list[TranscriptIssue]:
    return list(
        session.exec(
            select(TranscriptIssue)
            .where(TranscriptIssue.transcript_id == transcript_id)
            .order_by(TranscriptIssue.created_at, TranscriptIssue.id)
        ).all()
    )


def _transcript_payload(transcript: Transcript) -> dict:
    return {
        **transcript.model_dump(
            exclude={"task_config_json", "quality_metrics_json"}
        ),
        "task_config_summary": _parsed_json(transcript.task_config_json),
        "quality_metrics": _parsed_json(transcript.quality_metrics_json),
    }


def _issue_payload(issue: TranscriptIssue) -> dict:
    return {
        **issue.model_dump(exclude={"evidence_json"}),
        "evidence": _parsed_json(issue.evidence_json) or {},
    }


def _revision_payload(session: Session, transcript: Transcript) -> dict:
    if transcript.id is None:
        raise ServiceError(500, "Transcript revision is not persisted")
    return {
        "transcript": _transcript_payload(transcript),
        "segments": [
            segment.model_dump()
            for segment in _revision_segments(session, transcript.id)
        ],
        "chapters": [
            chapter.model_dump()
            for chapter in _revision_chapters(session, transcript.id)
        ],
        "issues": [
            _issue_payload(issue) for issue in _revision_issues(session, transcript.id)
        ],
    }


def enqueue_transcribe(session: Session, audio_id: int):
    audio = session.get(AudioItem, audio_id)
    if not audio:
        raise ServiceError(404, "Audio not found")
    if audio.transcript_status in BUSY_AUDIO_TASK_STATUSES or get_active_task(
        session, audio_id, "transcribe"
    ):
        raise ServiceError(409, "Transcribe task is already pending, running or canceling")
    if not _mark_audio_missing_if_unavailable(session, audio):
        raise ServiceError(400, "Audio file missing")
    if _find_library_root_id_for_path(session, Path(audio.file_path)) is None:
        raise ServiceError(400, "Audio file path must be within a configured library root")

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
            logger.warning("Transcribe uses non-local ASR endpoint: %s", asr_config["endpoint"])

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
    except IntegrityError as error:
        session.rollback()
        if _is_unique_constraint_error(error):
            raise ServiceError(
                409,
                "Transcribe task is already pending, running or canceling",
            ) from error
        raise
    session.refresh(task)
    return task


def get_transcript(session: Session, audio_id: int) -> dict:
    transcript = _current_transcript(session, audio_id)
    if not transcript:
        raise ServiceError(404, "Transcript not found")
    return _revision_payload(session, transcript)


def list_transcript_revisions(session: Session, audio_id: int) -> list[dict]:
    if not session.get(AudioItem, audio_id):
        raise ServiceError(404, "Audio not found")
    revisions = session.exec(
        select(Transcript)
        .where(Transcript.audio_id == audio_id)
        .order_by(Transcript.revision_number.desc())
    ).all()
    return [_transcript_payload(revision) for revision in revisions]


def get_transcript_revision(
    session: Session,
    audio_id: int,
    revision_id: int,
) -> dict:
    revision = session.get(Transcript, revision_id)
    if not revision or revision.audio_id != audio_id:
        raise ServiceError(404, "Transcript revision not found")
    return _revision_payload(session, revision)


def export_transcript_response(
    session: Session,
    audio_id: int,
    format: str = "txt",
):
    audio = session.get(AudioItem, audio_id)
    if not audio:
        raise ServiceError(404, "Audio not found")
    transcript = _current_transcript(session, audio_id)
    if not transcript:
        raise ServiceError(404, "Transcript not found")
    segments = _revision_segments(session, int(transcript.id))
    base_name = audio.title_user or audio.title_original or audio.file_name

    if format == "json":
        data = {"audio": audio.model_dump(), **_revision_payload(session, transcript)}
        return Response(
            json.dumps(data, ensure_ascii=False, indent=2, default=str),
            media_type="application/json",
            headers=_attachment_headers(f"{base_name}.transcript.json"),
        )
    if format == "srt":
        blocks = [
            f"{index}\n{_srt_time(segment.start_seconds)} --> "
            f"{_srt_time(segment.end_seconds)}\n{segment.text}\n"
            for index, segment in enumerate(segments, start=1)
        ]
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


def _supersede_current_issues(session: Session, transcript_id: int, timestamp: str) -> None:
    for issue in _revision_issues(session, transcript_id):
        if issue.status == "open":
            issue.status = "resolved"
            issue.closed_reason = "revision_superseded"
            issue.updated_at = timestamp
            session.add(issue)


def create_transcript_revision(
    session: Session,
    audio: AudioItem,
    *,
    language: str | None,
    full_text: str,
    model_name: str | None,
    segments: list[dict],
    source_type: str,
    provider_name: str | None = None,
    task_config_summary: dict | None = None,
    glossary_version: str | None = None,
    quality_metrics: dict | None = None,
    expected_updated_at: str | None = None,
) -> Transcript:
    current = _current_transcript(session, int(audio.id))
    if expected_updated_at is not None and (
        current is None or current.updated_at != expected_updated_at
    ):
        raise ServiceError(
            409,
            "Transcript has changed since it was loaded; reload before saving",
        )

    timestamp = now_iso()
    if current:
        current.is_current = False
        current.updated_at = timestamp
        session.add(current)
        _supersede_current_issues(session, int(current.id), timestamp)

    revision = Transcript(
        audio_id=int(audio.id),
        revision_number=(current.revision_number + 1 if current else 1),
        parent_revision_id=int(current.id) if current and current.id is not None else None,
        is_current=True,
        source_type=source_type,
        provider_name=provider_name,
        language=language,
        full_text=full_text,
        model_name=model_name,
        task_config_json=_json_summary(task_config_summary),
        glossary_version=glossary_version,
        quality_metrics_json=_json_summary(quality_metrics),
        status="done",
        generated_at=timestamp,
        accepted_at=timestamp,
        updated_at=timestamp,
    )
    session.add(revision)
    session.flush()
    if revision.id is None:
        raise ServiceError(500, "Failed to create transcript revision")

    stored_segments: list[TranscriptSegment] = []
    for segment in segments:
        row = TranscriptSegment(
            transcript_id=revision.id,
            segment_index=int(segment["segment_index"]),
            start_seconds=float(segment["start_seconds"]),
            end_seconds=float(segment["end_seconds"]),
            text=str(segment["text"]),
        )
        session.add(row)
        stored_segments.append(row)
    session.flush()
    store_validation_issues(session, revision, stored_segments, audio)
    audio.transcript_status = "done"
    audio.updated_at = timestamp
    session.add(audio)
    session.flush()
    rebuild_audio_search_index(session, int(audio.id), commit=False)
    return revision


def save_transcript(session: Session, audio_id: int, payload) -> dict:
    audio = session.get(AudioItem, audio_id)
    if not audio:
        raise ServiceError(404, "Audio not found")
    normalized_text = payload.full_text.strip()
    if not normalized_text:
        raise ServiceError(400, "Transcript text is required")
    try:
        revision = create_transcript_revision(
            session,
            audio,
            language=payload.language,
            full_text=normalized_text,
            model_name=payload.model_name,
            provider_name=payload.provider_name,
            source_type=payload.source_type,
            task_config_summary=payload.task_config_summary,
            glossary_version=payload.glossary_version,
            quality_metrics=payload.quality_metrics,
            segments=[segment.model_dump() for segment in payload.segments],
        )
        session.commit()
        session.refresh(revision)
    except Exception:
        session.rollback()
        raise
    return _revision_payload(session, revision)


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
    transcript = _current_transcript(session, audio_id)
    if not transcript:
        raise ServiceError(404, "Transcript not found")
    if transcript.updated_at != expected_updated_at:
        raise ServiceError(
            409,
            "Transcript has changed since it was loaded; reload before saving",
        )
    return audio, transcript


def update_transcript(
    session: Session,
    audio_id: int,
    full_text: str,
    expected_updated_at: str,
) -> dict:
    audio, current = _editable_transcript(session, audio_id, expected_updated_at)
    normalized_text = full_text.strip()
    if not normalized_text:
        raise ServiceError(400, "Transcript text is required")
    if normalized_text == current.full_text:
        return {**_revision_payload(session, current), "cleared_segments": 0}
    cleared_segments = len(_revision_segments(session, int(current.id)))
    try:
        revision = create_transcript_revision(
            session,
            audio,
            language=current.language,
            full_text=normalized_text,
            model_name=current.model_name,
            provider_name=current.provider_name,
            source_type="manual",
            task_config_summary=_parsed_json(current.task_config_json),
            glossary_version=current.glossary_version,
            quality_metrics=_parsed_json(current.quality_metrics_json),
            segments=[],
            expected_updated_at=expected_updated_at,
        )
        session.commit()
        session.refresh(revision)
    except IntegrityError as error:
        session.rollback()
        raise ServiceError(409, "Transcript changed while saving") from error
    except Exception:
        session.rollback()
        raise
    return {**_revision_payload(session, revision), "cleared_segments": cleared_segments}


def update_transcript_segments(
    session: Session,
    audio_id: int,
    segment_updates,
    expected_updated_at: str,
) -> dict:
    audio, current = _editable_transcript(session, audio_id, expected_updated_at)
    segments = _revision_segments(session, int(current.id))
    if not segments:
        raise ServiceError(409, "Transcript has no timeline segments to edit")
    by_id = {int(segment.id): segment for segment in segments if segment.id is not None}
    requested_ids = [int(item.id) for item in segment_updates]
    if len(requested_ids) != len(set(requested_ids)):
        raise ServiceError(400, "Transcript segment IDs must be unique")

    normalized_updates: dict[int, str] = {}
    for item in segment_updates:
        segment_id = int(item.id)
        if segment_id not in by_id:
            raise ServiceError(404, f"Transcript segment {segment_id} not found")
        normalized = item.text.strip()
        if not normalized:
            raise ServiceError(400, "Transcript segment text is required")
        normalized_updates[segment_id] = normalized
    changed = [
        segment_id
        for segment_id, value in normalized_updates.items()
        if by_id[segment_id].text != value
    ]
    if not changed:
        return {**_revision_payload(session, current), "updated_segments": 0}

    revision_segments = [
        {
            "segment_index": segment.segment_index,
            "start_seconds": segment.start_seconds,
            "end_seconds": segment.end_seconds,
            "text": normalized_updates.get(int(segment.id), segment.text),
        }
        for segment in segments
    ]
    rebuilt = "\n".join(segment["text"].strip() for segment in revision_segments)
    try:
        revision = create_transcript_revision(
            session,
            audio,
            language=current.language,
            full_text=rebuilt,
            model_name=current.model_name,
            provider_name=current.provider_name,
            source_type="manual",
            task_config_summary=_parsed_json(current.task_config_json),
            glossary_version=current.glossary_version,
            quality_metrics=_parsed_json(current.quality_metrics_json),
            segments=revision_segments,
            expected_updated_at=expected_updated_at,
        )
        session.commit()
        session.refresh(revision)
    except IntegrityError as error:
        session.rollback()
        raise ServiceError(409, "Transcript changed while saving") from error
    except Exception:
        session.rollback()
        raise
    return {**_revision_payload(session, revision), "updated_segments": len(changed)}


def revalidate_transcript(session: Session, audio_id: int) -> dict:
    audio = session.get(AudioItem, audio_id)
    revision = _current_transcript(session, audio_id)
    if not audio or not revision:
        raise ServiceError(404, "Transcript not found")
    if revision.id != payload.expected_revision_id:
        raise ServiceError(409, "Transcript revision changed before chapter creation")
    existing = _revision_issues(session, int(revision.id))
    if not existing:
        store_validation_issues(
            session,
            revision,
            _revision_segments(session, int(revision.id)),
            audio,
        )
        session.commit()
    return _revision_payload(session, revision)


def update_transcript_issue(
    session: Session,
    audio_id: int,
    issue_id: int,
    payload,
) -> dict:
    issue = session.get(TranscriptIssue, issue_id)
    if not issue or issue.audio_id != audio_id:
        raise ServiceError(404, "Transcript issue not found")
    if payload.status != "open" and not (payload.closed_reason or "").strip():
        raise ServiceError(400, "A close reason is required")
    issue.status = payload.status
    issue.closed_reason = payload.closed_reason.strip() if payload.closed_reason else None
    issue.updated_at = now_iso()
    session.add(issue)
    session.commit()
    session.refresh(issue)
    return _issue_payload(issue)


def _validate_chapter_bounds(
    audio: AudioItem,
    start_seconds: float,
    end_seconds: float,
) -> None:
    if end_seconds <= start_seconds:
        raise ServiceError(400, "Chapter end must be after its start")
    if audio.duration_seconds is not None and end_seconds > audio.duration_seconds + 0.05:
        raise ServiceError(400, "Chapter exceeds audio duration")


def _reindex_chapters(session: Session, transcript_id: int) -> None:
    chapters = _revision_chapters(session, transcript_id)
    chapters.sort(key=lambda row: (row.start_seconds, row.end_seconds, int(row.id or 0)))
    # Avoid transient unique collisions while rows move in both directions.
    for offset, chapter in enumerate(chapters, start=1):
        chapter.chapter_index = -offset
        session.add(chapter)
    session.flush()
    for index, chapter in enumerate(chapters):
        chapter.chapter_index = index
        session.add(chapter)
    session.flush()


def create_chapter(session: Session, audio_id: int, payload) -> TranscriptChapter:
    audio = session.get(AudioItem, audio_id)
    revision = _current_transcript(session, audio_id)
    if not audio or not revision:
        raise ServiceError(404, "Transcript not found")
    _validate_chapter_bounds(audio, payload.start_seconds, payload.end_seconds)
    chapter = TranscriptChapter(
        transcript_id=int(revision.id),
        chapter_index=len(_revision_chapters(session, int(revision.id))),
        title=payload.title.strip(),
        start_seconds=payload.start_seconds,
        end_seconds=payload.end_seconds,
        source_type="user",
    )
    session.add(chapter)
    session.flush()
    _reindex_chapters(session, int(revision.id))
    session.commit()
    session.refresh(chapter)
    return chapter


def update_chapter(
    session: Session,
    audio_id: int,
    chapter_id: int,
    payload,
) -> TranscriptChapter:
    audio = session.get(AudioItem, audio_id)
    revision = _current_transcript(session, audio_id)
    chapter = session.get(TranscriptChapter, chapter_id)
    if not audio or not revision or not chapter or chapter.transcript_id != revision.id:
        raise ServiceError(404, "Current transcript chapter not found")
    title = payload.title.strip() if payload.title is not None else chapter.title
    start = payload.start_seconds if payload.start_seconds is not None else chapter.start_seconds
    end = payload.end_seconds if payload.end_seconds is not None else chapter.end_seconds
    _validate_chapter_bounds(audio, start, end)
    chapter.title = title
    chapter.start_seconds = start
    chapter.end_seconds = end
    chapter.updated_at = now_iso()
    session.add(chapter)
    session.flush()
    _reindex_chapters(session, int(revision.id))
    session.commit()
    session.refresh(chapter)
    return chapter


def delete_chapter(session: Session, audio_id: int, chapter_id: int) -> dict:
    revision = _current_transcript(session, audio_id)
    chapter = session.get(TranscriptChapter, chapter_id)
    if not revision or not chapter or chapter.transcript_id != revision.id:
        raise ServiceError(404, "Current transcript chapter not found")
    transcript_id = chapter.transcript_id
    session.delete(chapter)
    session.flush()
    _reindex_chapters(session, transcript_id)
    session.commit()
    return {"ok": True}


def merge_chapters(session: Session, audio_id: int, payload) -> TranscriptChapter:
    revision = _current_transcript(session, audio_id)
    if not revision:
        raise ServiceError(404, "Transcript not found")
    ids = list(dict.fromkeys(payload.chapter_ids))
    chapters = list(
        session.exec(
            select(TranscriptChapter)
            .where(TranscriptChapter.transcript_id == revision.id)
            .where(TranscriptChapter.id.in_(ids))
        ).all()
    )
    if len(chapters) != len(ids):
        raise ServiceError(404, "One or more current transcript chapters were not found")
    chapters.sort(key=lambda row: row.start_seconds)
    merged = TranscriptChapter(
        transcript_id=int(revision.id),
        chapter_index=chapters[0].chapter_index,
        title=payload.title.strip() if payload.title else chapters[0].title,
        start_seconds=min(row.start_seconds for row in chapters),
        end_seconds=max(row.end_seconds for row in chapters),
        source_type="user",
    )
    for chapter in chapters:
        session.delete(chapter)
    session.flush()
    session.add(merged)
    session.flush()
    _reindex_chapters(session, int(revision.id))
    session.commit()
    session.refresh(merged)
    return merged


def delete_transcript(session: Session, audio_id: int) -> dict:
    audio = session.get(AudioItem, audio_id)
    if not audio:
        raise ServiceError(404, "Audio not found")
    if audio.transcript_status in BUSY_AUDIO_TASK_STATUSES:
        raise ServiceError(409, "Transcript cannot be deleted while transcription is active")
    revisions = session.exec(
        select(Transcript).where(Transcript.audio_id == audio_id)
    ).all()
    if not revisions:
        raise ServiceError(404, "Transcript not found")
    revision_ids = [int(row.id) for row in revisions if row.id is not None]
    for citation in session.exec(
        select(AgentCitation).where(AgentCitation.transcript_id.in_(revision_ids))
    ).all():
        session.delete(citation)
    for issue in session.exec(
        select(TranscriptIssue).where(TranscriptIssue.transcript_id.in_(revision_ids))
    ).all():
        session.delete(issue)
    for chapter in session.exec(
        select(TranscriptChapter).where(TranscriptChapter.transcript_id.in_(revision_ids))
    ).all():
        session.delete(chapter)
    for segment in session.exec(
        select(TranscriptSegment).where(TranscriptSegment.transcript_id.in_(revision_ids))
    ).all():
        session.delete(segment)
    session.flush()
    # Clear self references before deleting parent revisions in arbitrary order.
    for revision in revisions:
        revision.parent_revision_id = None
        session.add(revision)
    session.flush()
    for revision in revisions:
        session.delete(revision)
    audio.transcript_status = "none"
    audio.updated_at = now_iso()
    session.add(audio)
    session.flush()
    rebuild_audio_search_index(session, audio_id, commit=False)
    session.commit()
    return {"ok": True, "deleted_revisions": len(revisions)}
