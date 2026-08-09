import json
import mimetypes
import re
from pathlib import Path
from typing import Optional
from urllib.parse import quote

from sqlalchemy import and_, func, or_
from sqlmodel import Session, select

from ..db import COVERS_DIR
from ..models import (
    AudioItem,
    AudioTag,
    LibraryRoot,
    ScanTask,
    Tag,
    Transcript,
    TranscriptSegment,
    now_iso,
)
from ..search import rebuild_audio_search_index, search_audio_ids


AUDIO_MIME_TYPES = {
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".flac": "audio/flac",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
}

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}

BUSY_AUDIO_TASK_STATUSES = {"pending", "running", "cancel_requested"}
ACTIVE_SCAN_TASK_STATUSES = {"pending", "running", "cancel_requested"}

SAFE_DOWNLOAD_NAME_PATTERN = re.compile(r'[\r\n\\/"<>|:*?]+')


ERROR_CODE_BY_DETAIL = {
    "Audio not found": "audio.not_found",
    "Audio item not found": "audio.not_found",
    "Audio file missing": "audio.file_missing",
    "Audio file path must be within a configured library root": "audio.outside_library",
    "Invalid audio file path": "audio.invalid_path",
    "Unsupported audio format": "audio.unsupported_format",
    "Another audio item already uses this file path": "audio.path_in_use",
    "Cover not found": "cover.not_found",
    "Cover file missing": "cover.file_missing",
    "Unsupported image format": "cover.unsupported_format",
    "Empty cover file": "cover.empty",
    "Cover file is too large": "cover.too_large",
    "Transcript not found": "transcript.not_found",
    "Transcribe task is already pending, running or canceling": "transcript.task_active",
    "Transcript cannot be edited while transcription is active": "transcript.edit_active",
    "Transcript has changed since it was loaded; reload before saving": "transcript.conflict",
    "Transcript text is required": "transcript.text_required",
    "Transcript has no timeline segments to edit": "transcript.no_segments",
    "Transcript segment IDs must be unique": "transcript.duplicate_segments",
    "Transcript segment text is required": "transcript.segment_text_required",
    "Failed to create transcript": "transcript.create_failed",
    "Playlist name is required": "playlist.name_required",
    "Playlist not found": "playlist.not_found",
    "Playlist item not found": "playlist.item_not_found",
    "Duplicate playlist item ids": "playlist.duplicate_items",
    "item_ids must exactly match current playlist items": "playlist.items_mismatch",
    "Tag not found": "tag.not_found",
    "Tag name is required": "tag.name_required",
    "Tag name already exists": "tag.name_exists",
    "Tag is still used by audio items": "tag.in_use",
    "Source and target tags must be different": "tag.same_source_target",
    "Source tag not found": "tag.source_not_found",
    "Target tag not found": "tag.target_not_found",
    "Audio tag relation not found": "tag.relation_not_found",
    "At least one tag name is required": "tag.at_least_one",
    "Invalid directory": "library.invalid_directory",
    "Library root already exists": "library.root_exists",
    "Library root not found": "library.root_not_found",
    "Cancel or finish the active scan task before removing this library root": "library.scan_active_remove",
    "Scan task is already pending or running for this library root": "library.scan_active",
    "Scan task not found": "library.scan_not_found",
    "Scan task cannot be canceled": "library.scan_cannot_cancel",
    "Analyze task is already pending, running or canceling": "ai.task_active",
    "LLM endpoint or model_name is not configured": "ai.not_configured",
    "endpoint and model_name are required": "ai.endpoint_model_required",
    "Task not found": "task.not_found",
    "Only failed/canceled task can be retried": "task.cannot_retry",
    "Another task is already active": "task.active",
    "Task cannot be canceled": "task.cannot_cancel",
    "Whisper component is not installed. Install it from Settings > ASR.": "asr.component_missing",
    "Whisper component installation is already running": "asr.install_active",
    "Whisper component installation is not running": "asr.install_inactive",
    "Cancel the Whisper component installation first": "asr.cancel_install_first",
    "Whisper component is in use by an active task": "asr.component_in_use",
    "Log file not found": "logs.not_found",
    "is_favorite is required": "batch.favorite_required",
    "Unsupported batch organization action": "batch.unsupported_action",
}


def error_code_for_detail(detail: str) -> str:
    if detail.startswith("Transcript segment ") and detail.endswith(" not found"):
        return "transcript.segment_not_found"
    if detail.startswith("Failed to delete file:"):
        return "audio.delete_file_failed"
    if detail.startswith("Tags not found:"):
        return "tag.not_found"
    if detail.startswith("Unsupported Whisper component platform:"):
        return "asr.unsupported_platform"
    return ERROR_CODE_BY_DETAIL.get(detail, "common.request_failed")


