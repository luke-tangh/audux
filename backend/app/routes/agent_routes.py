import json

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlmodel import Session

from ..db import get_session
from ..response_schemas import (
    AgentConversationResponse,
    AgentOperationPlanResponse,
    AgentRunResponse,
    OkResponse,
)
from ..schemas import AgentConversationCreate, AgentConversationUpdate, AgentOperationApproval, AgentRunCreate
from ..services import agent_operation_service, agent_service


router = APIRouter()


@router.get(
    "/agent/conversations",
    response_model=list[AgentConversationResponse],
)
def list_conversations(session: Session = Depends(get_session)):
    return agent_service.list_conversations(session)


@router.post("/agent/conversations", response_model=AgentConversationResponse)
def create_conversation(payload: AgentConversationCreate, session: Session = Depends(get_session)):
    return agent_service.create_conversation(session, payload)


@router.get(
    "/agent/conversations/{conversation_id}",
    response_model=AgentConversationResponse,
)
def get_conversation(conversation_id: int, session: Session = Depends(get_session)):
    return agent_service.get_conversation(session, conversation_id)


@router.patch(
    "/agent/conversations/{conversation_id}",
    response_model=AgentConversationResponse,
)
def update_conversation(conversation_id: int, payload: AgentConversationUpdate, session: Session = Depends(get_session)):
    return agent_service.update_conversation(session, conversation_id, payload)


@router.delete(
    "/agent/conversations/{conversation_id}",
    response_model=OkResponse,
)
def delete_conversation(conversation_id: int, session: Session = Depends(get_session)):
    return agent_service.delete_conversation(session, conversation_id)


@router.get(
    "/agent/conversations/{conversation_id}/export",
    response_class=Response,
)
def export_conversation(conversation_id: int, session: Session = Depends(get_session)):
    payload = agent_service.export_conversation(session, conversation_id)
    return Response(
        json.dumps(payload, ensure_ascii=False, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename=audux-agent-{conversation_id}.json"},
    )


@router.post(
    "/agent/conversations/{conversation_id}/runs",
    response_model=AgentRunResponse,
)
def create_run(conversation_id: int, payload: AgentRunCreate, session: Session = Depends(get_session)):
    return agent_service.create_run(session, conversation_id, payload)


@router.get("/agent/runs/{run_id}", response_model=AgentRunResponse)
def get_run(run_id: int, session: Session = Depends(get_session)):
    return agent_service.get_run(session, run_id)


@router.post("/agent/runs/{run_id}/cancel", response_model=AgentRunResponse)
def cancel_run(run_id: int, session: Session = Depends(get_session)):
    return agent_service.cancel_run(session, run_id)


@router.get(
    "/agent/operation-plans/{plan_id}",
    response_model=AgentOperationPlanResponse,
)
def get_operation_plan(plan_id: int, session: Session = Depends(get_session)):
    return agent_operation_service.get_plan(session, plan_id)


@router.post(
    "/agent/operation-plans/{plan_id}/approve",
    response_model=AgentOperationPlanResponse,
)
def approve_operation_plan(
    plan_id: int,
    payload: AgentOperationApproval,
    session: Session = Depends(get_session),
):
    return agent_operation_service.approve_and_execute(
        session,
        plan_id,
        payload.fingerprint,
    )


@router.post(
    "/agent/operation-plans/{plan_id}/reject",
    response_model=AgentOperationPlanResponse,
)
def reject_operation_plan(plan_id: int, session: Session = Depends(get_session)):
    return agent_operation_service.reject_plan(session, plan_id)
