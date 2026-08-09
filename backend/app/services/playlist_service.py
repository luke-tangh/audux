import json
from typing import Optional

from fastapi.responses import PlainTextResponse, Response
from sqlalchemy import and_, func, or_
from sqlmodel import Session, select

from ..models import AudioItem, AudioTag, Playlist, PlaylistItem, SavedView, Tag, now_iso
from ..search import search_audio_ids_with_meta
from . import audio_service
from .common import (
    ServiceError,
    _apply_enabled_roots_filter,
    _attachment_headers,
    _audio_rows_with_tags_dicts,
    _audio_sort_clauses,
    _audio_with_tags_dict,
)
from .saved_view_service import (
    audio_query_kwargs,
    decode_saved_view_query,
    serialize_saved_view_definition,
)


SMART_PLAYLIST_KIND = "smart"


def create_playlist(
    session: Session,
    name: str,
    description: Optional[str] = None,
) -> dict:
    normalized_name = name.strip()
    if not normalized_name:
        raise ServiceError(400, "Playlist name is required")

    playlist = Playlist(name=normalized_name, description=description)
    session.add(playlist)
    session.commit()
    session.refresh(playlist)
    return _serialize_playlist(session, playlist, include_count=False)


def create_smart_playlist(
    session: Session,
    saved_view_id: int,
    name: str | None = None,
    description: str | None = None,
) -> dict:
    saved_view = session.get(SavedView, saved_view_id)
    if not saved_view:
        raise ServiceError(404, "Saved view not found", "saved_view.not_found")

    query, definition_error = decode_saved_view_query(
        saved_view.query_json,
        saved_view.schema_version,
    )
    if not query:
        raise ServiceError(
            409,
            "Saved view definition is invalid",
            "saved_view.definition_invalid",
            {"reason": definition_error or "invalid definition"},
        )

    normalized_name = (name if name is not None else saved_view.name).strip()
    if not normalized_name:
        raise ServiceError(400, "Playlist name is required")

    playlist = Playlist(
        name=normalized_name,
        description=description,
        kind=SMART_PLAYLIST_KIND,
        query_json=saved_view.query_json,
        query_schema_version=saved_view.schema_version,
    )
    session.add(playlist)
    session.commit()
    session.refresh(playlist)
    return _serialize_playlist(session, playlist, include_count=True)


def _smart_playlist_query(playlist: Playlist):
    query, definition_error = decode_saved_view_query(
        playlist.query_json,
        playlist.query_schema_version,
    )
    if not query:
        raise ServiceError(
            409,
            "Smart playlist definition is invalid",
            "playlist.definition_invalid",
            {"reason": definition_error or "invalid definition"},
        )
    return query


def _list_smart_playlist_audio_items(
    session: Session,
    playlist: Playlist,
    *,
    include_disabled_roots: bool = False,
    limit: int = 100,
    offset: int = 0,
    record_refresh: bool = False,
) -> dict:
    query = _smart_playlist_query(playlist)
    page = audio_service.list_audio_items(
        session,
        **audio_query_kwargs(session, query),
        include_disabled_roots=include_disabled_roots,
        limit=limit,
        offset=offset,
    )
    if record_refresh:
        playlist.last_refreshed_at = now_iso()
        session.add(playlist)
        session.commit()
        session.refresh(playlist)
    return {
        **page,
        "playlist_kind": SMART_PLAYLIST_KIND,
        "refreshed_at": playlist.last_refreshed_at,
    }


def _serialize_playlist(
    session: Session,
    playlist: Playlist,
    *,
    include_count: bool,
) -> dict:
    data = playlist.model_dump(exclude={"query_json"})
    if playlist.kind != SMART_PLAYLIST_KIND:
        return {
            **data,
            "query": None,
            "tag_name": None,
            "library_root_path": None,
            "invalid_references": [],
            "definition_error": None,
            "current_count": None,
        }

    definition = serialize_saved_view_definition(
        session,
        playlist.query_json,
        playlist.query_schema_version,
    )
    current_count: int | None = None
    if include_count and definition["query"] is not None:
        try:
            current_count = _list_smart_playlist_audio_items(
                session,
                playlist,
                limit=1,
                offset=0,
            )["total"]
        except ServiceError:
            current_count = None
    return {
        **data,
        **definition,
        "current_count": current_count,
    }


def _ensure_manual_playlist(playlist: Playlist) -> None:
    if playlist.kind == SMART_PLAYLIST_KIND:
        raise ServiceError(
            409,
            "Smart playlist membership is rule-driven",
            "playlist.rule_driven",
        )


def list_playlists(session: Session) -> list[dict]:
    rows = session.exec(select(Playlist).order_by(Playlist.created_at)).all()
    return [_serialize_playlist(session, row, include_count=True) for row in rows]


