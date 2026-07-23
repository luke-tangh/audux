import csv
import io
import json
import mimetypes
import re
from datetime import datetime
from pathlib import Path
from typing import Optional
from urllib.parse import quote

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    BackgroundTasks,
    UploadFile,
    File,
    Query,
)
from fastapi.responses import FileResponse, Response, PlainTextResponse
from sqlmodel import Session, select
from sqlalchemy import func, or_, and_, text
from sqlalchemy.exc import IntegrityError

from .db import get_session, COVERS_DIR
from .logger import get_logger, read_log_tail, read_log_file_redacted, LOG_FILE
from .models import (
    LibraryRoot,
    AudioItem,
    Tag,
    AudioTag,
    Playlist,
    PlaylistItem,
    Transcript,
    TranscriptSegment,
    AITask,
    Setting,
    ScanTask,
    now_iso,
)
from .schemas import (
    LibraryRootCreate,
    LibraryRootUpdate,
    AudioUpdate,
    PlaybackPositionUpdate,
    RelocateAudioRequest,
    TagsAddRequest,
    TagUpdate,
    PlaylistCreate,
    PlaylistItemAdd,
    PlaylistItemsReorder,
    TranscriptCreate,
    SettingUpdate,
    LLMConfig,
    BatchAudioRequest,
)
from .scanner import (
    scan_library_root,
    scan_library_root_task,
    SUPPORTED_EXTS,
    read_audio_metadata,
    extract_embedded_cover,
)
from .search import (
    SEARCH_RESULT_LIMIT,
    rebuild_audio_search_index,
    search_audio_ids,
    search_audio_ids_with_meta,
)
from .tasks import create_task, get_active_task, ActiveTaskConflict
from .ai_client import call_openai_compatible_chat, get_ai_message_content
from .local_security import ensure_llm_endpoint_allowed, _llm_privacy_warning


logger = get_logger(__name__)
router = APIRouter()

AUDIO_MIME_TYPES = {
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".flac": "audio/flac",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
}

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}

BUSY_AUDIO_TASK_STATUSES = {"pending", "running", "cancel_requested"}

ACTIVE_SCAN_TASK_STATUSES = {"pending", "running"}

SAFE_DOWNLOAD_NAME_PATTERN = re.compile(r'[\r\n\\/"<>|:*?]+')


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
    """
    返回音频文件是否可用。

    若文件不存在，立即把 audio.is_missing 标记为 True。
    若文件恢复可用，也会把 is_missing 修正回 False。
    """
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


def _is_unique_constraint_error(error: IntegrityError) -> bool:
    message = str(getattr(error, "orig", error)).lower()
    return "unique constraint failed" in message


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


def _matching_transcript_segments_by_transcript_ids(
    session: Session,
    transcript_ids: list[int],
    tokens: list[str],
    per_transcript_limit: int = 3,
) -> dict[int, list[TranscriptSegment]]:
    """
    PR3 搜索优化：
    不再预取当前页所有 transcript segments，只查询可能命中关键词的 segments。
    """
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
        .where(or_(*conditions))
        .order_by(TranscriptSegment.transcript_id, TranscriptSegment.segment_index)
    ).all()

    for segment in rows:
        transcript_id = int(segment.transcript_id)
        bucket = result.setdefault(transcript_id, [])

        if len(bucket) >= per_transcript_limit:
            continue

        bucket.append(segment)

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

    hits.append(hit)


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


# Library Root

@router.post("/library-roots")
def create_library_root(payload: LibraryRootCreate, session: Session = Depends(get_session)):
    path = str(Path(payload.path).expanduser().resolve())

    if not Path(path).exists() or not Path(path).is_dir():
        raise HTTPException(status_code=400, detail="Invalid directory")

    exists = session.exec(select(LibraryRoot).where(LibraryRoot.path == path)).first()
    if exists:
        raise HTTPException(status_code=409, detail="Library root already exists")

    root = LibraryRoot(path=path)
    session.add(root)
    session.commit()
    session.refresh(root)

    logger.info("Library root created: %s", path)
    return root


@router.get("/library-roots")
def list_library_roots(session: Session = Depends(get_session)):
    return session.exec(select(LibraryRoot).order_by(LibraryRoot.created_at)).all()


@router.patch("/library-roots/{root_id}")
def update_library_root(
    root_id: int,
    payload: LibraryRootUpdate,
    session: Session = Depends(get_session),
):
    root = session.get(LibraryRoot, root_id)
    if not root:
        raise HTTPException(status_code=404, detail="Library root not found")

    if payload.is_enabled is not None:
        root.is_enabled = payload.is_enabled

    root.updated_at = now_iso()
    session.add(root)
    session.commit()
    session.refresh(root)

    logger.info("Library root updated id=%s enabled=%s", root.id, root.is_enabled)
    return root


