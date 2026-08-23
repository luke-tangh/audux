from fastapi import APIRouter, Depends
from sqlmodel import Session

from ..db import get_session
from ..response_schemas import ExternalPreprocessingResponse, WhisperComponentResponse
from ..services import external_asr_service, whisper_component_service


router = APIRouter(prefix="/asr")


@router.get("/whisper-component", response_model=WhisperComponentResponse)
def get_whisper_component_status():
    return whisper_component_service.get_whisper_component_status()


@router.get("/external-preprocessing", response_model=ExternalPreprocessingResponse)
def get_external_preprocessing_status():
    return external_asr_service.get_preprocessing_status()


@router.post("/whisper-component/install", response_model=WhisperComponentResponse)
def install_whisper_component():
    return whisper_component_service.start_whisper_component_install()


@router.post(
    "/whisper-component/install/cancel",
    response_model=WhisperComponentResponse,
)
def cancel_whisper_component_install():
    return whisper_component_service.cancel_whisper_component_install()


@router.delete("/whisper-component", response_model=WhisperComponentResponse)
def remove_whisper_component(session: Session = Depends(get_session)):
    return whisper_component_service.remove_whisper_component(session)
