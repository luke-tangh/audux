from pathlib import Path
from typing import Optional

from sqlmodel import Session, select
from sqlalchemy import case, func

from ..logger import get_logger
from ..models import (
    AITask,
    AudioItem,
    AudioTag,
    LibraryRoot,
    Tag,
    now_iso,
)
from ..media_probe import (
    SUPPORTED_EXTS,
    calculate_file_fingerprint,
    extract_embedded_cover,
    get_scan_hash_strategy,
    read_audio_metadata,
)
from ..search import rebuild_audio_search_index, search_audio_ids_with_meta
from ..time_utils import utc_timestamp_iso
from .audio_deletion_service import delete_audio_item
from .audio_query import (
    audio_rows_with_tags_dicts,
    audio_sort_clauses,
    build_audio_items_stmt,
    tags_for_audio,
)
from .errors import ServiceError
from .media_paths import (
    delete_managed_cover_file,
    find_library_root_id_for_path,
    mark_audio_missing_if_unavailable_no_commit,
)
from .task_state import parse_task_output_payload


logger = get_logger(__name__)


def _calculate_audio_item_file_hash(
    session: Session,
    file_path: Path,
    file_size: Optional[int] = None,
) -> Optional[str]:
    try:
        return calculate_file_fingerprint(
            file_path,
            strategy=get_scan_hash_strategy(session),
            file_size=file_size,
        )
    except Exception as e:
        logger.warning("Failed to calculate relocated file hash for %s: %s", file_path, e)
        return None


def list_audio_items(
    session: Session,
    q: Optional[str] = None,
    tag: Optional[str] = None,
    tag_ids: Optional[list[int]] = None,
    excluded_tag_ids: Optional[list[int]] = None,
    tag_mode: str = "and",
    library_root_id: Optional[int] = None,
    has_transcript: Optional[bool] = None,
    transcript_status: Optional[str] = None,
    ai_status: Optional[str] = None,
    favorite: Optional[bool] = None,
    missing: Optional[bool] = None,
    missing_description: Optional[bool] = None,
    include_disabled_roots: bool = False,
    sort: str = "default",
    limit: int = 100,
    offset: int = 0,
) -> dict:
    search_result = search_audio_ids_with_meta(session, q) if q else None

    base_stmt = build_audio_items_stmt(
        session=session,
        q=q,
        search_ids=search_result.ids if search_result else None,
        tag=tag,
        tag_ids=tag_ids,
        excluded_tag_ids=excluded_tag_ids,
        tag_mode=tag_mode,
        library_root_id=library_root_id,
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
            "facets": {"tags": [], "roots": []},
        }

    total = session.execute(
        select(func.count()).select_from(base_stmt.subquery())
    ).scalar_one()

    if q and search_result and sort == "default":
        rank_by_id = {audio_id: index for index, audio_id in enumerate(search_result.ids)}
        sort_clauses = (case(rank_by_id, value=AudioItem.id), AudioItem.id.asc())
    else:
        sort_clauses = audio_sort_clauses(sort) or (
            AudioItem.updated_at.desc(),
            AudioItem.id.asc(),
        )
    stmt = base_stmt.order_by(*sort_clauses).offset(offset).limit(limit)
    rows = session.exec(stmt).all()

    filtered = base_stmt.subquery()
    tag_facets = session.execute(
        select(Tag.id, Tag.name, func.count(AudioTag.audio_id))
        .join(AudioTag, AudioTag.tag_id == Tag.id)
        .where(AudioTag.audio_id.in_(select(filtered.c.id)))
        .group_by(Tag.id, Tag.name)
        .order_by(func.count(AudioTag.audio_id).desc(), Tag.name.asc())
    ).all()
    root_facets = session.execute(
        select(LibraryRoot.id, LibraryRoot.path, func.count(AudioItem.id))
        .join(AudioItem, AudioItem.library_root_id == LibraryRoot.id)
        .where(AudioItem.id.in_(select(filtered.c.id)))
        .group_by(LibraryRoot.id, LibraryRoot.path)
        .order_by(LibraryRoot.path.asc())
    ).all()

    return {
        "items": audio_rows_with_tags_dicts(session, rows, search_query=q),
        "total": int(total or 0),
        "limit": limit,
        "offset": offset,
        "has_more": offset + len(rows) < int(total or 0),
        "search_limited": bool(search_result.limited) if search_result else False,
        "search_limit": search_result.limit if search_result else None,
        "facets": {
            "tags": [
                {"id": int(tag_id), "name": name, "count": int(count)}
                for tag_id, name, count in tag_facets
            ],
            "roots": [
                {"id": int(root_id), "path": path, "count": int(count)}
                for root_id, path, count in root_facets
            ],
        },
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
        if not mark_audio_missing_if_unavailable_no_commit(session, item):
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
        "items": audio_rows_with_tags_dicts(session, resolved),
        "skipped": skipped,
    }


def get_audio_item(session: Session, audio_id: int) -> dict:
    item = session.get(AudioItem, audio_id)
    if not item:
        raise ServiceError(404, "Audio item not found")

    tags = tags_for_audio(session, audio_id)

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
    try:
        session.flush()
        rebuild_audio_search_index(session, int(item.id), commit=False)
        session.commit()
        session.refresh(item)
    except Exception:
        session.rollback()
        raise
    return item


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

    library_root_id = find_library_root_id_for_path(session, new_path)
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
            delete_managed_cover_file(item.cover_path)
        item.cover_path = None
        item.cover_source = None
        cover = extract_embedded_cover(new_path, item.id)
        if cover:
            item.cover_path = cover["cover_path"]
            item.cover_source = cover["cover_source"]

    item.updated_at = now_iso()
    session.add(item)
    try:
        session.flush()
        rebuild_audio_search_index(session, int(item.id), commit=False)
        session.commit()
        session.refresh(item)
    except Exception:
        session.rollback()
        raise
    logger.info("Audio item relocated id=%s path=%s", audio_id, new_path)

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
        payload = parse_task_output_payload(task.output_payload)

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
