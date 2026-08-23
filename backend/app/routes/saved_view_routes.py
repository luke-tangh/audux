from fastapi import APIRouter, Depends
from sqlmodel import Session

from ..db import get_session
from ..schemas import (
    SavedViewCopy,
    SavedViewCreate,
    SavedViewsReorder,
    SavedViewUpdate,
)
from ..services import saved_view_service


router = APIRouter(prefix="/saved-views")


@router.get("")
def list_saved_views(session: Session = Depends(get_session)):
    return saved_view_service.list_saved_views(session)


@router.post("")
def create_saved_view(
    payload: SavedViewCreate,
    session: Session = Depends(get_session),
):
    return saved_view_service.create_saved_view(
        session,
        payload.name,
        payload.query,
    )


@router.patch("/reorder")
def reorder_saved_views(
    payload: SavedViewsReorder,
    session: Session = Depends(get_session),
):
    return saved_view_service.reorder_saved_views(
        session,
        payload.view_ids,
    )


@router.patch("/{view_id}")
def update_saved_view(
    view_id: int,
    payload: SavedViewUpdate,
    session: Session = Depends(get_session),
):
    return saved_view_service.update_saved_view(
        session,
        view_id,
        name=payload.name,
        query=payload.query,
    )


@router.post("/{view_id}/copy")
def copy_saved_view(
    view_id: int,
    payload: SavedViewCopy,
    session: Session = Depends(get_session),
):
    return saved_view_service.copy_saved_view(
        session,
        view_id,
        payload.name,
    )


@router.delete("/{view_id}")
def delete_saved_view(
    view_id: int,
    session: Session = Depends(get_session),
):
    return saved_view_service.delete_saved_view(session, view_id)
