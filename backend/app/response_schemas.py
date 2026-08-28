"""Explicit JSON response contracts shared by the HTTP route layer."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ResponseModel(BaseModel):
    # Response contracts require their documented fields while preserving
    # additive fields already returned by v1 services.
    model_config = ConfigDict(from_attributes=True, extra="allow")


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


class HealthResponse(ResponseModel):
    status: str


class AuthTokenResponse(ResponseModel):
    token: str
    header: str
    query: str


class LibraryRootResponse(ResponseModel):
    id: int
    path: str
    is_enabled: bool
    created_at: str
    updated_at: str


class ScanTaskResponse(ResponseModel):
    id: int
    root_id: int
    status: str
    total_files: int
    processed_files: int
    imported: int
    updated: int
    missing: int
    error_message: str | None = None
    error_code: str | None = None
    error_params: str | None = None
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    updated_at: str


class ScanSummaryResponse(ResponseModel):
    imported: int
    updated: int
    missing: int


class LibraryImportResponse(ResponseModel):
    root: LibraryRootResponse
    scan_task: ScanTaskResponse


class LibraryRootDeleteResponse(OkResponse):
    detached_audio_items: int
    removed_scan_tasks: int


class ActivityItemResponse(ResponseModel):
    id: str
    source: str
    source_id: int | None = None
    target_id: int | None = None
    kind: str
    status: str
    title: str
    detail: dict[str, Any] | None = None
    current: int | None = None
    total: int | None = None
    progress: float | None = None
    error_message: str | None = None
    error_code: str | None = None
    error_params: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    can_cancel: bool
    can_retry: bool


class ActivityFeedResponse(ResponseModel):
    items: list[ActivityItemResponse]
    active_count: int
    failed_count: int


class LibraryHealthTaskResponse(ResponseModel):
    id: int
    task_type: str
    status: str
    input: dict[str, Any]
    result: dict[str, Any] | None = None
    total_items: int
    processed_items: int
    error_message: str | None = None
    error_code: str | None = None
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    updated_at: str


class LibraryDuplicateAudioResponse(ResponseModel):
    id: int
    title: str
    file_path: str
    library_root_id: int | None = None


class LibraryDuplicateGroupResponse(ResponseModel):
    candidate_key: str | None = None
    reason: str | None = None
    hash_prefix: str | None = None
    file_size: int | None = None
    duration_seconds: float | None = None
    title: str | None = None
    audio_items: list[LibraryDuplicateAudioResponse]


class LibraryHealthRootResponse(ResponseModel):
    root: LibraryRootResponse
    path_available: bool
    database_total: int
    available: int
    missing: int
    unsupported_count: int | None = None
    unsupported_examples: list[str]
    supported_files_on_disk: int | None = None
    failed_scan_count: int
    latest_scan: ScanTaskResponse | None = None


class MissingAudioHealthItemResponse(ResponseModel):
    id: int
    title: str
    file_path: str
    library_root_id: int | None = None
    file_size: int | None = None
    duration_seconds: float | None = None
    updated_at: str


class LibraryHealthTotalsResponse(ResponseModel):
    roots: int
    disabled_roots: int
    available: int
    missing: int
    unsupported: int
    scan_failures: int
    duplicate_groups: int
    detached_audio: int


class LibraryHealthSummaryResponse(ResponseModel):
    generated_at: str | None = None
    roots: list[LibraryHealthRootResponse]
    totals: LibraryHealthTotalsResponse
    missing_audio: list[MissingAudioHealthItemResponse]
    duplicate_groups: list[LibraryDuplicateGroupResponse]
    active_tasks: list[LibraryHealthTaskResponse]
    latest_task: LibraryHealthTaskResponse | None = None


class SafeRelinkChecksResponse(ResponseModel):
    size: bool | None = None
    duration: bool | None = None
    metadata: bool | None = None
    fingerprint: bool | None = None


class SafeRelinkCandidateResponse(ResponseModel):
    path: str
    library_root_id: int
    library_root_path: str
    file_size: int
    mtime_ns: int
    duration_seconds: float | None = None
    title: str | None = None
    author: str | None = None
    album: str | None = None
    checks: SafeRelinkChecksResponse
    eligible: bool
    confidence: str
    conflict_audio_id: int | None = None


class SafeRelinkCandidatesResponse(ResponseModel):
    audio: MissingAudioHealthItemResponse
    candidates: list[SafeRelinkCandidateResponse]


class SafeRelinkPreviewAudioResponse(ResponseModel):
    id: int
    title: str
    old_path: str
    updated_at: str


class SafeRelinkImpactsResponse(ResponseModel):
    transcript_preserved: bool
    transcript_segments: int
    tags_preserved: int
    manual_playlists_preserved: int
    cover_preserved: bool
    cover_source: str | None = None
    play_count_preserved: int
    playback_position_preserved: float
    user_metadata_preserved: bool
    files_deleted: int
    database_records_deleted: int


class SafeRelinkConfirmationResponse(ResponseModel):
    expected_audio_updated_at: str
    expected_file_size: int
    expected_mtime_ns: int


class SafeRelinkPreviewResponse(ResponseModel):
    audio: SafeRelinkPreviewAudioResponse
    candidate: SafeRelinkCandidateResponse
    impacts: SafeRelinkImpactsResponse
    confirmation: SafeRelinkConfirmationResponse


class SafeRelinkCommitResponse(ResponseModel):
    audio: AudioItemResponse
    impacts: SafeRelinkImpactsResponse
    preserved: bool


class TagDeleteResponse(OkResponse):
    affected_audio_items: int


class TagMergeResponse(OkResponse):
    target_tag: TagResponse
    affected_audio_items: int
    created_links: int


class SavedViewDefinitionResponse(ResponseModel):
    schema_version: Literal[1] = 1
    view: str
    q: str
    tag_id: int | None = None
    tag_ids: list[int] = Field(default_factory=list)
    excluded_tag_ids: list[int] = Field(default_factory=list)
    tag_mode: str = "and"
    library_root_id: int | None = None
    transcript_filter: str
    missing_filter: str
    sort: str
    display_mode: str


class SavedViewResponse(ResponseModel):
    id: int
    name: str
    schema_version: int
    sort_order: int
    created_at: str
    updated_at: str
    query: SavedViewDefinitionResponse | None = None
    tag_name: str | None = None
    tag_names: list[str] = Field(default_factory=list)
    excluded_tag_names: list[str] = Field(default_factory=list)
    library_root_path: str | None = None
    invalid_references: list[str]
    definition_error: str | None = None


class PlaylistResponse(ResponseModel):
    id: int
    name: str
    description: str | None = None
    kind: str
    query_schema_version: int | None = None
    last_refreshed_at: str | None = None
    created_at: str
    updated_at: str
    query: SavedViewDefinitionResponse | None = None
    tag_name: str | None = None
    tag_names: list[str] = Field(default_factory=list)
    excluded_tag_names: list[str] = Field(default_factory=list)
    library_root_path: str | None = None
    invalid_references: list[str]
    definition_error: str | None = None
    current_count: int | None = None


class PlaylistItemResponse(ResponseModel):
    id: int
    playlist_id: int
    audio_id: int
    order_index: int
    created_at: str


class PlaylistDetailItemResponse(ResponseModel):
    playlist_item: PlaylistItemResponse
    audio: AudioItemResponse


class PlaylistDetailResponse(ResponseModel):
    playlist: PlaylistResponse
    items: list[PlaylistDetailItemResponse]


class PlaylistDeleteResponse(OkResponse):
    removed_items: int


class CountResponse(OkResponse):
    count: int


class SegmentSearchItemResponse(ResponseModel):
    scope: AgentScopeResponse
    audio_id: int
    audio_title: str
    revision_id: int | None = None
    segment_id: int | None = None
    segment_index: int
    start_seconds: float
    end_seconds: float
    matched_fields: list[str]
    text: str
    context_before: str
    context_after: str
    score: float


class SegmentSearchResponse(ResponseModel):
    items: list[SegmentSearchItemResponse]
    scope: AgentScopeResponse
    scope_label: str
    scope_audio_count: int
    retrieval_mode: str
    fallback_reason: str | None = None


class AgentScopeResponse(ResponseModel):
    kind: str
    audio_id: int | None = None
    audio_ids: list[int] = Field(default_factory=list)
    playlist_id: int | None = None
    saved_view_id: int | None = None
    tag_id: int | None = None
    library_root_id: int | None = None


class AgentCitationResponse(ResponseModel):
    id: int
    run_id: int
    message_id: int
    audio_id: int
    audio_title: str
    transcript_id: int | None = None
    segment_id: int | None = None
    start_seconds: float | None = None
    end_seconds: float | None = None
    quote: str
    label: str
    created_at: str


class AgentMessageResponse(ResponseModel):
    id: int
    conversation_id: int
    role: str
    content: str
    run_id: int | None = None
    created_at: str
    citations: list[AgentCitationResponse]


class AgentOperationItemResponse(ResponseModel):
    id: int
    plan_id: int
    item_index: int
    tool_name: str
    audio_id: int | None = None
    before: dict[str, Any]
    after: dict[str, Any]
    status: str
    error_message: str | None = None


class AgentOperationPlanResponse(ResponseModel):
    id: int
    run_id: int
    status: str
    failure_policy: str
    target_audio_ids: list[int]
    fingerprint: str
    summary: str
    error_message: str | None = None
    approved_at: str | None = None
    executed_at: str | None = None
    created_at: str
    updated_at: str
    items: list[AgentOperationItemResponse]


class AgentRunResponse(ResponseModel):
    id: int
    conversation_id: int
    user_message_id: int
    status: str
    scope: AgentScopeResponse
    retrieval_mode: str
    fallback_reason: str | None = None
    error_message: str | None = None
    error_code: str | None = None
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    updated_at: str
    message: AgentMessageResponse | None = None
    operation_plan: AgentOperationPlanResponse | None = None


class AgentConversationResponse(ResponseModel):
    id: int
    title: str
    scope: AgentScopeResponse
    scope_label: str
    scope_audio_count: int
    created_at: str
    updated_at: str
    messages: list[AgentMessageResponse] | None = None
    runs: list[AgentRunResponse] | None = None


class OrganizationRunOptionsResponse(ResponseModel):
    transcribe_missing: bool
    generate_corrections: bool
    generate_tags: bool
    generate_description: bool
    generate_chapters: bool


class OrganizationRunStepResponse(ResponseModel):
    id: int
    run_id: int
    stage: str
    step_index: int
    status: str
    processed_count: int
    failed_count: int
    detail: dict[str, Any] | None = None
    started_at: str | None = None
    finished_at: str | None = None
    updated_at: str


class OrganizationProposalResponse(ResponseModel):
    id: int
    run_id: int
    audio_id: int
    source_transcript_id: int | None = None
    source_segment_id: int | None = None
    kind: str
    status: str
    original_value: Any
    proposed_value: Any
    evidence: list[dict[str, Any]]
    diff: list[dict[str, Any]]
    rationale: str | None = None
    confidence: str
    decision_note: str | None = None
    decided_at: str | None = None
    applied_at: str | None = None
    created_at: str
    updated_at: str


class OrganizationRunTargetResponse(ResponseModel):
    id: int
    audio_id: int
    source_transcript_id: int | None = None
    status: str
    error_message: str | None = None
    title: str


class OrganizationAuditEventResponse(ResponseModel):
    id: int
    run_id: int
    proposal_id: int | None = None
    audio_id: int | None = None
    event_type: str
    detail: dict[str, Any] | None = None
    created_at: str


class OrganizationRunResponse(ResponseModel):
    id: int
    status: str
    current_stage: str
    scope: AgentScopeResponse
    options: OrganizationRunOptionsResponse
    target_count: int
    processed_count: int
    failed_count: int
    pending_review_count: int
    remote_characters: int
    error_message: str | None = None
    error_code: str | None = None
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    updated_at: str
    steps: list[OrganizationRunStepResponse] | None = None
    targets: list[OrganizationRunTargetResponse] | None = None
    proposals: list[OrganizationProposalResponse] | None = None
    proposal_counts: dict[str, int] | None = None
    audit_events: list[OrganizationAuditEventResponse] | None = None


class StatisticsOverviewResponse(ResponseModel):
    generated_at: str
    period_days: int
    period_started_at: str
    library: dict[str, int | float]
    coverage: dict[str, dict[str, int]]
    formats: list[dict[str, int | float | str]]
    duration_buckets: list[dict[str, int | str]]
    roots: list[dict[str, int | float | str | bool]]
    top_tags: list[dict[str, int | str]]
    ingest_timeline: list[dict[str, int | str]]
    listening: dict[str, Any]


class RebuildSearchIndexResponse(OkResponse):
    count: int


class CleanupTagsResponse(OkResponse):
    deleted: int


class AppLogsResponse(ResponseModel):
    file: str
    content: str


class DatabaseBackupResponse(ResponseModel):
    id: str
    name: str
    kind: str
    created_at: str
    app_version: str | None = None
    schema_version: int | None = None
    size_bytes: int
    integrity_status: str
    integrity_error: str | None = None
    sha256: str | None = None
    restore_compatible: bool
    compatibility_error: str | None = None


class ApplicationUpdatePreparationResponse(OkResponse):
    current_version: str
    target_version: str
    backup: DatabaseBackupResponse


class DatabaseBackupDeleteResponse(OkResponse):
    id: str


class DatabaseRestoreBlockerResponse(ResponseModel):
    code: str
    message: str
    params: dict[str, Any] = Field(default_factory=dict)


class DatabaseRestorePreflightResponse(ResponseModel):
    ok: bool
    backup: DatabaseBackupResponse
    blockers: list[DatabaseRestoreBlockerResponse]
    active_ai_tasks: int
    active_scan_tasks: int
    active_health_tasks: int
    active_agent_runs: int
    active_organization_runs: int
    required_bytes: int
    free_bytes: int
    restart_required: bool


class PendingDatabaseRestoreResponse(ResponseModel):
    snapshot_id: str
    safety_snapshot_id: str
    requested_at: str
    status: str | None = None
    restart_required: bool | None = None


class DatabaseRestoreResultResponse(ResponseModel):
    status: str
    snapshot_id: str | None = None
    safety_snapshot_id: str | None = None
    requested_at: str | None = None
    completed_at: str
    error: str | None = None


class DatabaseRestoreStatusResponse(ResponseModel):
    pending: PendingDatabaseRestoreResponse | None = None
    last_result: DatabaseRestoreResultResponse | None = None


class ArchiveManifestResponse(ResponseModel):
    format: Literal["audux-archive"]
    format_version: int
    app_version: str
    schema_version: int
    created_at: str
    counts: dict[str, int]


class PortableArchiveResponse(ResponseModel):
    id: str
    file_name: str
    size_bytes: int
    manifest: ArchiveManifestResponse


class ArchiveImportDryRunResponse(ResponseModel):
    archive_id: str
    fingerprint: str
    compatible: bool
    schema_version: int
    counts: dict[str, int]
    missing_audio: int
    id_conflicts: dict[str, int]
    merge_strategy: str
    can_import: bool
    blockers: list[str]


class ArchiveImportResponse(OkResponse):
    schema_version: int
    counts: dict[str, int]
    missing_audio: int


class DiagnosticBundleResponse(ResponseModel):
    id: str
    file_name: str
    size_bytes: int
