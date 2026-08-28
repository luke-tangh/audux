from __future__ import annotations

import difflib
import hashlib
import json
from collections import Counter
from typing import Any

from sqlmodel import Session, select

from ..models import (
    AudioItem,
    OrganizationAuditEvent,
    OrganizationProposal,
    OrganizationRun,
    OrganizationRunStep,
    OrganizationRunTarget,
    Transcript,
    TranscriptChapter,
    TranscriptIssue,
    TranscriptSegment,
    now_iso,
)
from ..schemas import AgentScope, OrganizationRunApply, OrganizationRunCreate
from ..search import rebuild_audio_search_index
from .errors import ServiceError
from .retrieval_service import resolve_scope, scope_payload
from .transcript_service import (
    _current_transcript,
    _revision_segments,
    create_transcript_revision,
)
from .tag_service import add_tags_to_audio_no_commit


STAGES = (
    "preflight",
    "transcribe",
    "validate",
    "review",
    "enrich",
    "apply",
    "reindex",
    "verify",
)
ACTIVE_STATUSES = {"pending", "running", "cancel_requested", "awaiting_review"}
TERMINAL_STATUSES = {"done", "partial", "failed", "canceled"}
DECIDABLE_STATUSES = {"pending"}
PROPOSAL_KINDS = {"correction", "tag", "description", "chapter"}


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _load_json(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return fallback


def _run(session: Session, run_id: int) -> OrganizationRun:
    row = session.get(OrganizationRun, run_id)
    if not row:
        raise ServiceError(404, "Organization run not found", "organization.run_not_found")
    return row


def _proposal(session: Session, proposal_id: int) -> OrganizationProposal:
    row = session.get(OrganizationProposal, proposal_id)
    if not row:
        raise ServiceError(404, "Organization proposal not found", "organization.proposal_not_found")
    return row


def _diff(original: Any, proposed: Any) -> list[dict]:
    before = str(original.get("text", "") if isinstance(original, dict) else original or "")
    after = str(proposed.get("text", "") if isinstance(proposed, dict) else proposed or "")
    return [
        {"op": tag, "before": before[i1:i2], "after": after[j1:j2]}
        for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, before, after).get_opcodes()
        if tag != "equal"
    ]


def _serialize_proposal(row: OrganizationProposal) -> dict:
    original = _load_json(row.original_value_json, None)
    proposed = _load_json(row.proposed_value_json, None)
    return {
        **row.model_dump(
            exclude={"original_value_json", "proposed_value_json", "evidence_json"}
        ),
        "original_value": original,
        "proposed_value": proposed,
        "evidence": _load_json(row.evidence_json, []),
        "diff": _diff(original, proposed) if row.kind == "correction" else [],
    }


def _serialize_run(row: OrganizationRun) -> dict:
    return {
        **row.model_dump(exclude={"scope_json", "options_json"}),
        "scope": _load_json(row.scope_json, {}),
        "options": _load_json(row.options_json, {}),
    }


def _refresh_counts(session: Session, run: OrganizationRun) -> None:
    targets = session.exec(
        select(OrganizationRunTarget).where(OrganizationRunTarget.run_id == run.id)
    ).all()
    proposals = session.exec(
        select(OrganizationProposal).where(OrganizationProposal.run_id == run.id)
    ).all()
    run.target_count = len(targets)
    run.processed_count = sum(row.status in {"ready", "review", "done"} for row in targets)
    run.failed_count = sum(row.status in {"failed", "blocked", "conflict"} for row in targets)
    run.pending_review_count = sum(row.status == "pending" for row in proposals)
    run.updated_at = now_iso()
    session.add(run)


def create_run(session: Session, payload: OrganizationRunCreate) -> dict:
    resolved = resolve_scope(session, payload.scope)
    audio_ids = sorted(resolved.audio_ids)
    if not audio_ids:
        raise ServiceError(400, "Organization run scope is empty", "organization.scope_empty")

    row = OrganizationRun(
        scope_json=_json(scope_payload(payload.scope)),
        options_json=_json(payload.options.model_dump()),
        target_count=len(audio_ids),
    )
    session.add(row)
    session.flush()
    if row.id is None:
        raise ServiceError(500, "Failed to create organization run")

    current_by_audio = {
        transcript.audio_id: transcript
        for transcript in session.exec(
            select(Transcript)
            .where(Transcript.audio_id.in_(audio_ids))
            .where(Transcript.is_current.is_(True))
        ).all()
    }
    for audio_id in audio_ids:
        revision = current_by_audio.get(audio_id)
        session.add(
            OrganizationRunTarget(
                run_id=row.id,
                audio_id=audio_id,
                source_transcript_id=revision.id if revision else None,
            )
        )
    for index, stage in enumerate(STAGES):
        session.add(
            OrganizationRunStep(
                run_id=row.id,
                stage=stage,
                step_index=index,
            )
        )
    session.add(
        OrganizationAuditEvent(
            run_id=row.id,
            event_type="run.created",
            detail_json=_json({"target_audio_ids": audio_ids, "scope": scope_payload(payload.scope)}),
        )
    )
    session.commit()
    session.refresh(row)
    return get_run(session, row.id)


