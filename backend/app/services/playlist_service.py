import json
from typing import Optional

from fastapi.responses import PlainTextResponse, Response
from sqlalchemy import and_, func, or_
from sqlmodel import Session, select

from ..models import AudioItem, AudioTag, Playlist, PlaylistItem, Tag, now_iso
from ..search import search_audio_ids_with_meta
from .common import (
    ServiceError,
    _apply_enabled_roots_filter,
    _attachment_headers,
    _audio_rows_with_tags_dicts,
    _audio_with_tags_dict,
)


def create_playlist(
    session: Session,
    name: str,
    description: Optional[str] = None,
) -> Playlist:
    normalized_name = name.strip()
    if not normalized_name:
        raise ServiceError(400, "Playlist name is required")

    playlist = Playlist(name=normalized_name, description=description)
    session.add(playlist)
    session.commit()
    session.refresh(playlist)
    return playlist


def list_playlists(session: Session) -> list[Playlist]:
    return session.exec(select(Playlist).order_by(Playlist.created_at)).all()


def update_playlist(
    session: Session,
    playlist_id: int,
    name: str,
) -> Playlist:
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
    return playlist


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
        "playlist": playlist,
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
    playlist = session.get(Playlist, playlist_id)
    if not playlist:
        raise ServiceError(404, "Playlist not found")

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

    rows = session.exec(
        stmt.order_by(PlaylistItem.order_index).offset(offset).limit(limit)
    ).all()

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
    item = session.get(PlaylistItem, item_id)
    if not item or item.playlist_id != playlist_id:
        raise ServiceError(404, "Playlist item not found")

    playlist = session.get(Playlist, playlist_id)

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
