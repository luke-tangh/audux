from fastapi import APIRouter, Depends
from sqlmodel import Session

from ..db import get_session
from ..schemas import (
    TranscriptChapterCreate,
    TranscriptChapterMerge,
    TranscriptChapterUpdate,
    TranscriptCreate,
    TranscriptIssueUpdate,
    TranscriptSegmentsUpdate,
    TranscriptUpdate,
)
from ..response_schemas import (
    AITaskResponse,
    OkResponse,
    TranscriptChapterResponse,
    TranscriptDeleteResponse,
    TranscriptDiagnosticResponse,
    TranscriptIssueResponse,
    TranscriptResponse,
    TranscriptRevisionResponse,
)
from ..services import transcript_service


router = APIRouter()


@router.post("/audio-items/{audio_id}/transcribe", response_model=AITaskResponse)
def enqueue_transcribe(audio_id: int, session: Session = Depends(get_session)):
    return transcript_service.enqueue_transcribe(session, audio_id)


@router.get("/audio-items/{audio_id}/transcript", response_model=TranscriptResponse)
def get_transcript(audio_id: int, session: Session = Depends(get_session)):
    return transcript_service.get_transcript(session, audio_id)


@router.get(
    "/audio-items/{audio_id}/transcript/revisions",
    response_model=list[TranscriptRevisionResponse],
)
def list_transcript_revisions(audio_id: int, session: Session = Depends(get_session)):
    return transcript_service.list_transcript_revisions(
        session,
        audio_id,
    )


@router.get(
    "/audio-items/{audio_id}/transcript/revisions/{revision_id}",
    response_model=TranscriptResponse,
)
def get_transcript_revision(
    audio_id: int,
    revision_id: int,
    session: Session = Depends(get_session),
):
    return transcript_service.get_transcript_revision(
        session,
        audio_id,
        revision_id,
    )


@router.get("/audio-items/{audio_id}/transcript/export")
def export_transcript(
    audio_id: int,
    format: str = "txt",
    session: Session = Depends(get_session),
):
    return transcript_service.export_transcript_response(
        session,
        audio_id,
        format,
    )


@router.post("/audio-items/{audio_id}/transcript", response_model=TranscriptResponse)
def save_transcript(
    audio_id: int,
    payload: TranscriptCreate,
    session: Session = Depends(get_session),
):
    return transcript_service.save_transcript(session, audio_id, payload)


@router.patch("/audio-items/{audio_id}/transcript", response_model=TranscriptResponse)
def update_transcript(
    audio_id: int,
    payload: TranscriptUpdate,
    session: Session = Depends(get_session),
):
    return transcript_service.update_transcript(
        session,
        audio_id,
        payload.full_text,
        payload.expected_updated_at,
    )


@router.patch(
    "/audio-items/{audio_id}/transcript/segments",
    response_model=TranscriptResponse,
)
def update_transcript_segments(
    audio_id: int,
    payload: TranscriptSegmentsUpdate,
    session: Session = Depends(get_session),
):
    return transcript_service.update_transcript_segments(
        session,
        audio_id,
        payload.segments,
        payload.expected_updated_at,
    )


@router.delete(
    "/audio-items/{audio_id}/transcript",
    response_model=TranscriptDeleteResponse,
)
def delete_transcript(audio_id: int, session: Session = Depends(get_session)):
    return transcript_service.delete_transcript(session, audio_id)


@router.post(
    "/audio-items/{audio_id}/transcript/validate",
    response_model=TranscriptResponse,
)
def revalidate_transcript(audio_id: int, session: Session = Depends(get_session)):
    return transcript_service.revalidate_transcript(session, audio_id)


@router.get(
    "/audio-items/{audio_id}/transcript/diagnostics",
    response_model=TranscriptDiagnosticResponse,
)
def transcript_diagnostics(audio_id: int, session: Session = Depends(get_session)):
    return transcript_service.transcript_diagnostic_summary(
        session,
        audio_id,
    )


@router.patch(
    "/audio-items/{audio_id}/transcript/issues/{issue_id}",
    response_model=TranscriptIssueResponse,
)
def update_transcript_issue(
    audio_id: int,
    issue_id: int,
    payload: TranscriptIssueUpdate,
    session: Session = Depends(get_session),
):
    return transcript_service.update_transcript_issue(
        session,
        audio_id,
        issue_id,
        payload,
    )


@router.post(
    "/audio-items/{audio_id}/transcript/chapters",
    response_model=TranscriptChapterResponse,
)
def create_transcript_chapter(
    audio_id: int,
    payload: TranscriptChapterCreate,
    session: Session = Depends(get_session),
):
    return transcript_service.create_chapter(
        session,
        audio_id,
        payload,
    )


@router.post(
    "/audio-items/{audio_id}/transcript/chapters/merge",
    response_model=TranscriptChapterResponse,
)
def merge_transcript_chapters(
    audio_id: int,
    payload: TranscriptChapterMerge,
    session: Session = Depends(get_session),
):
    return transcript_service.merge_chapters(
        session,
        audio_id,
        payload,
    )


@router.patch(
    "/audio-items/{audio_id}/transcript/chapters/{chapter_id}",
    response_model=TranscriptChapterResponse,
)
def update_transcript_chapter(
    audio_id: int,
    chapter_id: int,
    payload: TranscriptChapterUpdate,
    session: Session = Depends(get_session),
):
    return transcript_service.update_chapter(
        session,
        audio_id,
        chapter_id,
        payload,
    )


@router.delete(
    "/audio-items/{audio_id}/transcript/chapters/{chapter_id}",
    response_model=OkResponse,
)
def delete_transcript_chapter(
    audio_id: int,
    chapter_id: int,
    session: Session = Depends(get_session),
):
    return transcript_service.delete_chapter(
        session,
        audio_id,
        chapter_id,
    )
