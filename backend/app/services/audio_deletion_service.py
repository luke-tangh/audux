from sqlalchemy import text
from sqlmodel import Session, select

from ..logger import get_logger
from ..models import (
    AITask,
    AgentCitation,
    AudioItem,
    AudioTag,
    OrganizationAuditEvent,
    OrganizationProposal,
    OrganizationRunTarget,
    PlaybackEvent,
    PlaylistItem,
    Transcript,
    TranscriptChapter,
    TranscriptIssue,
    TranscriptSegment,
)
from .errors import ServiceError
from .media_paths import delete_managed_cover_file
from .task_state import BUSY_AUDIO_TASK_STATUSES


logger = get_logger(__name__)


def _ensure_audio_deletable(
    session: Session,
    item: AudioItem,
) -> None:
    audio_id = int(item.id)
    active_task = session.exec(
        select(AITask)
        .where(AITask.audio_id == audio_id)
        .where(AITask.status.in_(list(BUSY_AUDIO_TASK_STATUSES)))
    ).first()
    if active_task:
        raise ServiceError(
            409,
            "Audio cannot be deleted while a task is active",
            code="audio.task_active_delete",
        )

    organization_reference = (
        session.exec(
            select(OrganizationRunTarget.id).where(
                OrganizationRunTarget.audio_id == audio_id
            )
        ).first()
        or session.exec(
            select(OrganizationProposal.id).where(
                OrganizationProposal.audio_id == audio_id
            )
        ).first()
        or session.exec(
            select(OrganizationAuditEvent.id).where(
                OrganizationAuditEvent.audio_id == audio_id
            )
        ).first()
    )
    if organization_reference is not None:
        raise ServiceError(
            409,
            "Audio is referenced by an organization run",
            code="organization.audio_referenced",
        )

def _delete_transcript_graph(session: Session, audio_id: int) -> None:
    transcripts = session.exec(
        select(Transcript).where(Transcript.audio_id == audio_id)
    ).all()
    transcript_ids = [int(row.id) for row in transcripts if row.id is not None]
    if not transcript_ids:
        return

    for model in (TranscriptIssue, TranscriptChapter, TranscriptSegment):
        for row in session.exec(
            select(model).where(model.transcript_id.in_(transcript_ids))
        ).all():
            session.delete(row)

    session.flush()
    for transcript in transcripts:
        transcript.parent_revision_id = None
        session.add(transcript)
    session.flush()
    for transcript in transcripts:
        session.delete(transcript)


def _delete_audio_relations(session: Session, audio_id: int) -> None:
    relation_queries = (
        select(AudioTag).where(AudioTag.audio_id == audio_id),
        select(PlaylistItem).where(PlaylistItem.audio_id == audio_id),
        select(AITask).where(AITask.audio_id == audio_id),
        select(PlaybackEvent).where(PlaybackEvent.audio_id == audio_id),
        select(AgentCitation).where(AgentCitation.audio_id == audio_id),
    )
    for statement in relation_queries:
        for row in session.exec(statement).all():
            session.delete(row)

    _delete_transcript_graph(session, audio_id)
    session.execute(
        text("DELETE FROM search_index WHERE audio_id = :audio_id"),
        {"audio_id": audio_id},
    )
    session.execute(
        text("DELETE FROM segment_search_index WHERE audio_id = :audio_id"),
        {"audio_id": audio_id},
    )


def _commit_database_deletion(
    session: Session,
    item: AudioItem,
) -> None:
    _delete_audio_relations(session, int(item.id))
    try:
        session.flush()
        session.delete(item)
        session.commit()
    except Exception:
        session.rollback()
        raise


def delete_audio_item(
    session: Session,
    audio_id: int,
) -> dict:
    item = session.get(AudioItem, audio_id)
    if not item:
        raise ServiceError(404, "Audio item not found")

    _ensure_audio_deletable(session, item)
    cover_path = item.cover_path
    _commit_database_deletion(session, item)
    delete_managed_cover_file(cover_path)

    logger.info("Audio item removed from library id=%s", audio_id)
    return {"ok": True}
