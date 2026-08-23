from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from sqlalchemy import func
from sqlmodel import Session, select

from ..asr_config import ASR_PROVIDER_FASTER_WHISPER, build_asr_task_payload
from ..models import (
    AITask,
    AgentOperationAuditEvent,
    AgentOperationItem,
    AgentOperationPlan,
    AgentRun,
    AudioItem,
    AudioTag,
    Playlist,
    PlaylistItem,
    SavedView,
    Tag,
    now_iso,
)
from ..schemas import AudioUpdate, SavedViewQuery
from ..search import rebuild_audio_search_index
from .audio_query import build_audio_items_stmt
from .errors import ServiceError
from .task_state import BUSY_AUDIO_TASK_STATUSES
from .saved_view_service import audio_query_kwargs, encode_saved_view_query
from .whisper_component_service import is_whisper_companion_available


MAX_PLAN_ITEMS = 200


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _loads(value: str) -> Any:
    return json.loads(value)


def _fingerprint(items: list[dict[str, Any]], target_ids: list[int]) -> str:
    value = _json({"failure_policy": "atomic", "items": items, "target_audio_ids": target_ids})
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _audit(session: Session, plan_id: int, event_type: str, detail: dict[str, Any]) -> None:
    session.add(
        AgentOperationAuditEvent(
            plan_id=plan_id,
            event_type=event_type,
            detail_json=_json(detail),
        )
    )


def _audio(session: Session, audio_id: int) -> AudioItem:
    row = session.get(AudioItem, audio_id)
    if not row:
        raise ServiceError(409, "An operation target no longer exists", "agent.operation_target_stale")
    return row


def _metadata_item(session: Session, arguments: dict[str, Any]) -> dict[str, Any]:
    audio_id = int(arguments["audio_id"])
    audio = _audio(session, audio_id)
    changes = AudioUpdate.model_validate(arguments).model_dump(exclude_unset=True)
    changes.pop("audio_id", None)
    if not changes:
        raise ServiceError(400, "Metadata proposal is empty", "agent.operation_empty")
    before = {name: getattr(audio, name) for name in changes}
    return {"tool_name": "update_metadata", "audio_id": audio_id, "before": before, "after": changes}


def _tag_items(session: Session, arguments: dict[str, Any]) -> list[dict[str, Any]]:
    tag_names = list(dict.fromkeys(" ".join(str(value).split()) for value in arguments["tag_names"]))
    tag_names = [name for name in tag_names if name and len(name) <= 80]
    if not tag_names:
        raise ServiceError(400, "Tag proposal is empty", "agent.operation_empty")
    items: list[dict[str, Any]] = []
    for audio_id in dict.fromkeys(int(value) for value in arguments["audio_ids"]):
        _audio(session, audio_id)
        for name in tag_names:
            tag = session.exec(select(Tag).where(func.lower(Tag.name) == name.lower())).first()
            present = bool(
                tag
                and session.get(AudioTag, (audio_id, int(tag.id)))
            )
            items.append(
                {
                    "tool_name": "accept_tags",
                    "audio_id": audio_id,
                    "before": {"tag_name": name, "present": present},
                    "after": {"tag_name": name, "present": True},
                }
            )
    return items


def _playlist_items(session: Session, arguments: dict[str, Any]) -> list[dict[str, Any]]:
    playlist_id = int(arguments["playlist_id"])
    playlist = session.get(Playlist, playlist_id)
    if not playlist:
        raise ServiceError(404, "Playlist not found", "agent.operation_reference_not_found")
    if playlist.kind != "manual":
        raise ServiceError(409, "Smart playlist membership is rule-driven", "playlist.rule_driven")
    result = []
    for audio_id in dict.fromkeys(int(value) for value in arguments["audio_ids"]):
        _audio(session, audio_id)
        present = session.exec(
            select(PlaylistItem.id)
            .where(PlaylistItem.playlist_id == playlist_id)
            .where(PlaylistItem.audio_id == audio_id)
        ).first() is not None
        result.append(
            {
                "tool_name": "add_to_playlist",
                "audio_id": audio_id,
                "before": {"playlist_id": playlist_id, "playlist_name": playlist.name, "present": present},
                "after": {"playlist_id": playlist_id, "playlist_name": playlist.name, "present": True},
            }
        )
    return result


