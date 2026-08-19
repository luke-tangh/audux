from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from ..db import get_session
from ..schemas import LLMConfig, LLMModelDiscoveryConfig
from ..services import ai_service
from ..services.common import ServiceError
from .utils import raise_http, service_call


router = APIRouter()


@router.post("/audio-items/{audio_id}/analyze")
def enqueue_analyze(audio_id: int, session: Session = Depends(get_session)):
    return service_call(ai_service.enqueue_analyze, session, audio_id)


@router.post("/ai/test-llm")
async def test_llm_config(payload: LLMConfig):
    try:
        return await ai_service.test_llm_config(payload)
    except ServiceError as error:
        raise_http(error)


@router.post("/ai/models")
async def discover_llm_models(payload: LLMModelDiscoveryConfig):
    try:
        return await ai_service.discover_llm_models(payload)
    except ServiceError as error:
        raise_http(error)


@router.get("/ai-tasks")
def list_ai_tasks(
    status: Optional[str] = None,
    task_type: Optional[str] = None,
    audio_id: Optional[int] = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
):
    return ai_service.list_ai_tasks(
        session=session,
        status=status,
        task_type=task_type,
        audio_id=audio_id,
        limit=limit,
        offset=offset,
    )


@router.get("/ai-tasks/{task_id}")
def get_ai_task(task_id: int, session: Session = Depends(get_session)):
    return service_call(ai_service.get_ai_task, session, task_id)


@router.post("/ai-tasks/{task_id}/retry")
def retry_ai_task(task_id: int, session: Session = Depends(get_session)):
    return service_call(ai_service.retry_ai_task, session, task_id)


@router.post("/ai-tasks/{task_id}/cancel")
def cancel_ai_task(task_id: int, session: Session = Depends(get_session)):
    return service_call(ai_service.cancel_ai_task, session, task_id)
