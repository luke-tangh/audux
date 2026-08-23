from typing import Literal

from fastapi import APIRouter, Depends
from sqlmodel import Session

from ..db import get_session
from ..models import Setting
from ..schemas import SettingUpdate, SettingsSectionUpdate
from ..services import settings_service


router = APIRouter()


@router.get("/settings", response_model=list[Setting])
def list_settings(session: Session = Depends(get_session)):
    return settings_service.list_settings(session)


@router.put("/settings", response_model=Setting)
def upsert_setting(payload: SettingUpdate, session: Session = Depends(get_session)):
    return settings_service.upsert_setting(session, payload.key, payload.value)


@router.put("/settings/{section}", response_model=list[Setting])
def update_settings_section(
    section: Literal["asr", "llm"],
    payload: SettingsSectionUpdate,
    session: Session = Depends(get_session),
):
    return settings_service.update_settings_section(
        session,
        section,
        payload.values,
    )