@router.post("/library-roots/{root_id}/scan")
def scan_root(
    root_id: int,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
):
    root = session.get(LibraryRoot, root_id)
    if not root:
        raise HTTPException(status_code=404, detail="Library root not found")

    active_task = _get_active_scan_task(session, root_id)
    if active_task:
        raise HTTPException(
            status_code=409,
            detail="Scan task is already pending or running for this library root",
        )

    task = ScanTask(root_id=root_id, status="pending")
    session.add(task)

    try:
        session.commit()
        session.refresh(task)
    except IntegrityError as e:
        session.rollback()

        if _is_unique_constraint_error(e):
            raise HTTPException(
                status_code=409,
                detail="Scan task is already pending or running for this library root",
            )

        raise

    background_tasks.add_task(scan_library_root_task, root_id, task.id)

    logger.info("Scan task created id=%s root=%s", task.id, root.path)
    return task


@router.post("/library-roots/{root_id}/scan-sync")
def scan_root_sync(root_id: int, session: Session = Depends(get_session)):
    root = session.get(LibraryRoot, root_id)
    if not root:
        raise HTTPException(status_code=404, detail="Library root not found")

    active_task = _get_active_scan_task(session, root_id)
    if active_task:
        raise HTTPException(
            status_code=409,
            detail="Scan task is already pending or running for this library root",
        )

    try:
        return scan_library_root(session, root_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/scan-tasks")
def list_scan_tasks(
    root_id: Optional[int] = None,
    limit: int = Query(default=50, ge=1, le=200),
    session: Session = Depends(get_session),
):
    stmt = select(ScanTask)

    if root_id is not None:
        stmt = stmt.where(ScanTask.root_id == root_id)

    stmt = stmt.order_by(ScanTask.created_at.desc()).limit(limit)
    return session.exec(stmt).all()


@router.get("/scan-tasks/{task_id}")
def get_scan_task(task_id: int, session: Session = Depends(get_session)):
    task = session.get(ScanTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Scan task not found")

    return task


@router.post("/scan-tasks/{task_id}/cancel")
def cancel_scan_task(task_id: int, session: Session = Depends(get_session)):
    task = session.get(ScanTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Scan task not found")

    if task.status in ["done", "failed", "canceled"]:
        raise HTTPException(status_code=400, detail="Scan task cannot be canceled")

    task.status = "canceled"
    task.finished_at = now_iso()
    task.updated_at = now_iso()
    session.add(task)
    session.commit()
    session.refresh(task)

    logger.info("Scan task canceled id=%s", task.id)
    return task


# Audio

@router.get("/audio-items")
def list_audio_items(
    q: Optional[str] = None,
    tag: Optional[str] = None,
    has_transcript: Optional[bool] = None,
    transcript_status: Optional[str] = None,
    ai_status: Optional[str] = None,
    favorite: Optional[bool] = None,
    missing: Optional[bool] = None,
    missing_description: Optional[bool] = None,
    include_disabled_roots: bool = False,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
):
    search_result = search_audio_ids_with_meta(session, q) if q else None

    base_stmt = _build_audio_items_stmt(
        session=session,
        q=q,
        search_ids=search_result.ids if search_result else None,
        tag=tag,
        has_transcript=has_transcript,
        transcript_status=transcript_status,
        ai_status=ai_status,
        favorite=favorite,
        missing=missing,
        missing_description=missing_description,
        include_disabled_roots=include_disabled_roots,
    )

    if base_stmt is None:
        return {
            "items": [],
            "total": 0,
            "limit": limit,
            "offset": offset,
            "has_more": False,
            "search_limited": bool(search_result.limited) if search_result else False,
            "search_limit": search_result.limit if search_result else None,
        }

    total = session.execute(
        select(func.count()).select_from(base_stmt.subquery())
    ).scalar_one()

    stmt = base_stmt.order_by(AudioItem.updated_at.desc()).offset(offset).limit(limit)
    rows = session.exec(stmt).all()

    return {
        "items": _audio_rows_with_tags_dicts(session, rows, search_query=q),
        "total": int(total or 0),
        "limit": limit,
        "offset": offset,
        "has_more": offset + len(rows) < int(total or 0),
        "search_limited": bool(search_result.limited) if search_result else False,
        "search_limit": search_result.limit if search_result else None,
    }


@router.post("/audio-items/batch/transcribe")
def batch_transcribe(
    payload: BatchAudioRequest,
    session: Session = Depends(get_session),
):
    created = []
    skipped = []
    errors = []

    for audio_id in payload.audio_ids:
        audio = session.get(AudioItem, audio_id)
        if not audio:
            errors.append({"audio_id": audio_id, "error": "Audio not found"})
            continue

        if audio.transcript_status in BUSY_AUDIO_TASK_STATUSES:
            skipped.append(audio_id)
            continue

        if get_active_task(session, audio_id, "transcribe"):
            skipped.append(audio_id)
            continue

        if not _mark_audio_missing_if_unavailable(session, audio):
            errors.append({"audio_id": audio_id, "error": "Audio file missing"})
            continue

        audio.transcript_status = "pending"
        audio.updated_at = now_iso()
        session.add(audio)
        session.commit()

        try:
            task = create_task(session, audio_id, "transcribe")
            created.append(task)
        except ActiveTaskConflict:
            skipped.append(audio_id)
            continue

    logger.info("Batch transcribe created=%s skipped=%s", len(created), len(skipped))

    return {
        "created": len(created),
        "skipped": len(skipped),
        "errors": errors,
        "tasks": created,
    }


@router.post("/audio-items/batch/analyze")
def batch_analyze(
    payload: BatchAudioRequest,
    session: Session = Depends(get_session),
):
    endpoint = session.get(Setting, "llm.endpoint")
    model_name = session.get(Setting, "llm.model_name")

    if not endpoint or not endpoint.value or not model_name or not model_name.value:
        raise HTTPException(status_code=400, detail="LLM endpoint or model_name is not configured")

    warning = ensure_llm_endpoint_allowed(session, endpoint.value)
    if warning:
        logger.warning("Batch analyze uses non-local LLM endpoint: %s", endpoint.value)

    created = []
    skipped = []
    errors = []

    for audio_id in payload.audio_ids:
        audio = session.get(AudioItem, audio_id)
        if not audio:
            errors.append({"audio_id": audio_id, "error": "Audio not found"})
            continue

        if audio.ai_status in BUSY_AUDIO_TASK_STATUSES:
            skipped.append(audio_id)
            continue

        if get_active_task(session, audio_id, "analyze"):
            skipped.append(audio_id)
            continue

        audio.ai_status = "pending"
        audio.updated_at = now_iso()
        session.add(audio)
        session.commit()

        try:
            task = create_task(session, audio_id, "analyze")
            created.append(task)
        except ActiveTaskConflict:
            skipped.append(audio_id)
            continue

    logger.info("Batch analyze created=%s skipped=%s", len(created), len(skipped))

    return {
        "created": len(created),
        "skipped": len(skipped),
        "privacy_warning": warning,
        "errors": errors,
        "tasks": created,
    }


@router.get("/audio-items/{audio_id}")
def get_audio_item(audio_id: int, session: Session = Depends(get_session)):
    item = session.get(AudioItem, audio_id)
    if not item:
        raise HTTPException(status_code=404, detail="Audio item not found")

    tags = _tags_for_audio(session, audio_id)

    return {
        "audio": item,
        "tags": tags,
    }


@router.patch("/audio-items/{audio_id}")
def update_audio_item(
    audio_id: int,
    payload: AudioUpdate,
    session: Session = Depends(get_session),
):
    item = session.get(AudioItem, audio_id)
    if not item:
        raise HTTPException(status_code=404, detail="Audio item not found")

    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(item, key, value)

    item.updated_at = now_iso()
    session.add(item)
    session.commit()
    session.refresh(item)

    rebuild_audio_search_index(session, item.id)
    return item


@router.delete("/audio-items/{audio_id}")
def delete_audio_item(
    audio_id: int,
    delete_file: bool = False,
    session: Session = Depends(get_session),
):
    item = session.get(AudioItem, audio_id)
    if not item:
        raise HTTPException(status_code=404, detail="Audio item not found")

    if delete_file:
        path = Path(item.file_path)
        if path.exists():
            try:
                path.unlink()
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Failed to delete file: {e}")

    for link in session.exec(select(AudioTag).where(AudioTag.audio_id == audio_id)).all():
        session.delete(link)

    for pi in session.exec(select(PlaylistItem).where(PlaylistItem.audio_id == audio_id)).all():
        session.delete(pi)

    for task in session.exec(select(AITask).where(AITask.audio_id == audio_id)).all():
        session.delete(task)

    transcript = session.exec(
        select(Transcript).where(Transcript.audio_id == audio_id)
    ).first()

    if transcript:
        for seg in session.exec(
            select(TranscriptSegment).where(
                TranscriptSegment.transcript_id == transcript.id
            )
        ).all():
            session.delete(seg)

        session.delete(transcript)

    if item.cover_path:
        _delete_managed_cover_file(item.cover_path)

    session.execute(
        text("DELETE FROM search_index WHERE audio_id = :audio_id"),
        {"audio_id": audio_id},
    )

    session.delete(item)
    session.commit()

    logger.info("Audio item deleted id=%s delete_file=%s", audio_id, delete_file)
    return {"ok": True}


@router.post("/audio-items/{audio_id}/relocate")
def relocate_audio_item(
    audio_id: int,
    payload: RelocateAudioRequest,
    session: Session = Depends(get_session),
):
    item = session.get(AudioItem, audio_id)
    if not item:
        raise HTTPException(status_code=404, detail="Audio item not found")

    new_path = Path(payload.file_path).expanduser().resolve()

    if not new_path.exists() or not new_path.is_file():
        raise HTTPException(status_code=400, detail="Invalid audio file path")

    if new_path.suffix.lower() not in SUPPORTED_EXTS:
        raise HTTPException(status_code=400, detail="Unsupported audio format")

    exists = session.exec(
        select(AudioItem).where(
            AudioItem.file_path == str(new_path),
            AudioItem.id != audio_id,
        )
    ).first()

    if exists:
        raise HTTPException(status_code=409, detail="Another audio item already uses this file path")

    stat = new_path.stat()
    meta = read_audio_metadata(new_path)

    item.file_path = str(new_path)
    item.file_name = new_path.name
    item.file_ext = new_path.suffix.lower()
    item.file_size = stat.st_size
    item.file_mtime = datetime.utcfromtimestamp(stat.st_mtime).isoformat()
    item.library_root_id = _find_library_root_id_for_path(session, new_path)
    item.is_missing = False

    for key, value in meta.items():
        setattr(item, key, value)

    if item.cover_source != "user":
        if item.cover_source == "embedded":
            _delete_managed_cover_file(item.cover_path)
        item.cover_path = None
        item.cover_source = None
        cover = extract_embedded_cover(new_path, item.id)
        if cover:
            item.cover_path = cover["cover_path"]
            item.cover_source = cover["cover_source"]

    item.updated_at = now_iso()
    session.add(item)
    session.commit()
    session.refresh(item)

    rebuild_audio_search_index(session, item.id)
    logger.info("Audio item relocated id=%s path=%s", audio_id, new_path)

    return item


@router.post("/audio-items/{audio_id}/playback-position")
def update_playback_position(
    audio_id: int,
    payload: PlaybackPositionUpdate,
    session: Session = Depends(get_session),
):
    item = session.get(AudioItem, audio_id)
    if not item:
        raise HTTPException(status_code=404, detail="Audio item not found")

    item.last_position_seconds = payload.last_position_seconds
    item.last_played_at = now_iso()
    item.updated_at = now_iso()
    session.add(item)
    session.commit()
    return {"ok": True}


@router.post("/audio-items/{audio_id}/play-count")
def increment_play_count(audio_id: int, session: Session = Depends(get_session)):
    item = session.get(AudioItem, audio_id)
    if not item:
        raise HTTPException(status_code=404, detail="Audio item not found")

    item.play_count += 1
    item.last_played_at = now_iso()
    item.updated_at = now_iso()
    session.add(item)
    session.commit()
    return {"ok": True}


@router.get("/audio-items/{audio_id}/file")
def get_audio_file(audio_id: int, session: Session = Depends(get_session)):
    item = session.get(AudioItem, audio_id)
    if not item:
        raise HTTPException(status_code=404, detail="Audio item not found")

    path = Path(item.file_path)
    if not path.exists():
        item.is_missing = True
        session.add(item)
        session.commit()
        raise HTTPException(status_code=404, detail="Audio file missing")

    media_type = AUDIO_MIME_TYPES.get(path.suffix.lower(), "application/octet-stream")
    return FileResponse(str(path), media_type=media_type, filename=item.file_name)


@router.get("/audio-items/{audio_id}/cover")
def get_audio_cover(audio_id: int, session: Session = Depends(get_session)):
    item = session.get(AudioItem, audio_id)
    if not item:
        raise HTTPException(status_code=404, detail="Audio item not found")

    if not item.cover_path:
        raise HTTPException(status_code=404, detail="Cover not found")

    path = Path(item.cover_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Cover file missing")

    return FileResponse(str(path), media_type=_cover_media_type(path))


@router.post("/audio-items/{audio_id}/cover")
async def upload_audio_cover(
    audio_id: int,
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
):
    item = session.get(AudioItem, audio_id)
    if not item:
        raise HTTPException(status_code=404, detail="Audio item not found")

    original_name = file.filename or ""
    ext = Path(original_name).suffix.lower()

    if ext not in IMAGE_EXTS:
        content_type = file.content_type or ""
        if content_type == "image/png":
            ext = ".png"
        elif content_type in ["image/jpeg", "image/jpg"]:
            ext = ".jpg"
        elif content_type == "image/webp":
            ext = ".webp"
        else:
            raise HTTPException(status_code=400, detail="Unsupported image format")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty cover file")

    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Cover file is too large")

    COVERS_DIR.mkdir(parents=True, exist_ok=True)

    for old in COVERS_DIR.glob(f"audio_{audio_id}.*"):
        try:
            old.unlink()
        except Exception:
            pass

    out = COVERS_DIR / f"audio_{audio_id}{ext}"
    out.write_bytes(data)

    item.cover_path = str(out)
    item.cover_source = "user"
    item.updated_at = now_iso()

    session.add(item)
    session.commit()
    session.refresh(item)

    logger.info("Cover uploaded audio_id=%s path=%s", audio_id, out)
    return item


@router.delete("/audio-items/{audio_id}/cover")
def delete_audio_cover(audio_id: int, session: Session = Depends(get_session)):
    item = session.get(AudioItem, audio_id)
    if not item:
        raise HTTPException(status_code=404, detail="Audio item not found")

    if item.cover_path:
        _delete_managed_cover_file(item.cover_path)

    item.cover_path = None
    item.cover_source = None
    item.updated_at = now_iso()

    session.add(item)
    session.commit()
    session.refresh(item)

    logger.info("Cover deleted audio_id=%s", audio_id)
    return item


@router.get("/audio-items/{audio_id}/ai-suggestions")
def get_audio_ai_suggestions(audio_id: int, session: Session = Depends(get_session)):
    audio = session.get(AudioItem, audio_id)
    if not audio:
        raise HTTPException(status_code=404, detail="Audio item not found")

    tasks = session.exec(
        select(AITask)
        .where(AITask.audio_id == audio_id)
        .where(AITask.task_type == "analyze")
        .where(AITask.output_payload != None)
        .order_by(AITask.created_at.desc())
        .limit(20)
    ).all()

    for task in tasks:
        payload = _parse_task_output_payload(task.output_payload)

        tags = payload.get("tags", [])
        if not isinstance(tags, list):
            tags = []

        tags = [str(x).strip() for x in tags if str(x).strip()]
        description = payload.get("description") or audio.description_ai
        language = payload.get("language") or audio.language

        if description or tags:
            return {
                "task_id": task.id,
                "description": description,
                "tags": tags,
                "language": language,
                "raw_content": payload.get("raw_content"),
            }

    return {
        "task_id": None,
        "description": audio.description_ai,
        "tags": [],
        "language": audio.language,
        "raw_content": None,
    }


# Tags

@router.get("/tags")
def list_tags(session: Session = Depends(get_session)):
    return session.exec(select(Tag).order_by(Tag.name)).all()


@router.patch("/tags/{tag_id}")
def update_tag(
    tag_id: int,
    payload: TagUpdate,
    session: Session = Depends(get_session),
):
    tag = session.get(Tag, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    name = payload.name.strip() if payload.name is not None else None
    if not name:
        raise HTTPException(status_code=400, detail="Tag name is required")

    exists = session.exec(
        select(Tag).where(Tag.name == name, Tag.id != tag_id)
    ).first()

    if exists:
        raise HTTPException(status_code=409, detail="Tag name already exists")

    audio_ids = session.exec(
        select(AudioTag.audio_id).where(AudioTag.tag_id == tag_id)
    ).all()

    tag.name = name
    session.add(tag)
    session.commit()
    session.refresh(tag)

    for audio_id in audio_ids:
        rebuild_audio_search_index(session, audio_id)

    logger.info("Tag renamed id=%s name=%s", tag_id, name)
    return tag


@router.delete("/tags/{tag_id}")
def delete_tag(
    tag_id: int,
    force: bool = False,
    session: Session = Depends(get_session),
):
    tag = session.get(Tag, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    links = session.exec(
        select(AudioTag).where(AudioTag.tag_id == tag_id)
    ).all()

    if links and not force:
        raise HTTPException(status_code=400, detail="Tag is still used by audio items")

    affected_audio_ids = [link.audio_id for link in links]

    for link in links:
        session.delete(link)

    session.delete(tag)
    session.commit()

    for audio_id in affected_audio_ids:
        rebuild_audio_search_index(session, audio_id)

    logger.info("Tag deleted id=%s force=%s", tag_id, force)
    return {
        "ok": True,
        "affected_audio_items": len(affected_audio_ids),
    }


@router.post("/audio-items/{audio_id}/tags")
def add_tags_to_audio(
    audio_id: int,
    payload: TagsAddRequest,
    session: Session = Depends(get_session),
):
    item = session.get(AudioItem, audio_id)
    if not item:
        raise HTTPException(status_code=404, detail="Audio item not found")

    result = []

    for name in payload.tags:
        name = name.strip()
        if not name:
            continue

        tag = session.exec(select(Tag).where(Tag.name == name)).first()
        if not tag:
            tag = Tag(name=name, source=payload.source)
            session.add(tag)
            session.commit()
            session.refresh(tag)

        exists = session.exec(
            select(AudioTag).where(
                AudioTag.audio_id == audio_id,
                AudioTag.tag_id == tag.id,
            )
        ).first()

        if not exists:
            link = AudioTag(audio_id=audio_id, tag_id=tag.id)
            session.add(link)

        result.append(tag)

    item.updated_at = now_iso()
    session.add(item)
    session.commit()
    rebuild_audio_search_index(session, audio_id)
    return result


@router.delete("/audio-items/{audio_id}/tags/{tag_id}")
def remove_audio_tag(audio_id: int, tag_id: int, session: Session = Depends(get_session)):
    link = session.get(AudioTag, (audio_id, tag_id))
    if not link:
        raise HTTPException(status_code=404, detail="Audio tag relation not found")

    session.delete(link)

    item = session.get(AudioItem, audio_id)
    if item:
        item.updated_at = now_iso()
        session.add(item)

    session.commit()
    rebuild_audio_search_index(session, audio_id)
    return {"ok": True}


# Playlists

@router.post("/playlists")
def create_playlist(payload: PlaylistCreate, session: Session = Depends(get_session)):
    playlist = Playlist(name=payload.name, description=payload.description)
    session.add(playlist)
    session.commit()
    session.refresh(playlist)
    return playlist


@router.get("/playlists")
def list_playlists(session: Session = Depends(get_session)):
    return session.exec(select(Playlist).order_by(Playlist.created_at)).all()


@router.get("/playlists/{playlist_id}")
def get_playlist(playlist_id: int, session: Session = Depends(get_session)):
    playlist = session.get(Playlist, playlist_id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")

    items = session.exec(
        select(PlaylistItem, AudioItem)
        .join(AudioItem, PlaylistItem.audio_id == AudioItem.id)
        .where(PlaylistItem.playlist_id == playlist_id)
        .order_by(PlaylistItem.order_index)
    ).all()

    audio_dicts = _audio_rows_with_tags_dicts(session, [audio for _, audio in items])
    audio_by_id = {row["id"]: row for row in audio_dicts}

    return {
        "playlist": playlist,
        "items": [
            {
                "playlist_item": pi,
                "audio": audio_by_id.get(audio.id) or _audio_with_tags_dict(session, audio),
            }
            for pi, audio in items
        ],
    }


@router.post("/playlists/{playlist_id}/items")
def add_audio_to_playlist(
    playlist_id: int,
    payload: PlaylistItemAdd,
    session: Session = Depends(get_session),
):
    playlist = session.get(Playlist, playlist_id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")

    audio = session.get(AudioItem, payload.audio_id)
    if not audio:
        raise HTTPException(status_code=404, detail="Audio not found")

    max_order = session.exec(
        select(func.max(PlaylistItem.order_index)).where(
            PlaylistItem.playlist_id == playlist_id
        )
    ).one()

    next_order = 0 if max_order is None else max_order + 1

    item = PlaylistItem(
        playlist_id=playlist_id,
        audio_id=payload.audio_id,
        order_index=next_order,
    )
    session.add(item)

    playlist.updated_at = now_iso()
    session.add(playlist)

    session.commit()
    session.refresh(item)
    return item


@router.patch("/playlists/{playlist_id}/items/reorder")
def reorder_playlist_items(
    playlist_id: int,
    payload: PlaylistItemsReorder,
    session: Session = Depends(get_session),
):
    playlist = session.get(Playlist, playlist_id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")

    items = session.exec(
        select(PlaylistItem).where(PlaylistItem.playlist_id == playlist_id)
    ).all()

    current_by_id = {item.id: item for item in items}
    requested_ids = payload.item_ids

    if len(requested_ids) != len(set(requested_ids)):
        raise HTTPException(status_code=400, detail="Duplicate playlist item ids")

    if set(requested_ids) != set(current_by_id.keys()):
        raise HTTPException(
            status_code=400,
            detail="item_ids must exactly match current playlist items",
        )

    for order_index, item_id in enumerate(requested_ids):
        row = current_by_id[item_id]
        row.order_index = order_index
        session.add(row)

    playlist.updated_at = now_iso()
    session.add(playlist)

    session.commit()

    logger.info("Playlist reordered id=%s count=%s", playlist_id, len(requested_ids))
    return {
        "ok": True,
        "count": len(requested_ids),
    }


@router.delete("/playlists/{playlist_id}/items/{item_id}")
def remove_playlist_item(
    playlist_id: int,
    item_id: int,
    session: Session = Depends(get_session),
):
    item = session.get(PlaylistItem, item_id)
    if not item or item.playlist_id != playlist_id:
        raise HTTPException(status_code=404, detail="Playlist item not found")

    playlist = session.get(Playlist, playlist_id)

    session.delete(item)

    if playlist:
        playlist.updated_at = now_iso()
        session.add(playlist)

    session.commit()
    return {"ok": True}


@router.get("/playlists/{playlist_id}/export")
def export_playlist(
    playlist_id: int,
    format: str = "json",
    session: Session = Depends(get_session),
):
    playlist = session.get(Playlist, playlist_id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")

    rows = session.exec(
        select(PlaylistItem, AudioItem)
        .join(AudioItem, PlaylistItem.audio_id == AudioItem.id)
        .where(PlaylistItem.playlist_id == playlist_id)
        .order_by(PlaylistItem.order_index)
    ).all()

    if format == "m3u":
        lines = ["#EXTM3U"]
        for _, audio in rows:
            duration = int(audio.duration_seconds or -1)
            title = audio.title_user or audio.title_original or audio.file_name
            lines.append(f"#EXTINF:{duration},{title}")
            lines.append(audio.file_path)

        return PlainTextResponse(
            "\n".join(lines),
            media_type="audio/x-mpegurl",
            headers=_attachment_headers(f"{playlist.name}.m3u"),
        )

    data = {
        "playlist": playlist.model_dump(),
        "items": [
            {
                "playlist_item": pi.model_dump(),
                "audio": audio.model_dump(),
            }
            for pi, audio in rows
        ],
    }

    return Response(
        json.dumps(data, ensure_ascii=False, indent=2),
        media_type="application/json",
        headers=_attachment_headers(f"{playlist.name}.json"),
    )


# Transcript

@router.post("/audio-items/{audio_id}/transcribe")
def enqueue_transcribe(audio_id: int, session: Session = Depends(get_session)):
    audio = session.get(AudioItem, audio_id)
    if not audio:
        raise HTTPException(status_code=404, detail="Audio not found")

    if audio.transcript_status in BUSY_AUDIO_TASK_STATUSES:
        raise HTTPException(
            status_code=409,
            detail="Transcribe task is already pending, running or canceling",
        )

    if get_active_task(session, audio_id, "transcribe"):
        raise HTTPException(
            status_code=409,
            detail="Transcribe task is already pending, running or canceling",
        )

    if not _mark_audio_missing_if_unavailable(session, audio):
        raise HTTPException(status_code=400, detail="Audio file missing")

    audio.transcript_status = "pending"
    audio.updated_at = now_iso()
    session.add(audio)
    session.commit()

    try:
        task = create_task(session, audio_id, "transcribe")
    except ActiveTaskConflict:
        raise HTTPException(
            status_code=409,
            detail="Transcribe task is already pending, running or canceling",
        )

    return task


@router.get("/audio-items/{audio_id}/transcript")
def get_transcript(audio_id: int, session: Session = Depends(get_session)):
    transcript = session.exec(
        select(Transcript).where(Transcript.audio_id == audio_id)
    ).first()

    if not transcript:
        raise HTTPException(status_code=404, detail="Transcript not found")

    segments = session.exec(
        select(TranscriptSegment)
        .where(TranscriptSegment.transcript_id == transcript.id)
        .order_by(TranscriptSegment.segment_index)
    ).all()

    return {
        "transcript": transcript,
        "segments": segments,
    }


@router.get("/audio-items/{audio_id}/transcript/export")
def export_transcript(
    audio_id: int,
    format: str = "txt",
    session: Session = Depends(get_session),
):
    audio = session.get(AudioItem, audio_id)
    if not audio:
        raise HTTPException(status_code=404, detail="Audio not found")

    transcript = session.exec(
        select(Transcript).where(Transcript.audio_id == audio_id)
    ).first()

    if not transcript:
        raise HTTPException(status_code=404, detail="Transcript not found")

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


@router.post("/audio-items/{audio_id}/transcript")
def save_transcript(
    audio_id: int,
    payload: TranscriptCreate,
    session: Session = Depends(get_session),
):
    audio = session.get(AudioItem, audio_id)
    if not audio:
        raise HTTPException(status_code=404, detail="Audio not found")

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
        raise HTTPException(status_code=500, detail="Failed to create transcript")

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


# AI

@router.post("/audio-items/{audio_id}/analyze")
def enqueue_analyze(audio_id: int, session: Session = Depends(get_session)):
    audio = session.get(AudioItem, audio_id)
    if not audio:
        raise HTTPException(status_code=404, detail="Audio not found")

    if audio.ai_status in BUSY_AUDIO_TASK_STATUSES:
        raise HTTPException(
            status_code=409,
            detail="Analyze task is already pending, running or canceling",
        )

    if get_active_task(session, audio_id, "analyze"):
        raise HTTPException(
            status_code=409,
            detail="Analyze task is already pending, running or canceling",
        )

    endpoint = session.get(Setting, "llm.endpoint")
    model_name = session.get(Setting, "llm.model_name")

    if not endpoint or not endpoint.value or not model_name or not model_name.value:
        raise HTTPException(status_code=400, detail="LLM endpoint or model_name is not configured")

    warning = ensure_llm_endpoint_allowed(session, endpoint.value)
    if warning:
        logger.warning("Analyze uses non-local LLM endpoint: %s", endpoint.value)

    audio.ai_status = "pending"
    audio.updated_at = now_iso()
    session.add(audio)
    session.commit()

    try:
        task = create_task(session, audio_id, "analyze")
    except ActiveTaskConflict:
        raise HTTPException(
            status_code=409,
            detail="Analyze task is already pending, running or canceling",
        )

    return {
        **task.model_dump(),
        "privacy_warning": warning,
    }


@router.post("/ai/test-llm")
async def test_llm_config(payload: LLMConfig):
    if not payload.endpoint or not payload.model_name:
        raise HTTPException(status_code=400, detail="endpoint and model_name are required")

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
        }

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/ai-tasks")
def list_ai_tasks(
    status: Optional[str] = None,
    task_type: Optional[str] = None,
    audio_id: Optional[int] = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
):
    stmt = select(AITask)

    if status:
        stmt = stmt.where(AITask.status == status)

    if task_type:
        stmt = stmt.where(AITask.task_type == task_type)

    if audio_id is not None:
        stmt = stmt.where(AITask.audio_id == audio_id)

    stmt = stmt.order_by(AITask.created_at.desc()).offset(offset).limit(limit)
    return session.exec(stmt).all()


@router.get("/ai-tasks/{task_id}")
def get_ai_task(task_id: int, session: Session = Depends(get_session)):
    task = session.get(AITask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.post("/ai-tasks/{task_id}/retry")
def retry_ai_task(task_id: int, session: Session = Depends(get_session)):
    task = session.get(AITask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.status not in ["failed", "canceled"]:
        raise HTTPException(status_code=400, detail="Only failed/canceled task can be retried")

    if get_active_task(session, task.audio_id, task.task_type, exclude_task_id=task.id):
        raise HTTPException(status_code=409, detail="Another task is already active")

    if task.task_type == "analyze":
        endpoint = session.get(Setting, "llm.endpoint")
        model_name = session.get(Setting, "llm.model_name")

        if not endpoint or not endpoint.value or not model_name or not model_name.value:
            raise HTTPException(
                status_code=400,
                detail="LLM endpoint or model_name is not configured",
            )

        warning = ensure_llm_endpoint_allowed(session, endpoint.value)
        if warning:
            logger.warning(
                "Retry analyze uses non-local LLM endpoint: %s",
                endpoint.value,
            )

    task.status = "pending"
    task.retry_count += 1
    task.error_message = None
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
            raise HTTPException(
                status_code=409,
                detail="Another task is already active",
            )

        raise

    session.refresh(task)
    return task


@router.post("/ai-tasks/{task_id}/cancel")
def cancel_ai_task(task_id: int, session: Session = Depends(get_session)):
    task = session.get(AITask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.status in ["done", "failed", "canceled"]:
        raise HTTPException(status_code=400, detail="Task cannot be canceled")

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


# Settings

@router.get("/settings")
def list_settings(session: Session = Depends(get_session)):
    return session.exec(select(Setting)).all()


@router.put("/settings")
def upsert_setting(payload: SettingUpdate, session: Session = Depends(get_session)):
    row = session.get(Setting, payload.key)

    if row:
        row.value = payload.value
        row.updated_at = now_iso()
    else:
        row = Setting(key=payload.key, value=payload.value)

    session.add(row)
    session.commit()
    session.refresh(row)
    return row


# Search / Export / Maintenance / Logs

@router.get("/search")
def search(
    q: str,
    include_disabled_roots: bool = False,
    session: Session = Depends(get_session),
):
    ids = search_audio_ids(session, q)
    if not ids:
        return []

    stmt = select(AudioItem).where(AudioItem.id.in_(ids))
    stmt = _apply_enabled_roots_filter(
        stmt,
        session,
        include_disabled_roots=include_disabled_roots,
    )

    rows = session.exec(stmt).all()
    row_dicts = _audio_rows_with_tags_dicts(session, rows, search_query=q)
    row_by_id = {row["id"]: row for row in row_dicts}

    return [row_by_id[i] for i in ids if i in row_by_id]


@router.get("/export/metadata")
def export_metadata(
    format: str = "json",
    session: Session = Depends(get_session),
):
    items = session.exec(select(AudioItem).order_by(AudioItem.updated_at.desc())).all()
    tags_by_audio_id = _tags_by_audio_id(
        session,
        [int(audio.id) for audio in items if audio.id is not None],
    )

    if format == "csv":
        buf = io.StringIO()
        writer = csv.writer(buf)

        writer.writerow(
            [
                "id",
                "title",
                "author",
                "album",
                "file_path",
                "duration_seconds",
                "language",
                "tags",
                "transcript_status",
                "ai_status",
                "is_favorite",
                "is_missing",
            ]
        )

        for audio in items:
            tags = tags_by_audio_id.get(int(audio.id), []) if audio.id is not None else []

            writer.writerow(
                [
                    audio.id,
                    audio.title_user or audio.title_original or audio.file_name,
                    audio.author_user or audio.author_original or "",
                    audio.album_user or audio.album_original or "",
                    audio.file_path,
                    audio.duration_seconds or "",
                    audio.language or "",
                    ",".join(t.name for t in tags),
                    audio.transcript_status,
                    audio.ai_status,
                    audio.is_favorite,
                    audio.is_missing,
                ]
            )

        return PlainTextResponse(
            buf.getvalue(),
            media_type="text/csv; charset=utf-8",
            headers=_attachment_headers("audio_library_metadata.csv"),
        )

    data = [
        {
            **audio.model_dump(),
            "tags": [
                tag.model_dump()
                for tag in (tags_by_audio_id.get(int(audio.id), []) if audio.id is not None else [])
            ],
        }
        for audio in items
    ]

    return Response(
        json.dumps(data, ensure_ascii=False, indent=2),
        media_type="application/json",
        headers=_attachment_headers("audio_library_metadata.json"),
    )


@router.post("/maintenance/rebuild-search-index")
def rebuild_all_search_index(session: Session = Depends(get_session)):
    items = session.exec(select(AudioItem)).all()
    count = 0

    for item in items:
        rebuild_audio_search_index(session, item.id, commit=False)
        count += 1

        if count % 200 == 0:
            session.commit()

    session.commit()

    logger.info("Search index rebuilt count=%s", count)
    return {"ok": True, "count": count}


@router.post("/maintenance/cleanup-tags")
def cleanup_orphan_tags(session: Session = Depends(get_session)):
    tags = session.exec(select(Tag)).all()
    deleted = 0

    for tag in tags:
        if tag.id is None:
            continue

        link = session.exec(
            select(AudioTag).where(AudioTag.tag_id == tag.id)
        ).first()

        if not link:
            session.delete(tag)
            deleted += 1

    session.commit()

    logger.info("Orphan tags cleaned count=%s", deleted)
    return {
        "ok": True,
        "deleted": deleted,
    }


@router.get("/logs/app")
def get_app_logs(lines: int = Query(default=300, ge=1, le=2000)):
    return {
        "file": str(LOG_FILE),
        "content": read_log_tail(lines),
    }


@router.get("/logs/app/file")
def get_app_log_file():
    if not LOG_FILE.exists():
        raise HTTPException(status_code=404, detail="Log file not found")

    return PlainTextResponse(
        read_log_file_redacted(),
        media_type="text/plain; charset=utf-8",
        headers=_attachment_headers("app.log"),
    )
