from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from ..db import get_session
from ..schemas import LLMConfig, LLMModelDiscoveryConfig
from ..response_schemas import (
    AITaskResponse,
    LLMModelsResponse,
    LLMTestResponse,
    ToolSchemasResponse,
)
from ..services import ai_service
from ..tool_registry import DEFAULT_TOOL_REGISTRY


router = APIRouter()


@router.get("/ai/tools", response_model=ToolSchemasResponse)
def list_agent_tools():
    return {"tools": DEFAULT_TOOL_REGISTRY.schemas(maximum_permission="read")}


@router.post("/audio-items/{audio_id}/analyze", response_model=AITaskResponse)
def enqueue_analyze(audio_id: int, session: Session = Depends(get_session)):
    return ai_service.enqueue_analyze(session, audio_id)


@router.post("/ai/test-llm", response_model=LLMTestResponse)
async def test_llm_config(payload: LLMConfig):
    return await ai_service.test_llm_config(payload)


@router.post("/ai/models", response_model=LLMModelsResponse)
async def discover_llm_models(payload: LLMModelDiscoveryConfig):
    return await ai_service.discover_llm_models(payload)


@router.get("/ai-tasks", response_model=list[AITaskResponse])
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


@router.get("/ai-tasks/{task_id}", response_model=AITaskResponse)
def get_ai_task(task_id: int, session: Session = Depends(get_session)):
    return ai_service.get_ai_task(session, task_id)


@router.post("/ai-tasks/{task_id}/retry", response_model=AITaskResponse)
def retry_ai_task(task_id: int, session: Session = Depends(get_session)):
    return ai_service.retry_ai_task(session, task_id)


@router.post("/ai-tasks/{task_id}/cancel", response_model=AITaskResponse)
def cancel_ai_task(task_id: int, session: Session = Depends(get_session)):
    return ai_service.cancel_ai_task(session, task_id)
