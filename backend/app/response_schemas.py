"""Explicit JSON response contracts shared by the HTTP route layer."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ResponseModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class TagResponse(ResponseModel):
    id: int
    name: str
    source: str
    created_at: str


class SearchHitResponse(ResponseModel):
    field: str
    label: str
    text: str
    start_seconds: float | None = None
    end_seconds: float | None = None
    segment_index: int | None = None
    transcript_revision_id: int | None = None
    segment_id: int | None = None
    context_before: str | None = None
    context_after: str | None = None


class AudioItemResponse(ResponseModel):
    id: int
    file_path: str
    file_name: str
    file_ext: str | None = None
    file_size: int | None = None
    file_mtime: str | None = None
    file_hash: str | None = None
    library_root_id: int | None = None
    title_original: str | None = None
    title_user: str | None = None
    author_original: str | None = None
    author_user: str | None = None
    album_original: str | None = None
    album_user: str | None = None
    description_original: str | None = None
    description_user: str | None = None
    description_ai: str | None = None
    cover_path: str | None = None
    cover_source: str | None = None
    duration_seconds: float | None = None
    bitrate: int | None = None
    sample_rate: int | None = None
    channels: int | None = None
    language: str | None = None
    transcript_status: str
    ai_status: str
    play_count: int
    last_played_at: str | None = None
    last_position_seconds: float
    is_favorite: bool
    is_missing: bool
    created_at: str
    updated_at: str
    tags: list[TagResponse] = Field(default_factory=list)
    search_hits: list[SearchHitResponse] = Field(default_factory=list)
    playlist_item_id: int | None = None
    playlist_order_index: int | None = None


class AudioDetailResponse(ResponseModel):
    audio: AudioItemResponse
    tags: list[TagResponse]


class FacetTagResponse(ResponseModel):
    id: int
    name: str
    count: int


class FacetRootResponse(ResponseModel):
    id: int
    path: str
    count: int


class AudioFacetsResponse(ResponseModel):
    tags: list[FacetTagResponse]
    roots: list[FacetRootResponse]


class PaginatedAudioItemsResponse(ResponseModel):
    items: list[AudioItemResponse]
    total: int
    limit: int
    offset: int
    has_more: bool
    search_limited: bool = False
    search_limit: int | None = None
    playlist_kind: Literal["manual", "smart"] | None = None
    refreshed_at: str | None = None
    facets: AudioFacetsResponse | None = None


class SkippedAudioResponse(ResponseModel):
    audio_id: int
    reason: str


class PlaybackQueueResponse(ResponseModel):
    items: list[AudioItemResponse]
    skipped: list[SkippedAudioResponse]


class PlaybackEventResponse(ResponseModel):
    id: int
    audio_id: int
    started_at: str
    ended_at: str | None = None
    start_position_seconds: float
    end_position_seconds: float
    listened_seconds: float
    completed: bool
    end_reason: str | None = None


class OkResponse(ResponseModel):
    ok: bool


class AudioDeleteResponse(OkResponse):
    file_deleted: bool
    cleanup_error: str | None = None


class BatchTaskResponse(ResponseModel):
    created: int
    skipped: int
    errors: list[dict[str, Any]]
    task_ids: list[int]
    privacy_warning: str | None = None
    privacy_warning_code: str | None = None


class BatchOrganizationResponse(ResponseModel):
    action: str
    requested_count: int
    matched_count: int
    changed_count: int
    unchanged_count: int
    duplicate_count: int
    relationship_changes: int
    errors: list[dict[str, Any]]


class AISuggestionsResponse(ResponseModel):
    task_id: int | None = None
    description: str | None = None
    tags: list[str]
    language: str | None = None
    raw_content: str | None = None


class AITaskResponse(ResponseModel):
    id: int
    audio_id: int
    task_type: str
    status: str
    input_payload: str | None = None
    output_payload: str | None = None
    error_message: str | None = None
    error_code: str | None = None
    error_params: str | None = None
    retry_count: int
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    updated_at: str
    privacy_warning: str | None = None
    privacy_warning_code: str | None = None


class TranscriptRevisionResponse(ResponseModel):
    id: int
    audio_id: int
    revision_number: int
    parent_revision_id: int | None = None
    is_current: bool
    source_type: str
    provider_name: str | None = None
    language: str | None = None
    full_text: str
    model_name: str | None = None
    task_config_summary: dict[str, Any] | None = None
    glossary_version: str | None = None
    quality_metrics: dict[str, Any] | None = None
    status: str
    generated_at: str
    accepted_at: str | None = None
    updated_at: str


class TranscriptSegmentResponse(ResponseModel):
    id: int
    transcript_id: int
    segment_index: int
    start_seconds: float
    end_seconds: float
    text: str


class TranscriptChapterResponse(ResponseModel):
    id: int
    transcript_id: int
    chapter_index: int
    title: str
    start_seconds: float
    end_seconds: float
    source_type: str
    created_at: str
    updated_at: str


class TranscriptIssueResponse(ResponseModel):
    id: int
    audio_id: int
    transcript_id: int
    segment_id: int | None = None
    code: str
    severity: str
    evidence: dict[str, Any]
    status: str
    closed_reason: str | None = None
    created_at: str
    updated_at: str


class TranscriptValidationReportResponse(ResponseModel):
    closed_issue_ids: list[int]
    still_open_issue_ids: list[int]
    new_issue_ids: list[int]


class TranscriptResponse(ResponseModel):
    transcript: TranscriptRevisionResponse
    segments: list[TranscriptSegmentResponse]
    chapters: list[TranscriptChapterResponse] = Field(default_factory=list)
    issues: list[TranscriptIssueResponse] = Field(default_factory=list)
    cleared_segments: int | None = None
    updated_segments: int | None = None
    validation_report: TranscriptValidationReportResponse | None = None


class TranscriptDiagnosticResponse(ResponseModel):
    schema_version: int
    audio_id: int
    revision: dict[str, Any]
    issues: list[TranscriptIssueResponse]


class TranscriptDeleteResponse(OkResponse):
    deleted_revisions: int


class LLMCapabilitiesResponse(ResponseModel):
    structured_output: bool
    tool_calling: bool
    streaming_tool_calling: bool
    agent_execution: bool


class LLMTestResponse(ResponseModel):
    ok: bool
    content: str
    latency_ms: int
    model_name: str
    is_local_endpoint: bool
    privacy_warning: str | None = None
    privacy_warning_code: str | None = None
    capabilities: LLMCapabilitiesResponse


class LLMModelsResponse(ResponseModel):
    models: list[str]
    is_local_endpoint: bool
    privacy_warning: str | None = None
    privacy_warning_code: str | None = None


class ToolSchemasResponse(ResponseModel):
    tools: list[dict[str, Any]]


class WhisperComponentResponse(ResponseModel):
    status: str
    available: bool
    source: str | None = None
    app_version: str
    target: str
    downloaded_bytes: int
    total_bytes: int | None = None
    error_message: str | None = None


class ExternalPreprocessingResponse(ResponseModel):
    available: bool
    ffmpeg_available: bool
    ffprobe_available: bool
    vad_available: bool
    vad_model_available: bool
    vad_runtime_version: str
    vad_provider: str | None = None
    vad_model: str
    vad_error: str | None = None
    missing: list[str]