def update_playlist(
    session: Session,
    playlist_id: int,
    name: str,
) -> dict:
    playlist = session.get(Playlist, playlist_id)
    if not playlist:
        raise ServiceError(404, "Playlist not found")

    normalized_name = name.strip()
    if not normalized_name:
        raise ServiceError(400, "Playlist name is required")

    playlist.name = normalized_name
    playlist.updated_at = now_iso()
    session.add(playlist)
    session.commit()
    session.refresh(playlist)
    return _serialize_playlist(session, playlist, include_count=False)


def delete_playlist(session: Session, playlist_id: int) -> dict:
    playlist = session.get(Playlist, playlist_id)
    if not playlist:
        raise ServiceError(404, "Playlist not found")
    items = session.exec(
        select(PlaylistItem).where(PlaylistItem.playlist_id == playlist_id)
    ).all()

    for item in items:
        session.delete(item)

    session.flush()
    session.delete(playlist)
    session.commit()

    return {"ok": True, "removed_items": len(items)}


def get_playlist(
    session: Session,
    playlist_id: int,
    include_disabled_roots: bool = False,
) -> dict:
    playlist = session.get(Playlist, playlist_id)
    if not playlist:
        raise ServiceError(404, "Playlist not found")
    if playlist.kind == SMART_PLAYLIST_KIND:
        return {
            "playlist": _serialize_playlist(session, playlist, include_count=True),
            "items": [],
        }

    stmt = (
        select(PlaylistItem, AudioItem)
        .join(AudioItem, PlaylistItem.audio_id == AudioItem.id)
        .where(PlaylistItem.playlist_id == playlist_id)
    )

    stmt = _apply_enabled_roots_filter(
        stmt,
        session,
        include_disabled_roots=include_disabled_roots,
    )

    items = session.exec(stmt.order_by(PlaylistItem.order_index)).all()

    audio_dicts = _audio_rows_with_tags_dicts(session, [audio for _, audio in items])
    audio_by_id = {row["id"]: row for row in audio_dicts}

    return {
        "playlist": _serialize_playlist(session, playlist, include_count=True),
        "items": [
            {
                "playlist_item": pi,
                "audio": audio_by_id.get(audio.id) or _audio_with_tags_dict(session, audio),
            }
            for pi, audio in items
        ],
    }