class ServiceError(Exception):
    def __init__(
        self,
        status_code: int,
        detail: str,
        code: str | None = None,
        params: dict | None = None,
    ):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.code = code or error_code_for_detail(detail)
        self.params = params or {}

    def structured_detail(self) -> dict:
        return {
            "code": self.code,
            "params": self.params,
            "fallback": self.detail,
        }


def _apply_enabled_roots_filter(
    stmt,
    session: Session,
    include_disabled_roots: bool = False,
):
    if include_disabled_roots:
        return stmt

    enabled_root_ids = session.exec(
        select(LibraryRoot.id).where(LibraryRoot.is_enabled == True)
    ).all()

    if not enabled_root_ids:
        return stmt.where(AudioItem.library_root_id == None)

    return stmt.where(
        or_(
            AudioItem.library_root_id == None,
            AudioItem.library_root_id.in_(enabled_root_ids),
        )
    )


def _find_library_root_id_for_path(session: Session, file_path: Path) -> Optional[int]:
    resolved_file = file_path.expanduser().resolve()
    roots = session.exec(select(LibraryRoot)).all()

    best_root_id: Optional[int] = None
    best_len = -1

    for root in roots:
        if root.id is None:
            continue

        try:
            root_path = Path(root.path).expanduser().resolve()
            resolved_file.relative_to(root_path)

            root_len = len(str(root_path))
            if root_len > best_len:
                best_root_id = root.id
                best_len = root_len
        except Exception:
            continue

    return best_root_id


def _mark_audio_missing_if_unavailable(session: Session, audio: AudioItem) -> bool:
    path = Path(audio.file_path)

    if path.exists() and path.is_file():
        if audio.is_missing:
            audio.is_missing = False
            audio.updated_at = now_iso()
            session.add(audio)
            session.commit()
            session.refresh(audio)

        return True

    if not audio.is_missing:
        audio.is_missing = True
        audio.updated_at = now_iso()
        session.add(audio)
        session.commit()
        session.refresh(audio)

    return False


def _mark_audio_missing_if_unavailable_no_commit(
    session: Session,
    audio: AudioItem,
) -> bool:
    path = Path(audio.file_path)

    if path.exists() and path.is_file():
        if audio.is_missing:
            audio.is_missing = False
            audio.updated_at = now_iso()
            session.add(audio)

        return True

    if not audio.is_missing:
        audio.is_missing = True
        audio.updated_at = now_iso()
        session.add(audio)

    return False


def _parse_task_output_payload(value: Optional[str]) -> dict:
    if not value:
        return {}

    try:
        parsed = json.loads(value)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass

    return {}


def _is_unique_constraint_error(error) -> bool:
    message = str(getattr(error, "orig", error)).lower()
    return (
        "unique constraint failed" in message
        or "ux_ai_tasks_active" in message
        or "ux_scan_tasks_active_root" in message
    )


def _get_active_scan_task(
    session: Session,
    root_id: int,
) -> Optional[ScanTask]:
    return session.exec(
        select(ScanTask)
        .where(ScanTask.root_id == root_id)
        .where(ScanTask.status.in_(list(ACTIVE_SCAN_TASK_STATUSES)))
        .order_by(ScanTask.created_at)
    ).first()


def _safe_download_name(name: str) -> str:
    safe = SAFE_DOWNLOAD_NAME_PATTERN.sub("_", name).strip()
    return (safe or "download")[:180]


def _attachment_headers(filename: str) -> dict:
    filename = _safe_download_name(filename)
    return {
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
    }