def list_runs(session: Session, limit: int = 50) -> list[dict]:
    rows = session.exec(
        select(OrganizationRun).order_by(OrganizationRun.updated_at.desc()).limit(limit)
    ).all()
    return [_serialize_run(row) for row in rows]


def get_run(session: Session, run_id: int) -> dict:
    row = _run(session, run_id)
    steps = session.exec(
        select(OrganizationRunStep)
        .where(OrganizationRunStep.run_id == run_id)
        .order_by(OrganizationRunStep.step_index)
    ).all()
    targets = session.exec(
        select(OrganizationRunTarget)
        .where(OrganizationRunTarget.run_id == run_id)
        .order_by(OrganizationRunTarget.id)
    ).all()
    proposals = session.exec(
        select(OrganizationProposal)
        .where(OrganizationProposal.run_id == run_id)
        .order_by(OrganizationProposal.audio_id, OrganizationProposal.kind, OrganizationProposal.id)
    ).all()
    audit_events = session.exec(
        select(OrganizationAuditEvent)
        .where(OrganizationAuditEvent.run_id == run_id)
        .order_by(OrganizationAuditEvent.id)
    ).all()
    audio_ids = [target.audio_id for target in targets]
    audio_by_id = {
        audio.id: audio
        for audio in session.exec(select(AudioItem).where(AudioItem.id.in_(audio_ids))).all()
    } if audio_ids else {}
    return {
        **_serialize_run(row),
        "steps": [
            {
                **step.model_dump(exclude={"detail_json"}),
                "detail": _load_json(step.detail_json, None),
            }
            for step in steps
        ],
        "targets": [
            {
                **target.model_dump(),
                "title": (
                    audio_by_id[target.audio_id].title_user
                    or audio_by_id[target.audio_id].title_original
                    or audio_by_id[target.audio_id].file_name
                ) if target.audio_id in audio_by_id else f"Audio #{target.audio_id}",
            }
            for target in targets
        ],
        "proposals": [_serialize_proposal(proposal) for proposal in proposals],
        "proposal_counts": dict(Counter(proposal.status for proposal in proposals)),
        "audit_events": [
            {
                **event.model_dump(exclude={"detail_json"}),
                "detail": _load_json(event.detail_json, None),
            }
            for event in audit_events
        ],
    }


def set_stage(
    session: Session,
    run: OrganizationRun,
    stage: str,
    status: str,
    *,
    processed_count: int = 0,
    failed_count: int = 0,
    detail: dict | None = None,
) -> None:
    step = session.exec(
        select(OrganizationRunStep)
        .where(OrganizationRunStep.run_id == run.id)
        .where(OrganizationRunStep.stage == stage)
    ).one()
    timestamp = now_iso()
    step.status = status
    step.processed_count = processed_count
    step.failed_count = failed_count
    step.detail_json = _json(detail) if detail is not None else step.detail_json
    if status == "running" and step.started_at is None:
        step.started_at = timestamp
    if status in {"done", "failed", "canceled", "skipped"}:
        step.finished_at = timestamp
    step.updated_at = timestamp
    run.current_stage = stage
    run.updated_at = timestamp
    session.add_all([step, run])


def add_proposal(
    session: Session,
    *,
    run_id: int,
    audio_id: int,
    source_transcript_id: int | None,
    source_segment_id: int | None,
    kind: str,
    original_value: Any,
    proposed_value: Any,
    evidence: list[dict],
    rationale: str | None = None,
    confidence: str = "unknown",
) -> OrganizationProposal | None:
    if kind not in PROPOSAL_KINDS:
        raise ValueError(f"Unsupported organization proposal kind: {kind}")
    stable = _json(
        {
            "audio_id": audio_id,
            "source_transcript_id": source_transcript_id,
            "source_segment_id": source_segment_id,
            "kind": kind,
            "original": original_value,
            "proposed": proposed_value,
        }
    )
    dedupe_key = hashlib.sha256(stable.encode("utf-8")).hexdigest()
    existing = session.exec(
        select(OrganizationProposal)
        .where(OrganizationProposal.run_id == run_id)
        .where(OrganizationProposal.dedupe_key == dedupe_key)
    ).first()
    if existing is not None:
        return None
    row = OrganizationProposal(
        run_id=run_id,
        audio_id=audio_id,
        source_transcript_id=source_transcript_id,
        source_segment_id=source_segment_id,
        kind=kind,
        dedupe_key=dedupe_key,
        original_value_json=_json(original_value),
        proposed_value_json=_json(proposed_value),
        evidence_json=_json(evidence),
        rationale=(rationale or "")[:1000] or None,
        confidence=confidence if confidence in {"high", "medium", "low", "unknown"} else "unknown",
    )
    session.add(row)
    session.flush()
    return row


