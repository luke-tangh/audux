from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import FileResponse
from sqlmodel import Session

from ..db import get_session
from ..response_schemas import (
    ArchiveImportDryRunResponse,
    ArchiveImportResponse,
    DiagnosticBundleResponse,
    PortableArchiveResponse,
)
from ..schemas import ArchiveImportExecute
from ..services import archive_service


router = APIRouter(prefix="/maintenance")


@router.post("/archives", response_model=PortableArchiveResponse)
def create_archive(session: Session = Depends(get_session)):
    return archive_service.create_archive(session)


@router.get("/archives/{archive_id}/file", response_class=FileResponse)
def download_archive(archive_id: str):
    return archive_service.archive_response(archive_id)


@router.post(
    "/archives/import/dry-run",
    response_model=ArchiveImportDryRunResponse,
)
async def dry_run_archive_import(
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
):
    data = await file.read(archive_service.MAX_ARCHIVE_BYTES + 1)
    return archive_service.import_dry_run(session, data)


@router.post("/archives/import", response_model=ArchiveImportResponse)
def execute_archive_import(
    payload: ArchiveImportExecute,
    session: Session = Depends(get_session),
):
    return archive_service.execute_import(
        session,
        payload.archive_id,
        payload.fingerprint,
    )


@router.post("/diagnostics", response_model=DiagnosticBundleResponse)
def create_diagnostic_bundle(session: Session = Depends(get_session)):
    return archive_service.create_diagnostic_bundle(session)


@router.get("/diagnostics/{bundle_id}/file", response_class=FileResponse)
def download_diagnostic_bundle(bundle_id: str):
    return archive_service.diagnostic_response(bundle_id)