def _srt_time(seconds: float) -> str:
    total_ms = max(0, int(round(seconds * 1000)))
    ms = total_ms % 1000
    total = total_ms // 1000
    s = total % 60
    m = (total // 60) % 60
    h = total // 3600
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _cover_media_type(path: Path) -> str:
    guessed = mimetypes.guess_type(str(path))[0]
    return guessed or "image/jpeg"


def _delete_managed_cover_file(path_value: Optional[str]):
    if not path_value:
        return

    try:
        cover_path = Path(path_value)
        if cover_path.exists() and cover_path.parent.resolve() == COVERS_DIR.resolve():
            cover_path.unlink()
    except Exception:
        pass


def _tags_for_audio(session: Session, audio_id: int) -> list[Tag]:
    return session.exec(
        select(Tag)
        .join(AudioTag, AudioTag.tag_id == Tag.id)
        .where(AudioTag.audio_id == audio_id)
        .order_by(Tag.name)
    ).all()


def _tags_by_audio_id(session: Session, audio_ids: list[int]) -> dict[int, list[Tag]]:
    if not audio_ids:
        return {}

    result: dict[int, list[Tag]] = {audio_id: [] for audio_id in audio_ids}

    rows = session.exec(
        select(AudioTag.audio_id, Tag)
        .join(Tag, AudioTag.tag_id == Tag.id)
        .where(AudioTag.audio_id.in_(audio_ids))
        .order_by(AudioTag.audio_id, Tag.name)
    ).all()

    for audio_id, tag in rows:
        result.setdefault(int(audio_id), []).append(tag)

    return result


def _escape_sql_like_token(value: str) -> str:
    return (
        value
        .replace("\\", "\\\\")
        .replace("%", "\\%")
        .replace("_", "\\_")
    )


def _query_tokens(q: Optional[str]) -> list[str]:
    if not q:
        return []

    tokens = [x.strip().lower() for x in q.split() if x.strip()]
    if tokens:
        return tokens

    q = q.strip().lower()
    return [q] if q else []


def _text_matches_tokens(text_value: Optional[str], tokens: list[str]) -> bool:
    if not text_value or not tokens:
        return False

    lower = text_value.lower()
    return any(token in lower for token in tokens)


def _shorten_hit_text(text_value: str, tokens: list[str], max_len: int = 220) -> str:
    text_value = text_value.strip()
    if len(text_value) <= max_len:
        return text_value

    lower = text_value.lower()
    first_pos = -1

    for token in tokens:
        pos = lower.find(token)
        if pos >= 0 and (first_pos < 0 or pos < first_pos):
            first_pos = pos

    if first_pos < 0:
        return text_value[:max_len].rstrip() + "..."

    start = max(0, first_pos - 80)
    end = min(len(text_value), start + max_len)

    snippet = text_value[start:end].strip()

    if start > 0:
        snippet = "..." + snippet

    if end < len(text_value):
        snippet = snippet + "..."

    return snippet


def _add_search_hit(
    hits: list[dict],
    field: str,
    label: str,
    text_value: Optional[str],
    tokens: list[str],
    start_seconds: Optional[float] = None,
    end_seconds: Optional[float] = None,
    segment_index: Optional[int] = None,
    context_before: Optional[str] = None,
    context_after: Optional[str] = None,
    limit: int = 6,
):
    if len(hits) >= limit:
        return

    if not text_value:
        return

    if not _text_matches_tokens(text_value, tokens):
        return

    hit = {
        "field": field,
        "label": label,
        "text": _shorten_hit_text(text_value, tokens),
    }

    if start_seconds is not None:
        hit["start_seconds"] = start_seconds

    if end_seconds is not None:
        hit["end_seconds"] = end_seconds

    if segment_index is not None:
        hit["segment_index"] = segment_index

    if context_before:
        hit["context_before"] = context_before

    if context_after:
        hit["context_after"] = context_after

    hits.append(hit)


def _matching_transcript_segments_by_transcript_ids(
    session: Session,
    transcript_ids: list[int],
    tokens: list[str],
    per_transcript_limit: int = 3,
) -> dict[int, list[TranscriptSegment]]:
    result: dict[int, list[TranscriptSegment]] = {
        transcript_id: [] for transcript_id in transcript_ids
    }

    if not transcript_ids or not tokens:
        return result

    conditions = [
        func.lower(TranscriptSegment.text).like(
            f"%{_escape_sql_like_token(token.lower())}%",
            escape="\\",
        )
        for token in tokens
        if token
    ]

    if not conditions:
        return result

    rows = session.exec(
        select(TranscriptSegment)
        .where(TranscriptSegment.transcript_id.in_(transcript_ids))
        .where(and_(*conditions))
        .order_by(TranscriptSegment.transcript_id, TranscriptSegment.segment_index)
    ).all()

    matching_by_transcript_id: dict[int, list[TranscriptSegment]] = {
        transcript_id: [] for transcript_id in transcript_ids
    }

    for segment in rows:
        transcript_id = int(segment.transcript_id)
        bucket = matching_by_transcript_id.setdefault(transcript_id, [])

        if len(bucket) >= per_transcript_limit:
            continue

        bucket.append(segment)

    context_conditions = []
    for transcript_id, matching_segments in matching_by_transcript_id.items():
        context_indexes: set[int] = set()

        for segment in matching_segments:
            context_indexes.update(
                {
                    segment.segment_index - 1,
                    segment.segment_index,
                    segment.segment_index + 1,
                }
            )

        if context_indexes:
            context_conditions.append(
                and_(
                    TranscriptSegment.transcript_id == transcript_id,
                    TranscriptSegment.segment_index.in_(context_indexes),
                )
            )

    if not context_conditions:
        return result

    context_rows = session.exec(
        select(TranscriptSegment)
        .where(or_(*context_conditions))
        .order_by(TranscriptSegment.transcript_id, TranscriptSegment.segment_index)
    ).all()

    for segment in context_rows:
        result.setdefault(int(segment.transcript_id), []).append(segment)

    return result


def _transcripts_and_segments_by_audio_ids(
    session: Session,
    audio_ids: list[int],
    q: Optional[str] = None,
) -> tuple[dict[int, Transcript], dict[int, list[TranscriptSegment]]]:
    if not audio_ids:
        return {}, {}

    transcripts = session.exec(
        select(Transcript).where(Transcript.audio_id.in_(audio_ids))
    ).all()

    transcript_by_audio_id = {int(t.audio_id): t for t in transcripts}
    transcript_ids = [int(t.id) for t in transcripts if t.id is not None]

    segments_by_transcript_id: dict[int, list[TranscriptSegment]] = {
        transcript_id: [] for transcript_id in transcript_ids
    }

    if transcript_ids:
        tokens = _query_tokens(q)

        if tokens:
            segments_by_transcript_id = _matching_transcript_segments_by_transcript_ids(
                session=session,
                transcript_ids=transcript_ids,
                tokens=tokens,
                per_transcript_limit=3,
            )
        else:
            segments = session.exec(
                select(TranscriptSegment)
                .where(TranscriptSegment.transcript_id.in_(transcript_ids))
                .order_by(TranscriptSegment.transcript_id, TranscriptSegment.segment_index)
            ).all()

            for segment in segments:
                segments_by_transcript_id.setdefault(int(segment.transcript_id), []).append(segment)

    return transcript_by_audio_id, segments_by_transcript_id


def _search_hits_for_audio(
    session: Session,
    audio: AudioItem,
    q: Optional[str],
    tags: Optional[list[Tag]] = None,
    transcript: Optional[Transcript] = None,
    segments: Optional[list[TranscriptSegment]] = None,
    transcript_prefetched: bool = False,
) -> list[dict]:
    tokens = _query_tokens(q)
    if not tokens or audio.id is None:
        return []

    hits: list[dict] = []

    _add_search_hit(
        hits,
        "title",
        "标题",
        audio.title_user or audio.title_original or audio.file_name,
        tokens,
    )
    _add_search_hit(
        hits,
        "author",
        "作者",
        audio.author_user or audio.author_original,
        tokens,
    )
    _add_search_hit(
        hits,
        "description",
        "描述",
        audio.description_user or audio.description_ai or audio.description_original,
        tokens,
    )

    tag_rows = tags if tags is not None else _tags_for_audio(session, audio.id)
    tag_text = " ".join(tag.name for tag in tag_rows)
    _add_search_hit(hits, "tags", "标签", tag_text, tokens)

    if not transcript_prefetched:
        transcript = session.exec(
            select(Transcript).where(Transcript.audio_id == audio.id)
        ).first()

    if not transcript:
        return hits[:6]

    if segments is None:
        segments = session.exec(
            select(TranscriptSegment)
            .where(TranscriptSegment.transcript_id == transcript.id)
            .order_by(TranscriptSegment.segment_index)
        ).all()

    segment_hit_count = 0
    segment_by_index = {
        segment.segment_index: segment
        for segment in segments or []
    }

    for seg in segments or []:
        if segment_hit_count >= 3:
            break

        before_count = len(hits)
        _add_search_hit(
            hits,
            "transcript",
            "Transcript",
            seg.text,
            tokens,
            start_seconds=seg.start_seconds,
            end_seconds=seg.end_seconds,
            segment_index=seg.segment_index,
            context_before=(
                segment_by_index[seg.segment_index - 1].text
                if seg.segment_index - 1 in segment_by_index
                else None
            ),
            context_after=(
                segment_by_index[seg.segment_index + 1].text
                if seg.segment_index + 1 in segment_by_index
                else None
            ),
        )

        if len(hits) > before_count:
            segment_hit_count += 1

    if segment_hit_count == 0:
        _add_search_hit(
            hits,
            "transcript",
            "Transcript",
            transcript.full_text,
            tokens,
        )

    return hits[:6]


def _audio_with_tags_dict(
    session: Session,
    audio: AudioItem,
    search_query: Optional[str] = None,
) -> dict:
    if audio.id is None:
        return {
            **audio.model_dump(),
            "tags": [],
            "search_hits": [],
        }

    tags = _tags_for_audio(session, audio.id)

    return {
        **audio.model_dump(),
        "tags": [tag.model_dump() for tag in tags],
        "search_hits": _search_hits_for_audio(session, audio, search_query, tags=tags)
        if search_query
        else [],
    }


def _audio_rows_with_tags_dicts(
    session: Session,
    rows: list[AudioItem],
    search_query: Optional[str] = None,
) -> list[dict]:
    audio_ids = [int(audio.id) for audio in rows if audio.id is not None]
    tags_by_id = _tags_by_audio_id(session, audio_ids)

    transcript_by_audio_id: dict[int, Transcript] = {}
    segments_by_transcript_id: dict[int, list[TranscriptSegment]] = {}

    if search_query:
        transcript_by_audio_id, segments_by_transcript_id = (
            _transcripts_and_segments_by_audio_ids(session, audio_ids, q=search_query)
        )

    result = []

    for audio in rows:
        audio_id = int(audio.id) if audio.id is not None else None
        tags = tags_by_id.get(audio_id, []) if audio_id is not None else []
        transcript = transcript_by_audio_id.get(audio_id) if audio_id is not None else None
        segments = (
            segments_by_transcript_id.get(int(transcript.id), [])
            if transcript and transcript.id is not None
            else []
        )

        result.append(
            {
                **audio.model_dump(),
                "tags": [tag.model_dump() for tag in tags],
                "search_hits": _search_hits_for_audio(
                    session,
                    audio,
                    search_query,
                    tags=tags,
                    transcript=transcript,
                    segments=segments,
                    transcript_prefetched=True,
                )
                if search_query
                else [],
            }
        )

    return result


def _build_audio_items_stmt(
    session: Session,
    q: Optional[str] = None,
    search_ids: Optional[list[int]] = None,
    tag: Optional[str] = None,
    has_transcript: Optional[bool] = None,
    transcript_status: Optional[str] = None,
    ai_status: Optional[str] = None,
    favorite: Optional[bool] = None,
    missing: Optional[bool] = None,
    missing_description: Optional[bool] = None,
    include_disabled_roots: bool = False,
):
    stmt = select(AudioItem)

    stmt = _apply_enabled_roots_filter(
        stmt,
        session,
        include_disabled_roots=include_disabled_roots,
    )

    if q:
        ids = search_ids if search_ids is not None else search_audio_ids(session, q)
        if not ids:
            return None

        stmt = stmt.where(AudioItem.id.in_(ids))

    if favorite is not None:
        stmt = stmt.where(AudioItem.is_favorite == favorite)

    if missing is not None:
        stmt = stmt.where(AudioItem.is_missing == missing)

    if transcript_status:
        stmt = stmt.where(AudioItem.transcript_status == transcript_status)
    elif has_transcript is not None:
        if has_transcript:
            stmt = stmt.where(AudioItem.transcript_status == "done")
        else:
            stmt = stmt.where(AudioItem.transcript_status != "done")

    if ai_status:
        stmt = stmt.where(AudioItem.ai_status == ai_status)

    if missing_description is not None:
        if missing_description:
            stmt = stmt.where(
                and_(
                    or_(AudioItem.description_user == None, AudioItem.description_user == ""),
                    or_(AudioItem.description_ai == None, AudioItem.description_ai == ""),
                    or_(AudioItem.description_original == None, AudioItem.description_original == ""),
                )
            )
        else:
            stmt = stmt.where(
                or_(
                    and_(AudioItem.description_user != None, AudioItem.description_user != ""),
                    and_(AudioItem.description_ai != None, AudioItem.description_ai != ""),
                    and_(AudioItem.description_original != None, AudioItem.description_original != ""),
                )
            )

    if tag:
        tag_row = session.exec(select(Tag).where(Tag.name == tag)).first()
        if not tag_row:
            return None

        audio_ids = session.exec(
            select(AudioTag.audio_id).where(AudioTag.tag_id == tag_row.id)
        ).all()

        if not audio_ids:
            return None

        stmt = stmt.where(AudioItem.id.in_(audio_ids))

    return stmt


def rebuild_many_audio_search_indexes(session: Session, audio_ids: list[int]):
    for audio_id in audio_ids:
        rebuild_audio_search_index(session, audio_id)
