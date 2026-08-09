from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from ..db import get_session
from ..schemas import (
    AudioSortMode,
    PlaylistCreate,
    PlaylistItemAdd,
    PlaylistItemsReorder,
    PlaylistUpdate,
    SmartPlaylistCreate,
)
from ..services import playlist_service
from .utils import service_call


router = APIRouter()


@router.post("/playlists")
def create_playlist(
    payload: PlaylistCreate,
    session: Session = Depends(get_session),
):
    return playlist_service.create_playlist(session, payload.name, payload.description)


@router.get("/playlists")
def list_playlists(session: Session = Depends(get_session)):
    return playlist_service.list_playlists(session)


@router.post("/playlists/smart")
def create_smart_playlist(
    payload: SmartPlaylistCreate,
    session: Session = Depends(get_session),
):
    return service_call(
        playlist_service.create_smart_playlist,
        session,
        payload.saved_view_id,
        payload.name,
        payload.description,
    )


@router.patch("/playlists/{playlist_id}")
def update_playlist(
    playlist_id: int,
    payload: PlaylistUpdate,
    session: Session = Depends(get_session),
):
    return service_call(
        playlist_service.update_playlist,
        session,
        playlist_id,
        payload.name,
    )


@router.delete("/playlists/{playlist_id}")
def delete_playlist(
    playlist_id: int,
    session: Session = Depends(get_session),
):
    return service_call(playlist_service.delete_playlist, session, playlist_id)


@router.get("/playlists/{playlist_id}")
def get_playlist(
    playlist_id: int,
    include_disabled_roots: bool = False,
    session: Session = Depends(get_session),
):
    return service_call(
        playlist_service.get_playlist,
        session,
        playlist_id,
        include_disabled_roots,
    )


@router.get("/playlists/{playlist_id}/items")
def list_playlist_audio_items(
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
    sort: AudioSortMode = "default",
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
):
    return service_call(
        playlist_service.list_playlist_audio_items,
        session=session,
        playlist_id=playlist_id,
        q=q,
        tag=tag,
        library_root_id=library_root_id,
        has_transcript=has_transcript,
        transcript_status=transcript_status,
        ai_status=ai_status,
        favorite=favorite,
        missing=missing,
        missing_description=missing_description,
        include_disabled_roots=include_disabled_roots,
        sort=sort,
        limit=limit,
        offset=offset,
    )


@router.post("/playlists/{playlist_id}/items")
def add_audio_to_playlist(
    playlist_id: int,
    payload: PlaylistItemAdd,
    session: Session = Depends(get_session),
):
    return service_call(
        playlist_service.add_audio_to_playlist,
        session,
        playlist_id,
        payload.audio_id,
    )


@router.patch("/playlists/{playlist_id}/items/reorder")
def reorder_playlist_items(
    playlist_id: int,
    payload: PlaylistItemsReorder,
    session: Session = Depends(get_session),
):
    return service_call(
        playlist_service.reorder_playlist_items,
        session,
        playlist_id,
        payload.item_ids,
    )


@router.delete("/playlists/{playlist_id}/items/{item_id}")
def remove_playlist_item(
    playlist_id: int,
    item_id: int,
    session: Session = Depends(get_session),
):
    return service_call(
        playlist_service.remove_playlist_item,
        session,
        playlist_id,
        item_id,
    )


@router.get("/playlists/{playlist_id}/export")
def export_playlist(
    playlist_id: int,
    format: str = "json",
    include_disabled_roots: bool = False,
    session: Session = Depends(get_session),
):
    return service_call(
        playlist_service.export_playlist_response,
        session,
        playlist_id,
        format,
        include_disabled_roots,
    )
