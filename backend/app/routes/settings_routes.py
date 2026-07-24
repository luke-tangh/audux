from fastapi import APIRouter, Depends
from sqlmodel import Session

from ..db import get_session
from ..schemas import SettingUpdate
from ..services import settings_service


router = APIRouter()


@router.get("/settings")
def list_settings(session: Session = Depends(get_session)):
    return settings_service.list_settings(session)


@router.put("/settings")
def upsert_setting(payload: SettingUpdate, session: Session = Depends(get_session)):
    return settings_service.upsert_setting(session, payload.key, payload.value)
