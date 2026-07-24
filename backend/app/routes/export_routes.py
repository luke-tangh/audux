from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from ..db import get_session
from ..services import export_service
from .utils import service_call


router = APIRouter()


@router.get("/search")
def search(
    q: str,
    include_disabled_roots: bool = False,
    session: Session = Depends(get_session),
):
    return export_service.search_audio(
        session=session,
        q=q,
        include_disabled_roots=include_disabled_roots,
    )


@router.get("/export/metadata")
def export_metadata(
    format: str = "json",
    session: Session = Depends(get_session),
):
    return export_service.export_metadata_response(session, format)


@router.post("/maintenance/rebuild-search-index")
def rebuild_all_search_index(session: Session = Depends(get_session)):
    return export_service.rebuild_all_search_index(session)


@router.post("/maintenance/cleanup-tags")
def cleanup_orphan_tags(session: Session = Depends(get_session)):
    return export_service.cleanup_orphan_tags(session)


@router.get("/logs/app")
def get_app_logs(lines: int = Query(default=300, ge=1, le=2000)):
    return export_service.get_app_logs(lines)


@router.get("/logs/app/file")
def get_app_log_file():
    return service_call(export_service.get_app_log_file_response)
