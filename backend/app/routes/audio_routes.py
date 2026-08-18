from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlmodel import Session

from ..db import get_session
from ..schemas import (
    AudioUpdate,
    AudioSortMode,
    BatchAudioRequest,
    BatchOrganizationRequest,
    PlaybackEventCreate,
    PlaybackEventUpdate,
    PlaybackPositionUpdate,
    PlaybackQueueResolveRequest,
    RelocateAudioRequest,
)
from ..services import audio_service, organization_service
from ..services.common import ServiceError
from .utils import raise_http, service_call


router = APIRouter()


@router.get("/audio-items")
def list_audio_items(
    q: Optional[str] = None,
    tag: Optional[str] = None,
    tag_ids: Optional[list[int]] = Query(default=None),
    excluded_tag_ids: Optional[list[int]] = Query(default=None),
    tag_mode: Literal["and", "or"] = "and",
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
    return audio_service.list_audio_items(
        session=session,
        q=q,
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
        sort=sort,
        limit=limit,
        offset=offset,
    )


@router.post("/audio-items/batch/transcribe")
def batch_transcribe(
    payload: BatchAudioRequest,
    session: Session = Depends(get_session),
):
    return service_call(audio_service.batch_transcribe, session, payload.audio_ids)


@router.post("/audio-items/batch/analyze")
def batch_analyze(
    payload: BatchAudioRequest,
    session: Session = Depends(get_session),
):
    return service_call(audio_service.batch_analyze, session, payload.audio_ids)


@router.post("/audio-items/batch/organize")
def batch_organize_audio(
    payload: BatchOrganizationRequest,
    session: Session = Depends(get_session),
):
    return service_call(
        organization_service.batch_organize_audio,
        session,
        payload.model_dump(),
    )


@router.post("/audio-items/playback-queue/resolve")
def resolve_playback_queue(
    payload: PlaybackQueueResolveRequest,
    session: Session = Depends(get_session),
):
    return service_call(
        audio_service.resolve_playback_queue,
        session,
        payload.audio_ids,
    )


@router.get("/audio-items/{audio_id}")
def get_audio_item(audio_id: int, session: Session = Depends(get_session)):
    return service_call(audio_service.get_audio_item, session, audio_id)


@router.patch("/audio-items/{audio_id}")
def update_audio_item(
    audio_id: int,
    payload: AudioUpdate,
    session: Session = Depends(get_session),
):
    return service_call(
        audio_service.update_audio_item,
        session,
        audio_id,
        payload.model_dump(exclude_unset=True),
    )


@router.delete("/audio-items/{audio_id}")
def delete_audio_item(
    audio_id: int,
    delete_file: bool = False,
    session: Session = Depends(get_session),
):
    return service_call(audio_service.delete_audio_item, session, audio_id, delete_file)


@router.post("/audio-items/{audio_id}/relocate")
def relocate_audio_item(
    audio_id: int,
    payload: RelocateAudioRequest,
    session: Session = Depends(get_session),
):
    return service_call(audio_service.relocate_audio_item, session, audio_id, payload.file_path)


@router.post("/audio-items/{audio_id}/playback-position")
def update_playback_position(
    audio_id: int,
    payload: PlaybackPositionUpdate,
    session: Session = Depends(get_session),
):
    return service_call(
        audio_service.update_playback_position,
        session,
        audio_id,
        payload.last_position_seconds,
    )


@router.post("/audio-items/{audio_id}/play-count")
def increment_play_count(audio_id: int, session: Session = Depends(get_session)):
    return service_call(audio_service.increment_play_count, session, audio_id)


@router.post("/audio-items/{audio_id}/playback-events")
def start_playback_event(
    audio_id: int,
    payload: PlaybackEventCreate,
    session: Session = Depends(get_session),
):
    return service_call(
        audio_service.start_playback_event,
        session,
        audio_id,
        payload.start_position_seconds,
    )


@router.patch("/playback-events/{event_id}")
def update_playback_event(
    event_id: int,
    payload: PlaybackEventUpdate,
    session: Session = Depends(get_session),
):
    return service_call(
        audio_service.update_playback_event,
        session,
        event_id,
        **payload.model_dump(),
    )


@router.get("/audio-items/{audio_id}/file")
def get_audio_file(audio_id: int, session: Session = Depends(get_session)):
    return service_call(audio_service.get_audio_file_response, session, audio_id)


@router.get("/audio-items/{audio_id}/cover")
def get_audio_cover(audio_id: int, session: Session = Depends(get_session)):
    return service_call(audio_service.get_audio_cover_response, session, audio_id)


@router.post("/audio-items/{audio_id}/cover")
async def upload_audio_cover(
    audio_id: int,
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
):
    try:
        data = await file.read()
        return audio_service.upload_audio_cover_data(
            session=session,
            audio_id=audio_id,
            original_name=file.filename or "",
            content_type=file.content_type or "",
            data=data,
        )
    except ServiceError as error:
        raise_http(error)


@router.delete("/audio-items/{audio_id}/cover")
def delete_audio_cover(audio_id: int, session: Session = Depends(get_session)):
    return service_call(audio_service.delete_audio_cover, session, audio_id)


@router.get("/audio-items/{audio_id}/ai-suggestions")
def get_audio_ai_suggestions(audio_id: int, session: Session = Depends(get_session)):
    return service_call(audio_service.get_audio_ai_suggestions, session, audio_id)
