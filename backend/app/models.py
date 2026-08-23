from typing import Optional
from sqlmodel import SQLModel, Field
from .time_utils import utc_now_iso


def now_iso() -> str:
    return utc_now_iso()


class LibraryRoot(SQLModel, table=True):
    __tablename__ = "library_roots"

    id: Optional[int] = Field(default=None, primary_key=True)
    path: str = Field(unique=True, index=True)
    is_enabled: bool = True
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class AudioItem(SQLModel, table=True):
    __tablename__ = "audio_items"

    id: Optional[int] = Field(default=None, primary_key=True)

    file_path: str = Field(unique=True, index=True)
    file_name: str
    file_ext: Optional[str] = None
    file_size: Optional[int] = None
    file_mtime: Optional[str] = None
    file_hash: Optional[str] = None

    library_root_id: Optional[int] = Field(default=None, foreign_key="library_roots.id")

    title_original: Optional[str] = None
    title_user: Optional[str] = None

    author_original: Optional[str] = None
    author_user: Optional[str] = None

    album_original: Optional[str] = None
    album_user: Optional[str] = None

    description_original: Optional[str] = None
    description_user: Optional[str] = None
    description_ai: Optional[str] = None

    cover_path: Optional[str] = None
    cover_source: Optional[str] = None

    duration_seconds: Optional[float] = None
    bitrate: Optional[int] = None
    sample_rate: Optional[int] = None
    channels: Optional[int] = None

    language: Optional[str] = None

    transcript_status: str = "none"
    ai_status: str = "none"

    play_count: int = 0
    last_played_at: Optional[str] = None
    last_position_seconds: float = 0

    is_favorite: bool = False
    is_missing: bool = False

    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class PlaybackEvent(SQLModel, table=True):
    __tablename__ = "playback_events"

    id: Optional[int] = Field(default=None, primary_key=True)
    audio_id: int = Field(foreign_key="audio_items.id", index=True)
    started_at: str = Field(default_factory=now_iso, index=True)
    ended_at: Optional[str] = None
    start_position_seconds: float = 0
    end_position_seconds: float = 0
    listened_seconds: float = 0
    completed: bool = False
    end_reason: Optional[str] = None


class Tag(SQLModel, table=True):
    __tablename__ = "tags"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(unique=True, index=True)
    source: str = "user"
    created_at: str = Field(default_factory=now_iso)


class AudioTag(SQLModel, table=True):
    __tablename__ = "audio_tags"

    audio_id: int = Field(foreign_key="audio_items.id", primary_key=True)
    tag_id: int = Field(foreign_key="tags.id", primary_key=True)
    created_at: str = Field(default_factory=now_iso)


class Playlist(SQLModel, table=True):
    __tablename__ = "playlists"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    description: Optional[str] = None
    kind: str = Field(default="manual", index=True)
    query_json: Optional[str] = None
    query_schema_version: Optional[int] = None
    last_refreshed_at: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class PlaylistItem(SQLModel, table=True):
    __tablename__ = "playlist_items"

    id: Optional[int] = Field(default=None, primary_key=True)
    playlist_id: int = Field(foreign_key="playlists.id", index=True)
    audio_id: int = Field(foreign_key="audio_items.id", index=True)
    order_index: int
    created_at: str = Field(default_factory=now_iso)


class SavedView(SQLModel, table=True):
    __tablename__ = "saved_views"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    query_json: str
    schema_version: int = 1
    sort_order: int = 0
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class Transcript(SQLModel, table=True):
    __tablename__ = "transcripts"

    id: Optional[int] = Field(default=None, primary_key=True)
    audio_id: int = Field(foreign_key="audio_items.id", index=True)
    revision_number: int = 1
    parent_revision_id: Optional[int] = Field(
        default=None,
        foreign_key="transcripts.id",
    )
    is_current: bool = Field(default=True, index=True)
    source_type: str = Field(default="asr", index=True)
    provider_name: Optional[str] = None
    language: Optional[str] = None
    full_text: str
    model_name: Optional[str] = None
    task_config_json: Optional[str] = None
    glossary_version: Optional[str] = None
    quality_metrics_json: Optional[str] = None
    status: str = "done"
    generated_at: str = Field(default_factory=now_iso)
    accepted_at: Optional[str] = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class TranscriptSegment(SQLModel, table=True):
    __tablename__ = "transcript_segments"

    id: Optional[int] = Field(default=None, primary_key=True)
    transcript_id: int = Field(foreign_key="transcripts.id", index=True)
    segment_index: int
    start_seconds: float
    end_seconds: float
    text: str


