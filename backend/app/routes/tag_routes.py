from fastapi import APIRouter, Depends
from sqlmodel import Session

from ..db import get_session
from ..schemas import TagMergeRequest, TagUpdate, TagsAddRequest
from ..services import tag_service
from .utils import service_call


router = APIRouter()


@router.get("/tags")
def list_tags(session: Session = Depends(get_session)):
    return tag_service.list_tags(session)


@router.patch("/tags/{tag_id}")
def update_tag(
    tag_id: int,
    payload: TagUpdate,
    session: Session = Depends(get_session),
):
    return service_call(tag_service.update_tag, session, tag_id, payload.name)


@router.delete("/tags/{tag_id}")
def delete_tag(
    tag_id: int,
    force: bool = False,
    session: Session = Depends(get_session),
):
    return service_call(tag_service.delete_tag, session, tag_id, force)


@router.post("/tags/{tag_id}/merge")
def merge_tag(
    tag_id: int,
    payload: TagMergeRequest,
    session: Session = Depends(get_session),
):
    return service_call(
        tag_service.merge_tag,
        session,
        tag_id,
        payload.target_tag_id,
    )


@router.post("/audio-items/{audio_id}/tags")
def add_tags_to_audio(
    audio_id: int,
    payload: TagsAddRequest,
    session: Session = Depends(get_session),
):
    return service_call(
        tag_service.add_tags_to_audio,
        session,
        audio_id,
        payload.tags,
        payload.source,
    )


@router.delete("/audio-items/{audio_id}/tags/{tag_id}")
def remove_audio_tag(
    audio_id: int,
    tag_id: int,
    session: Session = Depends(get_session),
):
    return service_call(tag_service.remove_audio_tag, session, audio_id, tag_id)