def decide_proposal(session: Session, proposal_id: int, payload) -> dict:
    row = _proposal(session, proposal_id)
    run = _run(session, row.run_id)
    if row.status not in DECIDABLE_STATUSES:
        raise ServiceError(409, "Proposal is no longer pending", "organization.proposal_not_pending")

    current = _current_transcript(session, row.audio_id)
    if row.source_transcript_id is not None and (
        current is None or current.id != row.source_transcript_id
    ):
        row.status = "stale"
        row.updated_at = now_iso()
        session.add(row)
        _refresh_counts(session, run)
        session.commit()
        raise ServiceError(409, "Proposal source revision is stale", "organization.proposal_stale")

    if payload.decision == "accepted" and payload.edited_value is not None:
        row.proposed_value_json = _json(payload.edited_value)
    if payload.decision == "accepted":
        _validate_accepted_value(row)
    row.status = payload.decision
    row.decision_note = payload.note.strip() if payload.note else None
    row.decided_at = now_iso()
    row.updated_at = row.decided_at
    session.add(row)
    session.add(
        OrganizationAuditEvent(
            run_id=row.run_id,
            proposal_id=row.id,
            audio_id=row.audio_id,
            event_type=f"proposal.{payload.decision}",
            detail_json=_json({"kind": row.kind, "edited": payload.edited_value is not None}),
        )
    )
    _refresh_counts(session, run)
    pending = session.exec(
        select(OrganizationProposal)
        .where(OrganizationProposal.run_id == run.id)
        .where(OrganizationProposal.status == "pending")
    ).first()
    accepted = session.exec(
        select(OrganizationProposal)
        .where(OrganizationProposal.run_id == run.id)
        .where(OrganizationProposal.status == "accepted")
    ).first()
    if pending is None and accepted is None:
        set_stage(session, run, "review", "done")
        set_stage(session, run, "apply", "skipped")
        set_stage(session, run, "reindex", "skipped")
        set_stage(session, run, "verify", "done")
        run.status = "partial" if run.failed_count else "done"
        run.finished_at = now_iso()
        session.add(run)
    session.commit()
    session.refresh(row)
    return _serialize_proposal(row)


def _validate_accepted_value(proposal: OrganizationProposal) -> dict:
    value = _load_json(proposal.proposed_value_json, None)
    if not isinstance(value, dict):
        raise ServiceError(400, "Accepted proposal value is invalid", "organization.proposal_invalid")
    if proposal.kind == "correction" and not str(value.get("text") or "").strip():
        raise ServiceError(400, "Correction text is required", "organization.correction_empty")
    if proposal.kind == "tag" and not str(value.get("name") or "").strip():
        raise ServiceError(400, "Tag name is required", "organization.tag_empty")
    if proposal.kind == "description" and not str(value.get("text") or "").strip():
        raise ServiceError(400, "Description is required", "organization.description_empty")
    if proposal.kind == "chapter":
        if not str(value.get("title") or "").strip():
            raise ServiceError(400, "Chapter title is required", "organization.chapter_title_empty")
        if not isinstance(value.get("start_seconds"), (int, float)) or not isinstance(
            value.get("end_seconds"), (int, float)
        ) or value["end_seconds"] <= value["start_seconds"]:
            raise ServiceError(400, "Chapter time range is invalid", "organization.chapter_bounds_invalid")
    return value


