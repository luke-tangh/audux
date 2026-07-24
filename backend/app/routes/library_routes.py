from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Query
from sqlmodel import Session

from ..db import get_session
from ..scanner import scan_library_root_task
from ..schemas import LibraryRootCreate, LibraryRootUpdate
from ..services import library_service
from .utils import service_call


router = APIRouter()


@router.post("/library-roots")
def create_library_root(
    payload: LibraryRootCreate,
    session: Session = Depends(get_session),
):
    return service_call(library_service.create_library_root, session, payload.path)


@router.get("/library-roots")
def list_library_roots(session: Session = Depends(get_session)):
    return library_service.list_library_roots(session)


@router.patch("/library-roots/{root_id}")
def update_library_root(
    root_id: int,
    payload: LibraryRootUpdate,
    session: Session = Depends(get_session),
):
    return service_call(
        library_service.update_library_root,
        session,
        root_id,
        payload.is_enabled,
    )


@router.post("/library-roots/{root_id}/scan")
def scan_root(
    root_id: int,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
):
    task = service_call(library_service.create_scan_task, session, root_id)
    background_tasks.add_task(scan_library_root_task, root_id, task.id)
    return task


@router.post("/library-roots/{root_id}/scan-sync")
def scan_root_sync(root_id: int, session: Session = Depends(get_session)):
    return service_call(library_service.scan_root_sync, session, root_id)


@router.get("/scan-tasks")
def list_scan_tasks(
    root_id: Optional[int] = None,
    limit: int = Query(default=50, ge=1, le=200),
    session: Session = Depends(get_session),
):
    return library_service.list_scan_tasks(session, root_id=root_id, limit=limit)


@router.get("/scan-tasks/{task_id}")
def get_scan_task(task_id: int, session: Session = Depends(get_session)):
    return service_call(library_service.get_scan_task, session, task_id)


@router.post("/scan-tasks/{task_id}/cancel")
def cancel_scan_task(task_id: int, session: Session = Depends(get_session)):
    return service_call(library_service.cancel_scan_task, session, task_id)
