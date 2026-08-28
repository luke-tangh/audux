from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from ..db import get_session
from ..response_schemas import (
    OrganizationProposalResponse,
    OrganizationRunResponse,
)
from ..schemas import (
    OrganizationProposalDecision,
    OrganizationRunApply,
    OrganizationRunCreate,
)
from ..services import organization_run_service


router = APIRouter()


@router.get("/organization-runs", response_model=list[OrganizationRunResponse])
def list_organization_runs(
    limit: int = Query(default=50, ge=1, le=200),
    session: Session = Depends(get_session),
):
    return organization_run_service.list_runs(session, limit)


@router.post("/organization-runs", response_model=OrganizationRunResponse)
def create_organization_run(
    payload: OrganizationRunCreate,
    session: Session = Depends(get_session),
):
    return organization_run_service.create_run(session, payload)


@router.get("/organization-runs/{run_id}", response_model=OrganizationRunResponse)
def get_organization_run(run_id: int, session: Session = Depends(get_session)):
    return organization_run_service.get_run(session, run_id)


@router.post(
    "/organization-runs/{run_id}/cancel",
    response_model=OrganizationRunResponse,
)
def cancel_organization_run(run_id: int, session: Session = Depends(get_session)):
    return organization_run_service.cancel_run(session, run_id)


@router.post(
    "/organization-runs/{run_id}/retry",
    response_model=OrganizationRunResponse,
)
def retry_organization_run(run_id: int, session: Session = Depends(get_session)):
    return organization_run_service.retry_run(session, run_id)


@router.patch(
    "/organization-proposals/{proposal_id}",
    response_model=OrganizationProposalResponse,
)
def decide_organization_proposal(
    proposal_id: int,
    payload: OrganizationProposalDecision,
    session: Session = Depends(get_session),
):
    return organization_run_service.decide_proposal(
        session,
        proposal_id,
        payload,
    )


@router.post(
    "/organization-runs/{run_id}/apply",
    response_model=OrganizationRunResponse,
)
def apply_organization_run(
    run_id: int,
    payload: OrganizationRunApply,
    session: Session = Depends(get_session),
):
    return organization_run_service.apply_run(session, run_id, payload)