def apply_run(session: Session, run_id: int, payload: OrganizationRunApply) -> dict:
    run = _run(session, run_id)
    categories = set(payload.categories)
    accepted = list(
        session.exec(
            select(OrganizationProposal)
            .where(OrganizationProposal.run_id == run_id)
            .where(OrganizationProposal.status == "accepted")
            .where(OrganizationProposal.kind.in_(categories))
            .order_by(OrganizationProposal.audio_id, OrganizationProposal.id)
        ).all()
    )
    if not accepted:
        raise ServiceError(400, "No accepted proposals are ready to apply", "organization.nothing_to_apply")

    set_stage(session, run, "apply", "running")
    run.status = "running"
    session.flush()
    applied = 0
    try:
        by_audio: dict[int, list[OrganizationProposal]] = {}
        for proposal in accepted:
            by_audio.setdefault(proposal.audio_id, []).append(proposal)

        for audio_id, proposals in by_audio.items():
            audio = session.get(AudioItem, audio_id)
            if not audio:
                raise ServiceError(404, f"Audio {audio_id} no longer exists", "organization.audio_not_found")
            current = _current_transcript(session, audio_id)
            for proposal in proposals:
                if proposal.source_transcript_id is not None and (
                    current is None or current.id != proposal.source_transcript_id
                ):
                    raise ServiceError(409, "Transcript changed before apply", "organization.revision_conflict")

            values = {int(proposal.id): _validate_accepted_value(proposal) for proposal in proposals}
            corrections = [proposal for proposal in proposals if proposal.kind == "correction"]
            applied_revision = current
            if corrections:
                if current is None:
                    raise ServiceError(409, "Correction source transcript is missing", "organization.revision_conflict")
                segments = _revision_segments(session, int(current.id))
                by_segment = {int(segment.id): segment for segment in segments if segment.id is not None}
                replacements: dict[int, str] = {}
                for proposal in corrections:
                    if proposal.source_segment_id not in by_segment:
                        raise ServiceError(409, "Correction segment is stale", "organization.segment_conflict")
                    replacements[int(proposal.source_segment_id)] = str(values[int(proposal.id)]["text"]).strip()
                revision_segments = [
                    {
                        "segment_index": segment.segment_index,
                        "start_seconds": segment.start_seconds,
                        "end_seconds": segment.end_seconds,
                        "text": replacements.get(int(segment.id), segment.text),
                    }
                    for segment in segments
                ]
                applied_revision = create_transcript_revision(
                    session,
                    audio,
                    language=current.language,
                    full_text="\n".join(item["text"] for item in revision_segments),
                    model_name=current.model_name,
                    provider_name=current.provider_name,
                    source_type="agent",
                    task_config_summary=_load_json(current.task_config_json, None),
                    glossary_version=current.glossary_version,
                    quality_metrics=_load_json(current.quality_metrics_json, None),
                    segments=revision_segments,
                    expected_updated_at=current.updated_at,
                )

            for proposal in proposals:
                value = values[int(proposal.id)]
                if proposal.kind == "tag":
                    name = " ".join(str(value["name"]).split())[:80]
                    add_tags_to_audio_no_commit(session, audio_id, [name], "agent")
                elif proposal.kind == "description":
                    audio.description_user = str(value["text"]).strip()[:4000]
                    audio.updated_at = now_iso()
                    session.add(audio)
                elif proposal.kind == "chapter":
                    if applied_revision is None or applied_revision.id is None:
                        raise ServiceError(409, "Chapter source transcript is missing", "organization.revision_conflict")
                    if (
                        audio.duration_seconds is not None
                        and float(value["end_seconds"]) > audio.duration_seconds + 0.05
                    ):
                        raise ServiceError(
                            400,
                            "Chapter exceeds audio duration",
                            "organization.chapter_bounds_invalid",
                        )
                    next_index = len(
                        session.exec(
                            select(TranscriptChapter).where(
                                TranscriptChapter.transcript_id == applied_revision.id
                            )
                        ).all()
                    )
                    session.add(
                        TranscriptChapter(
                            transcript_id=applied_revision.id,
                            chapter_index=next_index,
                            title=str(value["title"]).strip()[:200],
                            start_seconds=float(value["start_seconds"]),
                            end_seconds=float(value["end_seconds"]),
                            source_type="agent",
                        )
                    )
                proposal.status = "applied"
                proposal.applied_at = now_iso()
                proposal.updated_at = proposal.applied_at
                session.add(proposal)
                session.add(
                    OrganizationAuditEvent(
                        run_id=run_id,
                        proposal_id=proposal.id,
                        audio_id=audio_id,
                        event_type="proposal.applied",
                        detail_json=_json(
                            {
                                "kind": proposal.kind,
                                "source_transcript_id": proposal.source_transcript_id,
                                "result_transcript_id": applied_revision.id if applied_revision else None,
                            }
                        ),
                    )
                )
                applied += 1
            rebuild_audio_search_index(session, audio_id, commit=False)

        set_stage(session, run, "apply", "done", processed_count=applied)
        set_stage(session, run, "reindex", "done", processed_count=len(by_audio))
        verification = {
            "open": 0,
            "resolved": 0,
        }
        current_ids = [
            int(revision.id)
            for audio_id in by_audio
            if (revision := _current_transcript(session, audio_id)) is not None
            and revision.id is not None
        ]
        if current_ids:
            issue_rows = session.exec(
                select(TranscriptIssue).where(TranscriptIssue.transcript_id.in_(current_ids))
            ).all()
            verification["open"] = sum(issue.status == "open" for issue in issue_rows)
            verification["resolved"] = sum(issue.status != "open" for issue in issue_rows)
        set_stage(
            session,
            run,
            "verify",
            "done",
            processed_count=len(by_audio),
            detail=verification,
        )
        _refresh_counts(session, run)
        remaining = session.exec(
            select(OrganizationProposal)
            .where(OrganizationProposal.run_id == run_id)
            .where(OrganizationProposal.status.in_(["pending", "accepted"]))
        ).first()
        run.status = "awaiting_review" if remaining else ("partial" if run.failed_count else "done")
        if run.status in {"done", "partial"}:
            run.finished_at = now_iso()
        run.updated_at = now_iso()
        session.add(run)
        session.commit()
    except Exception:
        session.rollback()
        raise
    return get_run(session, run_id)