def _saved_view_item(
    session: Session,
    arguments: dict[str, Any],
    allowed_ids: set[int],
) -> dict[str, Any]:
    name = " ".join(str(arguments["name"]).split())
    query = SavedViewQuery.model_validate(arguments["query"])
    library_statement = build_audio_items_stmt(session=session)
    library_ids = set(
        int(value)
        for value in (
            session.execute(library_statement.with_only_columns(AudioItem.id)).scalars().all()
            if library_statement is not None
            else []
        )
    )
    if allowed_ids != library_ids:
        raise ServiceError(
            403,
            "Saved views can only be proposed from a whole-library Agent scope",
            "agent.scope_violation",
        )
    query_kwargs = audio_query_kwargs(session, query)
    query_kwargs.pop("sort", None)
    statement = build_audio_items_stmt(session=session, **query_kwargs)
    resolved_ids = set(
        int(value)
        for value in (
            session.execute(statement.with_only_columns(AudioItem.id)).scalars().all()
            if statement is not None
            else []
        )
    )
    if not resolved_ids.issubset(allowed_ids):
        raise ServiceError(
            403,
            "Saved view proposal expands beyond the frozen Agent scope",
            "agent.scope_violation",
        )
    exists = session.exec(select(SavedView.id).where(func.lower(SavedView.name) == name.lower())).first() is not None
    if exists:
        raise ServiceError(409, "Saved view name already exists", "saved_view.name_exists")
    return {
        "tool_name": "create_saved_view",
        "audio_id": None,
        "before": {"name": name, "exists": exists},
        "after": {"name": name, "query": query.model_dump()},
    }


def _transcription_items(session: Session, arguments: dict[str, Any]) -> list[dict[str, Any]]:
    result = []
    for audio_id in dict.fromkeys(int(value) for value in arguments["audio_ids"]):
        audio = _audio(session, audio_id)
        active = session.exec(
            select(AITask.id)
            .where(AITask.audio_id == audio_id)
            .where(AITask.task_type == "transcribe")
            .where(AITask.status.in_(list(BUSY_AUDIO_TASK_STATUSES)))
        ).first() is not None
        result.append(
            {
                "tool_name": "queue_transcription",
                "audio_id": audio_id,
                "before": {"transcript_status": audio.transcript_status, "active_task": active},
                "after": {"transcript_status": "pending", "task_type": "transcribe"},
            }
        )
    return result


def create_plan_from_proposals(
    session: Session,
    run_id: int,
    proposals: list[dict[str, Any]],
) -> dict[str, Any]:
    run = session.get(AgentRun, run_id)
    if not run:
        raise ServiceError(404, "Agent run not found", "agent.run_not_found")
    if session.exec(select(AgentOperationPlan.id).where(AgentOperationPlan.run_id == run_id)).first() is not None:
        raise ServiceError(409, "Agent run already has an operation plan", "agent.operation_plan_exists")
    allowed_ids = {int(value) for value in _loads(run.allowed_audio_ids_json)}
    expanded: list[dict[str, Any]] = []
    for proposal in proposals:
        name = proposal.get("tool_name")
        arguments = proposal.get("arguments")
        if not isinstance(arguments, dict):
            raise ServiceError(400, "Invalid operation proposal", "agent.operation_invalid")
        if name == "update_metadata":
            rows = [_metadata_item(session, arguments)]
        elif name == "accept_tags":
            rows = _tag_items(session, arguments)
        elif name == "add_to_playlist":
            rows = _playlist_items(session, arguments)
        elif name == "create_saved_view":
            rows = [_saved_view_item(session, arguments, allowed_ids)]
        elif name == "queue_transcription":
            rows = _transcription_items(session, arguments)
        else:
            raise ServiceError(400, "Unsupported operation proposal", "agent.operation_restricted")
        if any(row["audio_id"] is not None and row["audio_id"] not in allowed_ids for row in rows):
            raise ServiceError(403, "Operation target is outside the frozen Agent scope", "agent.scope_violation")
        expanded.extend(rows)

    if not expanded:
        raise ServiceError(400, "Operation plan is empty", "agent.operation_empty")
    if len(expanded) > MAX_PLAN_ITEMS:
        raise ServiceError(400, "Operation plan is too large", "agent.operation_too_large", {"max": MAX_PLAN_ITEMS})
    target_ids = sorted({int(row["audio_id"]) for row in expanded if row["audio_id"] is not None})
    fingerprint = _fingerprint(expanded, target_ids)
    plan = AgentOperationPlan(
        run_id=run_id,
        target_audio_ids_json=_json(target_ids),
        fingerprint=fingerprint,
        summary=f"{len(expanded)} 项低风险资料库变更，涉及 {len(target_ids)} 条音频",
    )
    session.add(plan)
    session.flush()
    for index, row in enumerate(expanded):
        session.add(
            AgentOperationItem(
                plan_id=int(plan.id),
                item_index=index,
                tool_name=row["tool_name"],
                audio_id=row["audio_id"],
                before_json=_json(row["before"]),
                after_json=_json(row["after"]),
            )
        )
    _audit(session, int(plan.id), "proposed", {"fingerprint": fingerprint, "item_count": len(expanded), "target_audio_ids": target_ids})
    session.commit()
    session.refresh(plan)
    return get_plan(session, int(plan.id))


