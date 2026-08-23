from pathlib import Path

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
from .media_paths import delete_managed_cover_file, find_library_root_id_for_path
from .task_state import BUSY_AUDIO_TASK_STATUSES


logger = get_logger(__name__)


def _ensure_audio_deletable(
    session: Session,
    item: AudioItem,
    *,
    delete_file: bool,
) -> Path:
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

    audio_path = Path(item.file_path)
    if delete_file and find_library_root_id_for_path(session, audio_path) is None:
        raise ServiceError(
            400,
            "Audio file path must be within a configured library root",
        )
    return audio_path


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


def _cleanup_files(
    *,
    audio_id: int,
    audio_path: Path,
    cover_path: str | None,
    delete_file: bool,
) -> tuple[bool, str | None]:
    delete_managed_cover_file(cover_path)
    if not delete_file or not audio_path.exists():
        return False, None

    try:
        audio_path.unlink()
        return True, None
    except OSError as error:
        logger.warning(
            "Audio entry deleted but source file cleanup failed id=%s path=%s",
            audio_id,
            audio_path,
            exc_info=error,
        )
        return False, "audio.delete_file_failed"


def delete_audio_item(
    session: Session,
    audio_id: int,
    delete_file: bool = False,
) -> dict:
    item = session.get(AudioItem, audio_id)
    if not item:
        raise ServiceError(404, "Audio item not found")

    audio_path = _ensure_audio_deletable(
        session,
        item,
        delete_file=delete_file,
    )
    cover_path = item.cover_path
    _commit_database_deletion(session, item)
    file_deleted, cleanup_error = _cleanup_files(
        audio_id=audio_id,
        audio_path=audio_path,
        cover_path=cover_path,
        delete_file=delete_file,
    )

    logger.info("Audio item deleted id=%s delete_file=%s", audio_id, delete_file)
    return {
        "ok": True,
        "file_deleted": file_deleted,
        "cleanup_error": cleanup_error,
    }
