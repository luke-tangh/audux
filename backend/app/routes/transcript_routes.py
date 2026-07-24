from fastapi import APIRouter, Depends
from sqlmodel import Session

from ..db import get_session
from ..schemas import TranscriptCreate
from ..services import transcript_service
from .utils import service_call


router = APIRouter()


@router.post("/audio-items/{audio_id}/transcribe")
def enqueue_transcribe(audio_id: int, session: Session = Depends(get_session)):
    return service_call(transcript_service.enqueue_transcribe, session, audio_id)


@router.get("/audio-items/{audio_id}/transcript")
def get_transcript(audio_id: int, session: Session = Depends(get_session)):
    return service_call(transcript_service.get_transcript, session, audio_id)


@router.get("/audio-items/{audio_id}/transcript/export")
def export_transcript(
    audio_id: int,
    format: str = "txt",
    session: Session = Depends(get_session),
):
    return service_call(
        transcript_service.export_transcript_response,
        session,
        audio_id,
        format,
    )


@router.post("/audio-items/{audio_id}/transcript")
def save_transcript(
    audio_id: int,
    payload: TranscriptCreate,
    session: Session = Depends(get_session),
):
    return service_call(transcript_service.save_transcript, session, audio_id, payload)
