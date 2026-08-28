from fastapi import APIRouter, Depends
from sqlmodel import Session

from ..db import get_session
from ..response_schemas import SegmentSearchResponse
from ..schemas import SegmentSearchRequest
from ..services import retrieval_service


router = APIRouter()


@router.post("/search/segments", response_model=SegmentSearchResponse)
def search_segments(payload: SegmentSearchRequest, session: Session = Depends(get_session)):
    return retrieval_service.search_segments(
        session,
        payload.query,
        payload.scope,
        limit=payload.limit,
        mode=payload.mode,
    )