def cancel_run(session: Session, run_id: int) -> dict:
    run = _run(session, run_id)
    if run.status in TERMINAL_STATUSES:
        return get_run(session, run_id)
    attachment_events = session.exec(
        select(OrganizationAuditEvent).where(
            OrganizationAuditEvent.event_type == "transcription.attached"
        )
    ).all()
    owned_task_ids: set[int] = set()
    attached_elsewhere: dict[int, set[int]] = {}
    for event in attachment_events:
        detail = _load_json(event.detail_json, {})
        if not isinstance(detail, dict) or not isinstance(detail.get("task_id"), int):
            continue
        task_id = detail["task_id"]
        if event.run_id == run_id and detail.get("owned") is True:
            owned_task_ids.add(task_id)
        elif event.run_id != run_id:
            attached_elsewhere.setdefault(task_id, set()).add(event.run_id)

    other_run_ids = {
        other_run_id
        for task_id in owned_task_ids
        for other_run_id in attached_elsewhere.get(task_id, set())
    }
    other_active_run_ids = {
        other.id
        for other in session.exec(
            select(OrganizationRun).where(OrganizationRun.id.in_(other_run_ids))
        ).all()
        if other.id is not None and other.status not in TERMINAL_STATUSES
    } if other_run_ids else set()
    cancelable_task_ids = {
        task_id
        for task_id in owned_task_ids
        if not (attached_elsewhere.get(task_id, set()) & other_active_run_ids)
    }
    if cancelable_task_ids:
        from ..models import AITask

        tasks = session.exec(
            select(AITask)
            .where(AITask.id.in_(cancelable_task_ids))
            .where(AITask.task_type == "transcribe")
            .where(AITask.status.in_(["pending", "running", "cancel_requested"]))
        ).all()
        for task in tasks:
            task.status = "cancel_requested" if task.status == "running" else "canceled"
            task.finished_at = now_iso() if task.status == "canceled" else None
            task.updated_at = now_iso()
            session.add(task)
            audio = session.get(AudioItem, task.audio_id)
            if audio:
                audio.transcript_status = task.status
                audio.updated_at = now_iso()
                session.add(audio)
    run.status = "cancel_requested" if run.status == "running" else "canceled"
    run.updated_at = now_iso()
    if run.status == "canceled":
        run.finished_at = run.updated_at
    session.add(run)
    session.commit()
    return get_run(session, run_id)


def retry_run(session: Session, run_id: int) -> dict:
    run = _run(session, run_id)
    if run.status not in {"failed", "canceled", "interrupted"}:
        raise ServiceError(400, "Only failed, canceled or interrupted runs can be retried")
    run.status = "pending"
    run.error_message = None
    run.error_code = None
    run.finished_at = None
    run.updated_at = now_iso()
    session.add(run)
    session.commit()
    return get_run(session, run_id)


def recover_interrupted_runs(bind) -> int:
    with Session(bind) as session:
        rows = session.exec(
            select(OrganizationRun).where(
                OrganizationRun.status.in_(["running", "cancel_requested"])
            )
        ).all()
        for row in rows:
            row.status = "canceled" if row.status == "cancel_requested" else "interrupted"
            row.error_message = None if row.status == "canceled" else "Organization run interrupted by backend restart"
            row.error_code = None if row.status == "canceled" else "organization.interrupted"
            row.finished_at = now_iso()
            row.updated_at = now_iso()
            session.add(row)
        if rows:
            session.commit()
        return len(rows)