class TranscriptChapter(SQLModel, table=True):
    __tablename__ = "transcript_chapters"

    id: Optional[int] = Field(default=None, primary_key=True)
    transcript_id: int = Field(foreign_key="transcripts.id", index=True)
    chapter_index: int
    title: str
    start_seconds: float
    end_seconds: float
    source_type: str = "user"
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class TranscriptIssue(SQLModel, table=True):
    __tablename__ = "transcript_issues"

    id: Optional[int] = Field(default=None, primary_key=True)
    audio_id: int = Field(foreign_key="audio_items.id", index=True)
    transcript_id: int = Field(foreign_key="transcripts.id", index=True)
    segment_id: Optional[int] = Field(
        default=None,
        foreign_key="transcript_segments.id",
    )
    code: str = Field(index=True)
    severity: str = Field(index=True)
    evidence_json: str
    status: str = Field(default="open", index=True)
    closed_reason: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class AITask(SQLModel, table=True):
    __tablename__ = "ai_tasks"

    id: Optional[int] = Field(default=None, primary_key=True)
    audio_id: int = Field(foreign_key="audio_items.id", index=True)
    task_type: str
    status: str = "pending"
    input_payload: Optional[str] = None
    output_payload: Optional[str] = None
    error_message: Optional[str] = None
    error_code: Optional[str] = None
    error_params: Optional[str] = None
    retry_count: int = 0
    created_at: str = Field(default_factory=now_iso)
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    updated_at: str = Field(default_factory=now_iso)


class Setting(SQLModel, table=True):
    __tablename__ = "settings"

    key: str = Field(primary_key=True)
    value: str
    updated_at: str = Field(default_factory=now_iso)


class ScanTask(SQLModel, table=True):
    __tablename__ = "scan_tasks"

    id: Optional[int] = Field(default=None, primary_key=True)
    root_id: int = Field(foreign_key="library_roots.id", index=True)

    status: str = "pending"

    total_files: int = 0
    processed_files: int = 0

    imported: int = 0
    updated: int = 0
    missing: int = 0

    error_message: Optional[str] = None
    error_code: Optional[str] = None
    error_params: Optional[str] = None

    created_at: str = Field(default_factory=now_iso)
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    updated_at: str = Field(default_factory=now_iso)


class LibraryHealthTask(SQLModel, table=True):
    __tablename__ = "library_health_tasks"

    id: Optional[int] = Field(default=None, primary_key=True)
    task_type: str = "health_check"
    status: str = "pending"
    input_json: Optional[str] = None
    result_json: Optional[str] = None
    total_items: int = 0
    processed_items: int = 0
    error_message: Optional[str] = None
    error_code: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    updated_at: str = Field(default_factory=now_iso)


class AgentConversation(SQLModel, table=True):
    __tablename__ = "agent_conversations"

    id: Optional[int] = Field(default=None, primary_key=True)
    title: str = "新会话"
    scope_json: str
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class AgentMessage(SQLModel, table=True):
    __tablename__ = "agent_messages"

    id: Optional[int] = Field(default=None, primary_key=True)
    conversation_id: int = Field(foreign_key="agent_conversations.id", index=True)
    role: str = Field(index=True)
    content: str
    run_id: Optional[int] = Field(default=None, index=True)
    created_at: str = Field(default_factory=now_iso)


class AgentRun(SQLModel, table=True):
    __tablename__ = "agent_runs"

    id: Optional[int] = Field(default=None, primary_key=True)
    conversation_id: int = Field(foreign_key="agent_conversations.id", index=True)
    user_message_id: int = Field(foreign_key="agent_messages.id")
    status: str = Field(default="pending", index=True)
    scope_json: str
    allowed_audio_ids_json: str
    retrieval_mode: str = "fts"
    fallback_reason: Optional[str] = None
    max_steps: int = 6
    max_candidates: int = 20
    max_transcript_characters: int = 24000
    token_budget: int = 4800
    error_message: Optional[str] = None
    error_code: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    updated_at: str = Field(default_factory=now_iso)


