from fastapi import APIRouter, Depends
from sqlmodel import Session

from ..db import get_session
from ..schemas import ApplicationUpdatePrepare, DatabaseBackupCreate
from ..services import backup_service


router = APIRouter(prefix="/maintenance")


@router.get("/database-backups")
def list_database_backups():
    return backup_service.list_database_backups()


@router.post("/database-backups")
def create_database_backup(
    payload: DatabaseBackupCreate,
    session: Session = Depends(get_session),
):
    return backup_service.create_database_backup(
        session,
        payload.name,
    )


@router.post("/application-update/prepare")
def prepare_application_update(
    payload: ApplicationUpdatePrepare,
    session: Session = Depends(get_session),
):
    return backup_service.prepare_application_update(
        session,
        payload.target_version,
    )


@router.post("/database-backups/{snapshot_id}/validate")
def validate_database_backup(snapshot_id: str):
    return backup_service.validate_database_backup(snapshot_id)


@router.delete("/database-backups/{snapshot_id}")
def delete_database_backup(snapshot_id: str):
    return backup_service.delete_database_backup(snapshot_id)


@router.post("/database-backups/{snapshot_id}/restore/preflight")
def preflight_database_restore(
    snapshot_id: str,
    session: Session = Depends(get_session),
):
    return backup_service.restore_preflight(session, snapshot_id)


@router.post("/database-backups/{snapshot_id}/restore")
def schedule_database_restore(
    snapshot_id: str,
    session: Session = Depends(get_session),
):
    return backup_service.schedule_database_restore(session, snapshot_id)


@router.get("/database-restore")
def get_database_restore_status():
    return backup_service.get_database_restore_status()


@router.delete("/database-restore/pending")
def cancel_pending_database_restore():
    return backup_service.cancel_pending_database_restore()