def _serialize_item(row: AgentOperationItem) -> dict[str, Any]:
    return {
        **row.model_dump(exclude={"before_json", "after_json"}),
        "before": _loads(row.before_json),
        "after": _loads(row.after_json),
    }


def get_plan(session: Session, plan_id: int) -> dict[str, Any]:
    plan = session.get(AgentOperationPlan, plan_id)
    if not plan:
        raise ServiceError(404, "Agent operation plan not found", "agent.operation_plan_not_found")
    items = session.exec(
        select(AgentOperationItem)
        .where(AgentOperationItem.plan_id == plan_id)
        .order_by(AgentOperationItem.item_index)
    ).all()
    return {
        **plan.model_dump(exclude={"target_audio_ids_json"}),
        "target_audio_ids": _loads(plan.target_audio_ids_json),
        "items": [_serialize_item(row) for row in items],
    }


def get_plan_for_run(session: Session, run_id: int) -> dict[str, Any] | None:
    plan = session.exec(select(AgentOperationPlan).where(AgentOperationPlan.run_id == run_id)).first()
    return get_plan(session, int(plan.id)) if plan and plan.id is not None else None


def _current_before(session: Session, item: AgentOperationItem) -> dict[str, Any]:
    before = _loads(item.before_json)
    after = _loads(item.after_json)
    if item.tool_name == "update_metadata":
        audio = _audio(session, int(item.audio_id))
        return {name: getattr(audio, name) for name in after}
    if item.tool_name == "accept_tags":
        tag = session.exec(select(Tag).where(func.lower(Tag.name) == before["tag_name"].lower())).first()
        present = bool(tag and session.get(AudioTag, (int(item.audio_id), int(tag.id))))
        return {"tag_name": before["tag_name"], "present": present}
    if item.tool_name == "add_to_playlist":
        playlist = session.get(Playlist, int(before["playlist_id"]))
        present = bool(
            playlist
            and session.exec(
                select(PlaylistItem.id)
                .where(PlaylistItem.playlist_id == playlist.id)
                .where(PlaylistItem.audio_id == int(item.audio_id))
            ).first() is not None
        )
        return {"playlist_id": before["playlist_id"], "playlist_name": playlist.name if playlist else None, "present": present}
    if item.tool_name == "create_saved_view":
        exists = session.exec(select(SavedView.id).where(func.lower(SavedView.name) == before["name"].lower())).first() is not None
        return {"name": before["name"], "exists": exists}
    if item.tool_name == "queue_transcription":
        audio = _audio(session, int(item.audio_id))
        active = session.exec(
            select(AITask.id)
            .where(AITask.audio_id == int(item.audio_id))
            .where(AITask.task_type == "transcribe")
            .where(AITask.status.in_(list(BUSY_AUDIO_TASK_STATUSES)))
        ).first() is not None
        return {"transcript_status": audio.transcript_status, "active_task": active}
    raise ServiceError(400, "Unsupported operation item", "agent.operation_restricted")