def list_playlist_audio_items(
    session: Session,
    playlist_id: int,
    q: Optional[str] = None,
    tag: Optional[str] = None,
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
    playlist = session.get(Playlist, playlist_id)
    if not playlist:
        raise ServiceError(404, "Playlist not found")

    if playlist.kind == SMART_PLAYLIST_KIND:
        return _list_smart_playlist_audio_items(
            session,
            playlist,
            include_disabled_roots=include_disabled_roots,
            limit=limit,
            offset=offset,
            record_refresh=offset == 0,
        )

    search_result = search_audio_ids_with_meta(session, q) if q else None

    if q and search_result and not search_result.ids:
        return {
            "items": [],
            "total": 0,
            "limit": limit,
            "offset": offset,
            "has_more": False,
            "search_limited": bool(search_result.limited),
            "search_limit": search_result.limit,
        }

    stmt = (
        select(PlaylistItem, AudioItem)
        .join(AudioItem, PlaylistItem.audio_id == AudioItem.id)
        .where(PlaylistItem.playlist_id == playlist_id)
    )

    stmt = _apply_enabled_roots_filter(
        stmt,
        session,
        include_disabled_roots=include_disabled_roots,
    )

    if library_root_id is not None:
        stmt = stmt.where(AudioItem.library_root_id == library_root_id)

    if q and search_result:
        stmt = stmt.where(AudioItem.id.in_(search_result.ids))

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
            return {
                "items": [],
                "total": 0,
                "limit": limit,
                "offset": offset,
                "has_more": False,
                "search_limited": bool(search_result.limited) if search_result else False,
                "search_limit": search_result.limit if search_result else None,
            }

        audio_ids = session.exec(
            select(AudioTag.audio_id).where(AudioTag.tag_id == tag_row.id)
        ).all()

        if not audio_ids:
            return {
                "items": [],
                "total": 0,
                "limit": limit,
                "offset": offset,
                "has_more": False,
                "search_limited": bool(search_result.limited) if search_result else False,
                "search_limit": search_result.limit if search_result else None,
            }

        stmt = stmt.where(AudioItem.id.in_(audio_ids))

    total = session.execute(
        select(func.count()).select_from(stmt.subquery())
    ).scalar_one()

    sort_clauses = _audio_sort_clauses(sort) or (
        PlaylistItem.order_index.asc(),
        PlaylistItem.id.asc(),
    )
    rows = session.exec(stmt.order_by(*sort_clauses).offset(offset).limit(limit)).all()

    audio_rows = [audio for _, audio in rows]
    audio_dicts = _audio_rows_with_tags_dicts(session, audio_rows, search_query=q)

    items = []
    for (playlist_item, _), audio_dict in zip(rows, audio_dicts):
        row = dict(audio_dict)
        row["playlist_item_id"] = playlist_item.id
        row["playlist_order_index"] = playlist_item.order_index
        items.append(row)

    return {
        "items": items,
        "total": int(total or 0),
        "limit": limit,
        "offset": offset,
        "has_more": offset + len(rows) < int(total or 0),
        "search_limited": bool(search_result.limited) if search_result else False,
        "search_limit": search_result.limit if search_result else None,
    }


def add_audio_to_playlist(
    session: Session,
    playlist_id: int,
    audio_id: int,
) -> PlaylistItem:
    playlist = session.get(Playlist, playlist_id)
    if not playlist:
        raise ServiceError(404, "Playlist not found")
    _ensure_manual_playlist(playlist)

    audio = session.get(AudioItem, audio_id)
    if not audio:
        raise ServiceError(404, "Audio not found")

    max_order = session.exec(
        select(func.max(PlaylistItem.order_index)).where(
            PlaylistItem.playlist_id == playlist_id
        )
    ).one()

    next_order = 0 if max_order is None else max_order + 1

    item = PlaylistItem(
        playlist_id=playlist_id,
        audio_id=audio_id,
        order_index=next_order,
    )
    session.add(item)

    playlist.updated_at = now_iso()
    session.add(playlist)

    session.commit()
    session.refresh(item)
    return item


def reorder_playlist_items(
    session: Session,
    playlist_id: int,
    item_ids: list[int],
) -> dict:
    playlist = session.get(Playlist, playlist_id)
    if not playlist:
        raise ServiceError(404, "Playlist not found")
    _ensure_manual_playlist(playlist)

    items = session.exec(
        select(PlaylistItem).where(PlaylistItem.playlist_id == playlist_id)
    ).all()

    current_by_id = {item.id: item for item in items}
    requested_ids = item_ids

    if len(requested_ids) != len(set(requested_ids)):
        raise ServiceError(400, "Duplicate playlist item ids")

    if set(requested_ids) != set(current_by_id.keys()):
        raise ServiceError(400, "item_ids must exactly match current playlist items")

    for order_index, item_id in enumerate(requested_ids):
        row = current_by_id[item_id]
        row.order_index = order_index
        session.add(row)

    playlist.updated_at = now_iso()
    session.add(playlist)

    session.commit()

    return {
        "ok": True,
        "count": len(requested_ids),
    }


def remove_playlist_item(
    session: Session,
    playlist_id: int,
    item_id: int,
) -> dict:
    playlist = session.get(Playlist, playlist_id)
    if not playlist:
        raise ServiceError(404, "Playlist not found")
    _ensure_manual_playlist(playlist)

    item = session.get(PlaylistItem, item_id)
    if not item or item.playlist_id != playlist_id:
        raise ServiceError(404, "Playlist item not found")

    session.delete(item)

    if playlist:
        playlist.updated_at = now_iso()
        session.add(playlist)

    session.commit()
    return {"ok": True}


def export_playlist_response(
    session: Session,
    playlist_id: int,
    format: str = "json",
    include_disabled_roots: bool = False,
):
    playlist = session.get(Playlist, playlist_id)
    if not playlist:
        raise ServiceError(404, "Playlist not found")

    rows = []
    smart_audio_rows: list[dict] = []
    if playlist.kind == SMART_PLAYLIST_KIND:
        offset = 0
        while True:
            page = _list_smart_playlist_audio_items(
                session,
                playlist,
                include_disabled_roots=include_disabled_roots,
                limit=500,
                offset=offset,
                record_refresh=offset == 0,
            )
            smart_audio_rows.extend(page["items"])
            if not page["has_more"]:
                break
            offset += len(page["items"])
    else:
        stmt = (
            select(PlaylistItem, AudioItem)
            .join(AudioItem, PlaylistItem.audio_id == AudioItem.id)
            .where(PlaylistItem.playlist_id == playlist_id)
        )

        stmt = _apply_enabled_roots_filter(
            stmt,
            session,
            include_disabled_roots=include_disabled_roots,
        )

        rows = session.exec(stmt.order_by(PlaylistItem.order_index)).all()

    if format == "m3u":
        lines = ["#EXTM3U"]
        audio_rows = smart_audio_rows or [audio.model_dump() for _, audio in rows]
        for audio in audio_rows:
            duration = int(audio.get("duration_seconds") or -1)
            title = (
                audio.get("title_user")
                or audio.get("title_original")
                or audio["file_name"]
            )
            lines.append(f"#EXTINF:{duration},{title}")
            lines.append(audio["file_path"])

        return PlainTextResponse(
            "\n".join(lines),
            media_type="audio/x-mpegurl",
            headers=_attachment_headers(f"{playlist.name}.m3u"),
        )

    data = {
        "playlist": _serialize_playlist(session, playlist, include_count=False),
        "items": (
            [{"audio": audio} for audio in smart_audio_rows]
            if playlist.kind == SMART_PLAYLIST_KIND
            else [
                {
                    "playlist_item": pi.model_dump(),
                    "audio": audio.model_dump(),
                }
                for pi, audio in rows
            ]
        ),
    }

    return Response(
        json.dumps(data, ensure_ascii=False, indent=2),
        media_type="application/json",
        headers=_attachment_headers(f"{playlist.name}.json"),
    )