class AgentRunStep(SQLModel, table=True):
    __tablename__ = "agent_run_steps"

    id: Optional[int] = Field(default=None, primary_key=True)
    run_id: int = Field(foreign_key="agent_runs.id", index=True)
    step_index: int
    kind: str
    status: str = "done"
    detail_json: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)


class AgentToolCall(SQLModel, table=True):
    __tablename__ = "agent_tool_calls"

    id: Optional[int] = Field(default=None, primary_key=True)
    run_id: int = Field(foreign_key="agent_runs.id", index=True)
    step_id: Optional[int] = Field(default=None, foreign_key="agent_run_steps.id")
    tool_name: str
    arguments_json: str
    output_json: Optional[str] = None
    status: str = "done"
    error_message: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)


class AgentCitation(SQLModel, table=True):
    __tablename__ = "agent_citations"

    id: Optional[int] = Field(default=None, primary_key=True)
    run_id: int = Field(foreign_key="agent_runs.id", index=True)
    message_id: int = Field(foreign_key="agent_messages.id", index=True)
    audio_id: int = Field(foreign_key="audio_items.id", index=True)
    transcript_id: Optional[int] = Field(default=None, foreign_key="transcripts.id")
    segment_id: Optional[int] = Field(default=None, foreign_key="transcript_segments.id")
    start_seconds: Optional[float] = None
    end_seconds: Optional[float] = None
    quote: str
    label: str
    created_at: str = Field(default_factory=now_iso)


class OrganizationRun(SQLModel, table=True):
    """A frozen, auditable v0.8 organization workflow."""

    __tablename__ = "organization_runs"

    id: Optional[int] = Field(default=None, primary_key=True)
    status: str = Field(default="pending", index=True)
    current_stage: str = Field(default="preflight", index=True)
    scope_json: str
    options_json: str
    target_count: int = 0
    processed_count: int = 0
    failed_count: int = 0
    pending_review_count: int = 0
    remote_characters: int = 0
    error_message: Optional[str] = None
    error_code: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    updated_at: str = Field(default_factory=now_iso)


class OrganizationRunTarget(SQLModel, table=True):
    __tablename__ = "organization_run_targets"

    id: Optional[int] = Field(default=None, primary_key=True)
    run_id: int = Field(foreign_key="organization_runs.id", index=True)
    audio_id: int = Field(foreign_key="audio_items.id", index=True)
    source_transcript_id: Optional[int] = Field(
        default=None,
        foreign_key="transcripts.id",
    )
    status: str = Field(default="pending", index=True)
    error_message: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class OrganizationRunStep(SQLModel, table=True):
    __tablename__ = "organization_run_steps"

    id: Optional[int] = Field(default=None, primary_key=True)
    run_id: int = Field(foreign_key="organization_runs.id", index=True)
    stage: str
    step_index: int
    status: str = Field(default="pending", index=True)
    processed_count: int = 0
    failed_count: int = 0
    detail_json: Optional[str] = None
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    updated_at: str = Field(default_factory=now_iso)


class OrganizationProposal(SQLModel, table=True):
    __tablename__ = "organization_proposals"

    id: Optional[int] = Field(default=None, primary_key=True)
    run_id: int = Field(foreign_key="organization_runs.id", index=True)
    audio_id: int = Field(foreign_key="audio_items.id", index=True)
    source_transcript_id: Optional[int] = Field(
        default=None,
        foreign_key="transcripts.id",
    )
    source_segment_id: Optional[int] = Field(
        default=None,
        foreign_key="transcript_segments.id",
    )
    kind: str = Field(index=True)
    status: str = Field(default="pending", index=True)
    dedupe_key: str
    original_value_json: str
    proposed_value_json: str
    evidence_json: str
    rationale: Optional[str] = None
    confidence: str = "unknown"
    decision_note: Optional[str] = None
    decided_at: Optional[str] = None
    applied_at: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class OrganizationAuditEvent(SQLModel, table=True):
    __tablename__ = "organization_audit_events"

    id: Optional[int] = Field(default=None, primary_key=True)
    run_id: int = Field(foreign_key="organization_runs.id", index=True)
    proposal_id: Optional[int] = Field(
        default=None,
        foreign_key="organization_proposals.id",
    )
    audio_id: Optional[int] = Field(default=None, foreign_key="audio_items.id")
    event_type: str = Field(index=True)
    detail_json: str
    created_at: str = Field(default_factory=now_iso)