def _apply_item(session: Session, item: AgentOperationItem, asr_payload: dict[str, Any] | None) -> None:
    after = _loads(item.after_json)
    if item.tool_name == "update_metadata":
        audio = _audio(session, int(item.audio_id))
        for name, value in after.items():
            setattr(audio, name, value)
        audio.updated_at = now_iso()
        session.add(audio)
        session.flush()
        rebuild_audio_search_index(session, int(audio.id), commit=False)
    elif item.tool_name == "accept_tags":
        name = after["tag_name"]
        tag = session.exec(select(Tag).where(func.lower(Tag.name) == name.lower())).first()
        if not tag:
            tag = Tag(name=name, source="agent")
            session.add(tag)
            session.flush()
        if not session.get(AudioTag, (int(item.audio_id), int(tag.id))):
            session.add(AudioTag(audio_id=int(item.audio_id), tag_id=int(tag.id)))
            session.flush()
            rebuild_audio_search_index(session, int(item.audio_id), commit=False)
    elif item.tool_name == "add_to_playlist":
        if _loads(item.before_json).get("present"):
            return
        playlist_id = int(after["playlist_id"])
        max_order = session.exec(select(func.max(PlaylistItem.order_index)).where(PlaylistItem.playlist_id == playlist_id)).one()
        session.add(PlaylistItem(playlist_id=playlist_id, audio_id=int(item.audio_id), order_index=0 if max_order is None else int(max_order) + 1))
    elif item.tool_name == "create_saved_view":
        query = SavedViewQuery.model_validate(after["query"])
        max_order = session.exec(select(func.max(SavedView.sort_order))).one()
        session.add(SavedView(name=after["name"], query_json=encode_saved_view_query(query), schema_version=query.schema_version, sort_order=0 if max_order is None else int(max_order) + 1))
    elif item.tool_name == "queue_transcription":
        if _loads(item.before_json).get("active_task"):
            return
        if asr_payload is None:
            raise ServiceError(409, "ASR configuration is unavailable", "agent.operation_asr_unavailable")
        audio = _audio(session, int(item.audio_id))
        if not Path(audio.file_path).is_file():
            raise ServiceError(409, "Audio file is missing", "agent.operation_audio_missing", {"audio_id": audio.id})
        audio.transcript_status = "pending"
        audio.updated_at = now_iso()
        session.add(audio)
        session.add(AITask(audio_id=int(audio.id), task_type="transcribe", status="pending", input_payload=_json(asr_payload), updated_at=now_iso()))
    else:
        raise ServiceError(400, "Unsupported operation item", "agent.operation_restricted")


def approve_and_execute(session: Session, plan_id: int, fingerprint: str) -> dict[str, Any]:
    plan = session.get(AgentOperationPlan, plan_id)
    if not plan:
        raise ServiceError(404, "Agent operation plan not found", "agent.operation_plan_not_found")
    if plan.status != "awaiting_approval":
        raise ServiceError(409, "This operation approval has already been consumed", "agent.operation_approval_replayed")
    if plan.fingerprint != fingerprint:
        raise ServiceError(409, "Operation plan changed before approval", "agent.operation_fingerprint_mismatch")
    items = list(session.exec(select(AgentOperationItem).where(AgentOperationItem.plan_id == plan_id).order_by(AgentOperationItem.item_index)).all())
    stale = [item.item_index for item in items if _current_before(session, item) != _loads(item.before_json)]
    if stale:
        raise ServiceError(409, "Operation plan is stale and must be regenerated", "agent.operation_target_stale", {"items": stale})

    needs_asr = any(item.tool_name == "queue_transcription" for item in items)
    asr_payload = build_asr_task_payload(session) if needs_asr else None
    if asr_payload and asr_payload["asr"]["provider"] == ASR_PROVIDER_FASTER_WHISPER and not is_whisper_companion_available():
        raise ServiceError(409, "Whisper component is not installed", "agent.operation_asr_unavailable")
    timestamp = now_iso()
    try:
        plan.status = "executing"
        plan.approved_at = timestamp
        plan.updated_at = timestamp
        session.add(plan)
        _audit(session, plan_id, "approved", {"fingerprint": fingerprint})
        for item in items:
            _apply_item(session, item, asr_payload)
            item.status = "done"
            item.updated_at = timestamp
            session.add(item)
        plan.status = "done"
        plan.executed_at = now_iso()
        plan.updated_at = plan.executed_at
        session.add(plan)
        _audit(session, plan_id, "executed", {"item_count": len(items), "failure_policy": "atomic"})
        session.commit()
    except Exception as error:
        session.rollback()
        failed = session.get(AgentOperationPlan, plan_id)
        if failed:
            failed.status = "failed"
            failed.error_message = (
                error.detail
                if isinstance(error, ServiceError)
                else "Atomic operation plan failed"
            )
            failed.updated_at = now_iso()
            session.add(failed)
            _audit(session, plan_id, "failed", {"error": failed.error_message})
            session.commit()
        if isinstance(error, ServiceError):
            raise
        raise ServiceError(409, "Atomic operation plan failed", "agent.operation_failed") from error
    return get_plan(session, plan_id)


def reject_plan(session: Session, plan_id: int) -> dict[str, Any]:
    plan = session.get(AgentOperationPlan, plan_id)
    if not plan:
        raise ServiceError(404, "Agent operation plan not found", "agent.operation_plan_not_found")
    if plan.status != "awaiting_approval":
        raise ServiceError(409, "Operation plan is no longer awaiting approval", "agent.operation_not_pending")
    plan.status = "rejected"
    plan.updated_at = now_iso()
    session.add(plan)
    _audit(session, plan_id, "rejected", {})
    session.commit()
    return get_plan(session, plan_id)
