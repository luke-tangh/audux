import json
from pathlib import Path
from typing import Optional

from fastapi.responses import FileResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select
from sqlalchemy import func

from ..asr_config import (
    ASR_PROVIDER_EXTERNAL,
    ASR_PROVIDER_FASTER_WHISPER,
    build_asr_task_payload,
)
from ..db import COVERS_DIR
from ..local_security import ensure_asr_endpoint_allowed, ensure_llm_endpoint_allowed
from ..logger import get_logger
from ..models import (
    AITask,
    AudioItem,
    AudioTag,
    LibraryRoot,
    PlaylistItem,
    Setting,
    Transcript,
    TranscriptSegment,
    now_iso,
)
from ..scanner import (
    SUPPORTED_EXTS,
    SUPPORTED_HASH_STRATEGIES,
    calculate_file_fingerprint,
    extract_embedded_cover,
    read_audio_metadata,
)
from ..search import rebuild_audio_search_index, search_audio_ids_with_meta
from ..tasks import get_active_task
from ..time_utils import utc_timestamp_iso
from .common import (
    AUDIO_MIME_TYPES,
    BUSY_AUDIO_TASK_STATUSES,
    IMAGE_EXTS,
    ServiceError,
    _audio_rows_with_tags_dicts,
    _build_audio_items_stmt,
    _cover_media_type,
    _delete_managed_cover_file,
    _find_library_root_id_for_path,
    _is_unique_constraint_error,
    _mark_audio_missing_if_unavailable_no_commit,
    _parse_task_output_payload,
    _tags_for_audio,
)
from .whisper_component_service import is_whisper_companion_available


logger = get_logger(__name__)


def _get_file_hash_strategy(session: Session) -> str:
    row = session.get(Setting, "scanner.hash_strategy")
    value = (row.value if row else "sampled").strip().lower()

    if value not in SUPPORTED_HASH_STRATEGIES:
        return "sampled"

    return value


def _calculate_audio_item_file_hash(
    session: Session,
    file_path: Path,
    file_size: Optional[int] = None,
) -> Optional[str]:
    try:
        return calculate_file_fingerprint(
            file_path,
            strategy=_get_file_hash_strategy(session),
            file_size=file_size,
        )
    except Exception as e:
        logger.warning("Failed to calculate relocated file hash for %s: %s", file_path, e)
        return None


def list_audio_items(
    session: Session,
    q: Optional[str] = None,
    tag: Optional[str] = None,
    has_transcript: Optional[bool] = None,
    transcript_status: Optional[str] = None,
    ai_status: Optional[str] = None,
    favorite: Optional[bool] = None,
    missing: Optional[bool] = None,
    missing_description: Optional[bool] = None,
    include_disabled_roots: bool = False,
    limit: int = 100,
    offset: int = 0,
) -> dict:
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


def resolve_playback_queue(session: Session, audio_ids: list[int]) -> dict:
    """Resolve a persisted ID-only queue without trusting stale client rows."""
    unique_ids = list(dict.fromkeys(audio_ids))
    items = session.exec(select(AudioItem).where(AudioItem.id.in_(unique_ids))).all()
    items_by_id = {item.id: item for item in items}
    root_ids = {
        item.library_root_id
        for item in items
        if item.library_root_id is not None
    }
    roots_by_id = (
        {
            root.id: root
            for root in session.exec(
                select(LibraryRoot).where(LibraryRoot.id.in_(root_ids))
            ).all()
        }
        if root_ids
        else {}
    )

    resolved: list[AudioItem] = []
    skipped: list[dict] = []
    seen: set[int] = set()
    availability_changed = False

    for audio_id in audio_ids:
        if audio_id in seen:
            skipped.append({"audio_id": audio_id, "reason": "duplicate"})
            continue

        seen.add(audio_id)
        item = items_by_id.get(audio_id)
        if item is None:
            skipped.append({"audio_id": audio_id, "reason": "deleted"})
            continue

        if item.library_root_id is not None:
            root = roots_by_id.get(item.library_root_id)
            if root is None or not root.is_enabled:
                skipped.append({"audio_id": audio_id, "reason": "disabled_root"})
                continue

        was_missing = item.is_missing
        if not _mark_audio_missing_if_unavailable_no_commit(session, item):
            skipped.append({"audio_id": audio_id, "reason": "missing"})
            availability_changed = availability_changed or not was_missing
            continue

        availability_changed = availability_changed or was_missing
        resolved.append(item)

    if availability_changed:
        session.commit()
        for item in resolved:
            session.refresh(item)

    return {
        "items": _audio_rows_with_tags_dicts(session, resolved),
        "skipped": skipped,
    }


