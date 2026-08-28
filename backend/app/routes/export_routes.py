from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlmodel import Session

from ..db import get_session
from ..response_schemas import (
    AppLogsResponse,
    AudioItemResponse,
    CleanupTagsResponse,
    RebuildSearchIndexResponse,
)
from ..services import export_service


router = APIRouter()


@router.get("/search", response_model=list[AudioItemResponse])
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


@router.get("/export/metadata", response_class=Response)
def export_metadata(
    format: str = "json",
    session: Session = Depends(get_session),
):
    return export_service.export_metadata_response(session, format)


@router.post(
    "/maintenance/rebuild-search-index",
    response_model=RebuildSearchIndexResponse,
)
def rebuild_all_search_index(session: Session = Depends(get_session)):
    return export_service.rebuild_all_search_index(session)


@router.post(
    "/maintenance/cleanup-tags",
    response_model=CleanupTagsResponse,
)
def cleanup_orphan_tags(session: Session = Depends(get_session)):
    return export_service.cleanup_orphan_tags(session)


@router.get("/logs/app", response_model=AppLogsResponse)
def get_app_logs(lines: int = Query(default=300, ge=1, le=2000)):
    return export_service.get_app_logs(lines)


@router.get("/logs/app/file", response_class=Response)
def get_app_log_file():
    return export_service.get_app_log_file_response()
