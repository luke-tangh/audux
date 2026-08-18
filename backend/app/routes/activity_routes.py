from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from ..db import get_session
from ..services import activity_service


router = APIRouter()


@router.get("/activities")
def list_activities(
    limit: int = Query(default=40, ge=1, le=100),
    session: Session = Depends(get_session),
):
    return activity_service.list_activities(session, limit=limit)
