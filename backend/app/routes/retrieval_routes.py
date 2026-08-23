from fastapi import APIRouter, Depends
from sqlmodel import Session

from ..db import get_session
from ..schemas import SegmentSearchRequest
from ..services import retrieval_service


router = APIRouter()


@router.post("/search/segments")
def search_segments(payload: SegmentSearchRequest, session: Session = Depends(get_session)):
    return retrieval_service.search_segments(
        session,
        payload.query,
        payload.scope,
        limit=payload.limit,
        mode=payload.mode,
    )
