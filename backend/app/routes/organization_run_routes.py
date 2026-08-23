from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from ..db import get_session
from ..schemas import (
    OrganizationProposalDecision,
    OrganizationRunApply,
    OrganizationRunCreate,
)
from ..services import organization_run_service
from .utils import service_call


router = APIRouter()


@router.get("/organization-runs")
def list_organization_runs(
    limit: int = Query(default=50, ge=1, le=200),
    session: Session = Depends(get_session),
):
    return organization_run_service.list_runs(session, limit)


@router.post("/organization-runs")
def create_organization_run(
    payload: OrganizationRunCreate,
    session: Session = Depends(get_session),
):
    return service_call(organization_run_service.create_run, session, payload)


@router.get("/organization-runs/{run_id}")
def get_organization_run(run_id: int, session: Session = Depends(get_session)):
    return service_call(organization_run_service.get_run, session, run_id)


@router.post("/organization-runs/{run_id}/cancel")
def cancel_organization_run(run_id: int, session: Session = Depends(get_session)):
    return service_call(organization_run_service.cancel_run, session, run_id)


@router.post("/organization-runs/{run_id}/retry")
def retry_organization_run(run_id: int, session: Session = Depends(get_session)):
    return service_call(organization_run_service.retry_run, session, run_id)


@router.patch("/organization-proposals/{proposal_id}")
def decide_organization_proposal(
    proposal_id: int,
    payload: OrganizationProposalDecision,
    session: Session = Depends(get_session),
):
    return service_call(
        organization_run_service.decide_proposal,
        session,
        proposal_id,
        payload,
    )


@router.post("/organization-runs/{run_id}/apply")
def apply_organization_run(
    run_id: int,
    payload: OrganizationRunApply,
    session: Session = Depends(get_session),
):
    return service_call(organization_run_service.apply_run, session, run_id, payload)
