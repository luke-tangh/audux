from __future__ import annotations

import json

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from ..models import (
    AgentCitation,
    AgentConversation,
    AgentMessage,
    AgentOperationAuditEvent,
    AgentOperationItem,
    AgentOperationPlan,
    AgentRun,
    AgentRunStep,
    AgentToolCall,
    AudioItem,
    Transcript,
    TranscriptSegment,
    now_iso,
)
from ..schemas import AgentConversationCreate, AgentConversationUpdate, AgentRunCreate, AgentScope
from .errors import ServiceError
from .retrieval_service import resolve_scope, scope_payload
from . import agent_operation_service


ACTIVE_RUN_STATUSES = {"pending", "running", "cancel_requested"}


def _json(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _scope_from_json(value: str) -> AgentScope:
    try:
        return AgentScope.model_validate(json.loads(value))
    except Exception as error:
        raise ServiceError(409, "Stored Agent scope is invalid", "agent.scope_invalid") from error


def _conversation(session: Session, conversation_id: int) -> AgentConversation:
    row = session.get(AgentConversation, conversation_id)
    if not row:
        raise ServiceError(404, "Agent conversation not found", "agent.conversation_not_found")
    return row


def _serialize_conversation(session: Session, row: AgentConversation, *, include_messages: bool = False) -> dict:
    scope = _scope_from_json(row.scope_json)
    try:
        resolved = resolve_scope(session, scope)
        scope_label = resolved.label
        scope_audio_count = len(resolved.audio_ids)
        scope_error = None
    except ServiceError as error:
        scope_label = "范围不可用"
        scope_audio_count = 0
        scope_error = error.code
    payload = {
        **row.model_dump(exclude={"scope_json"}),
        "scope": scope_payload(scope),
        "scope_label": scope_label,
        "scope_audio_count": scope_audio_count,
        "scope_error": scope_error,
    }
    if include_messages:
        messages = session.exec(
            select(AgentMessage)
            .where(AgentMessage.conversation_id == row.id)
            .order_by(AgentMessage.created_at, AgentMessage.id)
        ).all()
        payload["messages"] = [_serialize_message(session, message) for message in messages]
        runs = session.exec(
            select(AgentRun)
            .where(AgentRun.conversation_id == row.id)
            .order_by(AgentRun.created_at, AgentRun.id)
        ).all()
        payload["runs"] = [
            {
                **_serialize_run(run),
                "operation_plan": agent_operation_service.get_plan_for_run(session, int(run.id)),
            }
            for run in runs
            if run.id is not None
        ]
    return payload


def _valid_citation(session: Session, citation: AgentCitation) -> dict | None:
    run = session.get(AgentRun, citation.run_id)
    if not run:
        return None
    try:
        allowed_audio_ids = {int(value) for value in json.loads(run.allowed_audio_ids_json)}
    except Exception:
        return None
    if citation.audio_id not in allowed_audio_ids:
        return None
    audio = session.get(AudioItem, citation.audio_id)
    if not audio:
        return None
    if citation.segment_id is not None and citation.transcript_id is None:
        return None
    if citation.start_seconds is not None or citation.end_seconds is not None:
        if (
            citation.start_seconds is None
            or citation.end_seconds is None
            or citation.start_seconds < 0
            or citation.end_seconds < citation.start_seconds
            or (
                audio.duration_seconds is not None
                and citation.end_seconds > audio.duration_seconds + 0.05
            )
        ):
            return None
    if citation.transcript_id is not None:
        revision = session.get(Transcript, citation.transcript_id)
        if not revision or not revision.is_current or revision.audio_id != citation.audio_id:
            return None
        if citation.segment_id is not None:
            segment = session.get(TranscriptSegment, citation.segment_id)
            if not segment or segment.transcript_id != revision.id:
                return None
            if (
                citation.start_seconds is None
                or citation.end_seconds is None
                or abs(segment.start_seconds - citation.start_seconds) > 0.01
                or abs(segment.end_seconds - citation.end_seconds) > 0.01
            ):
                return None
    return {
        **citation.model_dump(),
        "audio_title": audio.title_user or audio.title_original or audio.file_name,
    }


def _serialize_message(session: Session, message: AgentMessage) -> dict:
    citations = session.exec(
        select(AgentCitation)
        .where(AgentCitation.message_id == message.id)
        .order_by(AgentCitation.id)
    ).all()
    return {
        **message.model_dump(),
        "citations": [value for row in citations if (value := _valid_citation(session, row)) is not None],
    }


def _serialize_run(run: AgentRun) -> dict:
    return {
        **run.model_dump(exclude={"scope_json", "allowed_audio_ids_json"}),
        "scope": json.loads(run.scope_json),
    }


def list_conversations(session: Session) -> list[dict]:
    rows = session.exec(select(AgentConversation).order_by(AgentConversation.updated_at.desc(), AgentConversation.id.desc())).all()
    return [_serialize_conversation(session, row) for row in rows]


def create_conversation(session: Session, payload: AgentConversationCreate) -> dict:
    resolved = resolve_scope(session, payload.scope)
    title = " ".join((payload.title or "新会话").split()) or "新会话"
    row = AgentConversation(title=title, scope_json=_json(scope_payload(payload.scope)))
    session.add(row)
    session.commit()
    session.refresh(row)
    return {**_serialize_conversation(session, row), "scope_audio_count": len(resolved.audio_ids)}


def get_conversation(session: Session, conversation_id: int) -> dict:
    return _serialize_conversation(session, _conversation(session, conversation_id), include_messages=True)


def update_conversation(session: Session, conversation_id: int, payload: AgentConversationUpdate) -> dict:
    row = _conversation(session, conversation_id)
    active = session.exec(
        select(AgentRun)
        .where(AgentRun.conversation_id == conversation_id)
        .where(AgentRun.status.in_(ACTIVE_RUN_STATUSES))
    ).first()
    pending_plan = session.exec(
        select(AgentOperationPlan.id)
        .join(AgentRun, AgentRun.id == AgentOperationPlan.run_id)
        .where(AgentRun.conversation_id == conversation_id)
        .where(AgentOperationPlan.status == "awaiting_approval")
    ).first()
    if payload.scope is not None:
        if active or pending_plan is not None:
            raise ServiceError(409, "Cannot change scope while an Agent run is active", "agent.run_active")
        resolve_scope(session, payload.scope)
        row.scope_json = _json(scope_payload(payload.scope))
    if payload.title is not None:
        normalized_title = " ".join(payload.title.split())
        if not normalized_title:
            raise ServiceError(400, "Conversation title is required", "agent.title_required")
        row.title = normalized_title
    row.updated_at = now_iso()
    session.add(row)
    session.commit()
    session.refresh(row)
    return _serialize_conversation(session, row)


def create_run(session: Session, conversation_id: int, payload: AgentRunCreate) -> dict:
    conversation = _conversation(session, conversation_id)
    pending_plan = session.exec(
        select(AgentOperationPlan.id)
        .join(AgentRun, AgentRun.id == AgentOperationPlan.run_id)
        .where(AgentRun.conversation_id == conversation_id)
        .where(AgentOperationPlan.status == "awaiting_approval")
    ).first()
    if pending_plan is not None:
        raise ServiceError(
            409,
            "Approve or reject the pending operation plan before starting another run",
            "agent.operation_plan_pending",
        )
    scope = _scope_from_json(conversation.scope_json)
    resolved = resolve_scope(session, scope)
    content = payload.content.strip()
    if not content:
        raise ServiceError(400, "Message content is required", "agent.message_required")

    message = AgentMessage(conversation_id=conversation_id, role="user", content=content)
    session.add(message)
    session.flush()
    run = AgentRun(
        conversation_id=conversation_id,
        user_message_id=int(message.id),
        scope_json=_json(scope_payload(scope)),
        allowed_audio_ids_json=_json(sorted(resolved.audio_ids)),
    )
    session.add(run)
    conversation.updated_at = now_iso()
    session.add(conversation)
    try:
        session.commit()
    except IntegrityError as error:
        session.rollback()
        raise ServiceError(409, "An Agent run is already active", "agent.run_active") from error
    session.refresh(run)
    return _serialize_run(run)


def get_run(session: Session, run_id: int) -> dict:
    run = session.get(AgentRun, run_id)
    if not run:
        raise ServiceError(404, "Agent run not found", "agent.run_not_found")
    steps = session.exec(select(AgentRunStep).where(AgentRunStep.run_id == run_id).order_by(AgentRunStep.step_index)).all()
    calls = session.exec(select(AgentToolCall).where(AgentToolCall.run_id == run_id).order_by(AgentToolCall.id)).all()
    assistant = session.exec(
        select(AgentMessage)
        .where(AgentMessage.run_id == run_id)
        .where(AgentMessage.role == "assistant")
    ).first()
    return {
        **_serialize_run(run),
        "steps": [{**row.model_dump(exclude={"detail_json"}), "detail": json.loads(row.detail_json) if row.detail_json else None} for row in steps],
        "tool_calls": [{**row.model_dump(exclude={"arguments_json", "output_json"}), "arguments": json.loads(row.arguments_json), "output": json.loads(row.output_json) if row.output_json else None} for row in calls],
        "message": _serialize_message(session, assistant) if assistant else None,
        "operation_plan": agent_operation_service.get_plan_for_run(session, run_id),
    }


def cancel_run(session: Session, run_id: int) -> dict:
    run = session.get(AgentRun, run_id)
    if not run:
        raise ServiceError(404, "Agent run not found", "agent.run_not_found")
    if run.status in {"done", "failed", "canceled"}:
        return _serialize_run(run)
    run.status = "cancel_requested" if run.status == "running" else "canceled"
    if run.status == "canceled":
        run.finished_at = now_iso()
    run.updated_at = now_iso()
    session.add(run)
    session.commit()
    session.refresh(run)
    return _serialize_run(run)


def delete_conversation(session: Session, conversation_id: int) -> dict:
    conversation = _conversation(session, conversation_id)
    runs = session.exec(select(AgentRun).where(AgentRun.conversation_id == conversation_id)).all()
    if any(run.status in ACTIVE_RUN_STATUSES for run in runs):
        raise ServiceError(409, "Cancel the active Agent run before deleting this conversation", "agent.run_active")
    run_ids = [int(run.id) for run in runs if run.id is not None]
    messages = session.exec(select(AgentMessage).where(AgentMessage.conversation_id == conversation_id)).all()
    message_ids = [int(message.id) for message in messages if message.id is not None]
    if message_ids:
        for row in session.exec(select(AgentCitation).where(AgentCitation.message_id.in_(message_ids))).all():
            session.delete(row)
    if run_ids:
        plans = session.exec(select(AgentOperationPlan).where(AgentOperationPlan.run_id.in_(run_ids))).all()
        plan_ids = [int(row.id) for row in plans if row.id is not None]
        if plan_ids:
            for row in session.exec(select(AgentOperationAuditEvent).where(AgentOperationAuditEvent.plan_id.in_(plan_ids))).all():
                session.delete(row)
            for row in session.exec(select(AgentOperationItem).where(AgentOperationItem.plan_id.in_(plan_ids))).all():
                session.delete(row)
            session.flush()
            for row in plans:
                session.delete(row)
        for row in session.exec(select(AgentToolCall).where(AgentToolCall.run_id.in_(run_ids))).all():
            session.delete(row)
        for row in session.exec(select(AgentRunStep).where(AgentRunStep.run_id.in_(run_ids))).all():
            session.delete(row)
    session.flush()
    for run in runs:
        session.delete(run)
    session.flush()
    for message in messages:
        session.delete(message)
    session.flush()
    session.delete(conversation)
    session.commit()
    return {"ok": True}


def export_conversation(session: Session, conversation_id: int) -> dict:
    conversation = get_conversation(session, conversation_id)
    exported_runs = []
    for run in conversation.get("runs", []):
        detail = get_run(session, int(run["id"]))
        for call in detail["tool_calls"]:
            # Tool outputs may contain transcript text. The visible call and its
            # status are sufficient for a portable session audit.
            call.pop("output", None)
        exported_runs.append(detail)
    conversation["runs"] = exported_runs
    conversation["export_schema_version"] = 1
    return conversation


def recover_interrupted_agent_runs(bind) -> int:
    with Session(bind) as session:
        rows = session.exec(select(AgentRun).where(AgentRun.status.in_(["running", "cancel_requested"]))).all()
        for row in rows:
            row.status = "canceled" if row.status == "cancel_requested" else "failed"
            row.error_message = None if row.status == "canceled" else "Agent run interrupted by backend restart"
            row.error_code = None if row.status == "canceled" else "agent.interrupted"
            row.finished_at = now_iso()
            row.updated_at = now_iso()
            session.add(row)
        if rows:
            session.commit()
        return len(rows)
