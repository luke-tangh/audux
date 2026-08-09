from threading import Thread

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from ..db import get_session
from ..schemas import (
    DuplicateHashConfirmRequest,
    SafeRelinkCommitRequest,
    SafeRelinkPreviewRequest,
)
from ..services import health_service
from .utils import service_call


router = APIRouter()


def _schedule_task(
    session: Session,
    task,
):
    bind = session.get_bind()
    engine = getattr(bind, "engine", bind)
    response = health_service.serialize_health_task(task)
    # End the request session's read transaction before the background worker
    # opens a second SQLite connection and updates the task row.
    session.rollback()
    Thread(
        target=health_service.run_health_task,
        args=(engine, task.id),
        name=f"library-health-{task.id}",
        daemon=True,
    ).start()
    return response


@router.get("/library-health")
def get_library_health(session: Session = Depends(get_session)):
    return health_service.get_library_health_summary(session)


@router.get("/library-health/tasks")
def list_library_health_tasks(
    limit: int = Query(default=20, ge=1, le=100),
    session: Session = Depends(get_session),
):
    return health_service.list_health_tasks(session, limit=limit)


@router.post("/library-health/checks")
def create_library_health_check(
    session: Session = Depends(get_session),
):
    task = service_call(health_service.create_health_task, session)
    return _schedule_task(session, task)


@router.post("/library-health/duplicates/confirm")
def confirm_duplicate_hashes(
    payload: DuplicateHashConfirmRequest,
    session: Session = Depends(get_session),
):
    task = service_call(
        health_service.create_health_task,
        session,
        "duplicate_hash",
        payload.audio_ids,
    )
    return _schedule_task(session, task)


@router.post("/library-health/tasks/{task_id}/cancel")
def cancel_library_health_task(
    task_id: int,
    session: Session = Depends(get_session),
):
    return service_call(health_service.cancel_health_task, session, task_id)


@router.post("/library-health/tasks/{task_id}/retry")
def retry_library_health_task(
    task_id: int,
    session: Session = Depends(get_session),
):
    task = service_call(health_service.retry_health_task, session, task_id)
    return _schedule_task(session, task)


@router.get("/library-health/audio/{audio_id}/relink-candidates")
def find_relink_candidates(
    audio_id: int,
    limit: int = Query(default=20, ge=1, le=50),
    session: Session = Depends(get_session),
):
    return service_call(
        health_service.find_relink_candidates,
        session,
        audio_id,
        limit,
    )


@router.post("/library-health/audio/{audio_id}/relink-preview")
def preview_safe_relink(
    audio_id: int,
    payload: SafeRelinkPreviewRequest,
    session: Session = Depends(get_session),
):
    return service_call(
        health_service.preview_safe_relink,
        session,
        audio_id,
        payload.candidate_path,
    )


@router.post("/library-health/audio/{audio_id}/relink")
def commit_safe_relink(
    audio_id: int,
    payload: SafeRelinkCommitRequest,
    session: Session = Depends(get_session),
):
    return service_call(
        health_service.commit_safe_relink,
        session,
        audio_id,
        payload.candidate_path,
        expected_audio_updated_at=payload.expected_audio_updated_at,
        expected_file_size=payload.expected_file_size,
        expected_mtime_ns=payload.expected_mtime_ns,
    )
