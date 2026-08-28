from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from ..db import get_session
from ..response_schemas import StatisticsOverviewResponse
from ..services import statistics_service


router = APIRouter()


@router.get("/statistics/overview", response_model=StatisticsOverviewResponse)
def get_statistics_overview(
    days: int = Query(default=30, ge=1, le=3650),
    session: Session = Depends(get_session),
):
    return statistics_service.get_statistics_overview(session, days=days)