def batch_transcribe(session: Session, audio_ids: list[int]) -> dict:
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
                "Batch transcribe uses non-local ASR endpoint: %s",
                asr_config["endpoint"],
            )

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

                if audio.transcript_status in BUSY_AUDIO_TASK_STATUSES:
                    skipped.append(audio_id)
                    continue

                if get_active_task(session, audio_id, "transcribe"):
                    skipped.append(audio_id)
                    continue

                if not _mark_audio_missing_if_unavailable_no_commit(session, audio):
                    errors.append({"audio_id": audio_id, "error": "Audio file missing"})
                    continue

                audio.transcript_status = "pending"
                audio.updated_at = now_iso()
                session.add(audio)

                task = AITask(
                    audio_id=audio_id,
                    task_type="transcribe",
                    status="pending",
                    input_payload=json.dumps(input_payload, ensure_ascii=False),
                    updated_at=now_iso(),
                )
                session.add(task)
                session.flush()

                if task.id is not None:
                    created_task_ids.append(int(task.id))

        except IntegrityError as e:
            if _is_unique_constraint_error(e):
                skipped.append(audio_id)
                continue

            raise

    session.commit()

    logger.info("Batch transcribe created=%s skipped=%s", len(created_task_ids), len(skipped))

    return {
        "created": len(created_task_ids),
        "skipped": len(skipped),
        "errors": errors,
        "task_ids": created_task_ids,
    }


def batch_analyze(session: Session, audio_ids: list[int]) -> dict:
    endpoint = session.get(Setting, "llm.endpoint")
    model_name = session.get(Setting, "llm.model_name")

    if not endpoint or not endpoint.value or not model_name or not model_name.value:
        raise ServiceError(400, "LLM endpoint or model_name is not configured")

    warning = ensure_llm_endpoint_allowed(session, endpoint.value)
    if warning:
        logger.warning("Batch analyze uses non-local LLM endpoint: %s", endpoint.value)

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

                if audio.ai_status in BUSY_AUDIO_TASK_STATUSES:
                    skipped.append(audio_id)
                    continue

                if get_active_task(session, audio_id, "analyze"):
                    skipped.append(audio_id)
                    continue

                audio.ai_status = "pending"
                audio.updated_at = now_iso()
                session.add(audio)

                task = AITask(
                    audio_id=audio_id,
                    task_type="analyze",
                    status="pending",
                    input_payload=json.dumps({}, ensure_ascii=False),
                    updated_at=now_iso(),
                )
                session.add(task)
                session.flush()

                if task.id is not None:
                    created_task_ids.append(int(task.id))

        except IntegrityError as e:
            if _is_unique_constraint_error(e):
                skipped.append(audio_id)
                continue

            raise

    session.commit()

    logger.info("Batch analyze created=%s skipped=%s", len(created_task_ids), len(skipped))

    return {
        "created": len(created_task_ids),
        "skipped": len(skipped),
        "privacy_warning": warning,
        "privacy_warning_code": "llm.remote" if warning else None,
        "errors": errors,
        "task_ids": created_task_ids,
    }


def get_audio_item(session: Session, audio_id: int) -> dict:
    item = session.get(AudioItem, audio_id)
    if not item:
        raise ServiceError(404, "Audio item not found")

    tags = _tags_for_audio(session, audio_id)

    return {
        "audio": item,
        "tags": tags,
    }


def update_audio_item(session: Session, audio_id: int, data: dict) -> AudioItem:
    item = session.get(AudioItem, audio_id)
    if not item:
        raise ServiceError(404, "Audio item not found")

    for key, value in data.items():
        setattr(item, key, value)

    item.updated_at = now_iso()
    session.add(item)
    session.commit()
    session.refresh(item)

    rebuild_audio_search_index(session, item.id)
    return item


def delete_audio_item(
    session: Session,
    audio_id: int,
    delete_file: bool = False,
) -> dict:
    item = session.get(AudioItem, audio_id)
    if not item:
        raise ServiceError(404, "Audio item not found")

    if delete_file:
        path = Path(item.file_path)
        if path.exists():
            try:
                path.unlink()
            except Exception as e:
                raise ServiceError(400, f"Failed to delete file: {e}") from e

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

        session.flush()
        session.delete(transcript)

    if item.cover_path:
        _delete_managed_cover_file(item.cover_path)

    session.execute(
        text("DELETE FROM search_index WHERE audio_id = :audio_id"),
        {"audio_id": audio_id},
    )

    # These models do not declare ORM relationships, so SQLAlchemy cannot infer
    # the child-before-parent delete order from an in-memory relationship graph.
    session.flush()
    session.delete(item)
    session.commit()

    logger.info("Audio item deleted id=%s delete_file=%s", audio_id, delete_file)
    return {"ok": True}


