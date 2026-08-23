import json

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlmodel import Session

from ..db import get_session
from ..schemas import AgentConversationCreate, AgentConversationUpdate, AgentOperationApproval, AgentRunCreate
from ..services import agent_operation_service, agent_service
from .utils import service_call


router = APIRouter()


@router.get("/agent/conversations")
def list_conversations(session: Session = Depends(get_session)):
    return agent_service.list_conversations(session)


@router.post("/agent/conversations")
def create_conversation(payload: AgentConversationCreate, session: Session = Depends(get_session)):
    return service_call(agent_service.create_conversation, session, payload)


@router.get("/agent/conversations/{conversation_id}")
def get_conversation(conversation_id: int, session: Session = Depends(get_session)):
    return service_call(agent_service.get_conversation, session, conversation_id)


@router.patch("/agent/conversations/{conversation_id}")
def update_conversation(conversation_id: int, payload: AgentConversationUpdate, session: Session = Depends(get_session)):
    return service_call(agent_service.update_conversation, session, conversation_id, payload)


@router.delete("/agent/conversations/{conversation_id}")
def delete_conversation(conversation_id: int, session: Session = Depends(get_session)):
    return service_call(agent_service.delete_conversation, session, conversation_id)


@router.get("/agent/conversations/{conversation_id}/export")
def export_conversation(conversation_id: int, session: Session = Depends(get_session)):
    payload = service_call(agent_service.export_conversation, session, conversation_id)
    return Response(
        json.dumps(payload, ensure_ascii=False, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename=audux-agent-{conversation_id}.json"},
    )


@router.post("/agent/conversations/{conversation_id}/runs")
def create_run(conversation_id: int, payload: AgentRunCreate, session: Session = Depends(get_session)):
    return service_call(agent_service.create_run, session, conversation_id, payload)


@router.get("/agent/runs/{run_id}")
def get_run(run_id: int, session: Session = Depends(get_session)):
    return service_call(agent_service.get_run, session, run_id)


@router.post("/agent/runs/{run_id}/cancel")
def cancel_run(run_id: int, session: Session = Depends(get_session)):
    return service_call(agent_service.cancel_run, session, run_id)


@router.get("/agent/operation-plans/{plan_id}")
def get_operation_plan(plan_id: int, session: Session = Depends(get_session)):
    return service_call(agent_operation_service.get_plan, session, plan_id)


@router.post("/agent/operation-plans/{plan_id}/approve")
def approve_operation_plan(
    plan_id: int,
    payload: AgentOperationApproval,
    session: Session = Depends(get_session),
):
    return service_call(
        agent_operation_service.approve_and_execute,
        session,
        plan_id,
        payload.fingerprint,
    )


@router.post("/agent/operation-plans/{plan_id}/reject")
def reject_operation_plan(plan_id: int, session: Session = Depends(get_session)):
    return service_call(agent_operation_service.reject_plan, session, plan_id)