def relocate_audio_item(
    session: Session,
    audio_id: int,
    file_path_value: str,
) -> AudioItem:
    item = session.get(AudioItem, audio_id)
    if not item:
        raise ServiceError(404, "Audio item not found")

    new_path = Path(file_path_value).expanduser().resolve()

    if not new_path.exists() or not new_path.is_file():
        raise ServiceError(400, "Invalid audio file path")

    if new_path.suffix.lower() not in SUPPORTED_EXTS:
        raise ServiceError(400, "Unsupported audio format")

    library_root_id = _find_library_root_id_for_path(session, new_path)
    if library_root_id is None:
        raise ServiceError(
            400,
            "Audio file path must be within a configured library root",
        )

    exists = session.exec(
        select(AudioItem).where(
            AudioItem.file_path == str(new_path),
            AudioItem.id != audio_id,
        )
    ).first()

    if exists:
        raise ServiceError(409, "Another audio item already uses this file path")

    stat = new_path.stat()
    file_hash = _calculate_audio_item_file_hash(session, new_path, stat.st_size)
    meta = read_audio_metadata(new_path)

    item.file_path = str(new_path)
    item.file_name = new_path.name
    item.file_ext = new_path.suffix.lower()
    item.file_size = stat.st_size
    item.file_mtime = utc_timestamp_iso(stat.st_mtime)
    item.file_hash = file_hash
    item.library_root_id = library_root_id
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
    session.refresh(item)
    logger.info("Audio item relocated id=%s path=%s", audio_id, new_path)

    return item


def update_playback_position(
    session: Session,
    audio_id: int,
    last_position_seconds: float,
) -> dict:
    item = session.get(AudioItem, audio_id)
    if not item:
        raise ServiceError(404, "Audio item not found")

    item.last_position_seconds = last_position_seconds
    item.last_played_at = now_iso()
    item.updated_at = now_iso()
    session.add(item)
    session.commit()
    return {"ok": True}


def increment_play_count(session: Session, audio_id: int) -> dict:
    item = session.get(AudioItem, audio_id)
    if not item:
        raise ServiceError(404, "Audio item not found")

    item.play_count += 1
    item.last_played_at = now_iso()
    item.updated_at = now_iso()
    session.add(item)
    session.commit()
    return {"ok": True}


def get_audio_file_response(session: Session, audio_id: int) -> FileResponse:
    item = session.get(AudioItem, audio_id)
    if not item:
        raise ServiceError(404, "Audio item not found")

    path = Path(item.file_path)
    if not path.exists():
        item.is_missing = True
        session.add(item)
        session.commit()
        raise ServiceError(404, "Audio file missing")

    media_type = AUDIO_MIME_TYPES.get(path.suffix.lower(), "application/octet-stream")
    return FileResponse(str(path), media_type=media_type, filename=item.file_name)


def get_audio_cover_response(session: Session, audio_id: int) -> FileResponse:
    item = session.get(AudioItem, audio_id)
    if not item:
        raise ServiceError(404, "Audio item not found")

    if not item.cover_path:
        raise ServiceError(404, "Cover not found")

    path = Path(item.cover_path)
    if not path.exists():
        raise ServiceError(404, "Cover file missing")

    return FileResponse(str(path), media_type=_cover_media_type(path))


def upload_audio_cover_data(
    session: Session,
    audio_id: int,
    original_name: str,
    content_type: str,
    data: bytes,
) -> AudioItem:
    item = session.get(AudioItem, audio_id)
    if not item:
        raise ServiceError(404, "Audio item not found")

    ext = Path(original_name or "").suffix.lower()

    if ext not in IMAGE_EXTS:
        if content_type == "image/png":
            ext = ".png"
        elif content_type in ["image/jpeg", "image/jpg"]:
            ext = ".jpg"
        elif content_type == "image/webp":
            ext = ".webp"
        else:
            raise ServiceError(400, "Unsupported image format")

    if not data:
        raise ServiceError(400, "Empty cover file")

    if len(data) > 10 * 1024 * 1024:
        raise ServiceError(400, "Cover file is too large")

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


def delete_audio_cover(session: Session, audio_id: int) -> AudioItem:
    item = session.get(AudioItem, audio_id)
    if not item:
        raise ServiceError(404, "Audio item not found")

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


def get_audio_ai_suggestions(session: Session, audio_id: int) -> dict:
    audio = session.get(AudioItem, audio_id)
    if not audio:
        raise ServiceError(404, "Audio item not found")

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
