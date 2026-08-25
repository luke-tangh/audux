from typing import Annotated, Any, List, Literal, Optional
from pydantic import BaseModel, Field, model_validator


AudioSortMode = Literal[
    "default",
    "title_asc",
    "title_desc",
    "author_asc",
    "created_desc",
    "updated_desc",
    "duration_asc",
    "duration_desc",
    "play_count_desc",
]


class LibraryRootCreate(BaseModel):
    path: str


class LibraryRootUpdate(BaseModel):
    is_enabled: Optional[bool] = None


class AudioUpdate(BaseModel):
    title_user: Optional[str] = None
    author_user: Optional[str] = None
    album_user: Optional[str] = None
    description_user: Optional[str] = None
    language: Optional[str] = None
    is_favorite: Optional[bool] = None


class PlaybackPositionUpdate(BaseModel):
    last_position_seconds: float = Field(ge=0, allow_inf_nan=False)


class PlaybackEventCreate(BaseModel):
    start_position_seconds: float = Field(default=0, ge=0, allow_inf_nan=False)


class PlaybackEventUpdate(BaseModel):
    listened_seconds: float = Field(ge=0, allow_inf_nan=False)
    end_position_seconds: float = Field(ge=0, allow_inf_nan=False)
    completed: bool = False
    finish: bool = False
    end_reason: Optional[Literal["paused", "ended", "track_change", "closed"]] = None


class PlaybackQueueResolveRequest(BaseModel):
    audio_ids: List[int] = Field(min_length=1, max_length=500)


class RelocateAudioRequest(BaseModel):
    file_path: str


class DuplicateHashConfirmRequest(BaseModel):
    audio_ids: List[int] = Field(min_length=2, max_length=50)


class SafeRelinkPreviewRequest(BaseModel):
    candidate_path: str = Field(min_length=1, max_length=4096)


class SafeRelinkCommitRequest(SafeRelinkPreviewRequest):
    expected_audio_updated_at: str = Field(min_length=1)
    expected_file_size: int = Field(ge=0)
    expected_mtime_ns: int = Field(ge=0)


class TagsAddRequest(BaseModel):
    tags: List[str]
    source: str = "user"


class TagUpdate(BaseModel):
    name: Optional[str] = None


class TagMergeRequest(BaseModel):
    target_tag_id: int


class PlaylistCreate(BaseModel):
    name: str
    description: Optional[str] = None


class PlaylistUpdate(BaseModel):
    name: str


class PlaylistItemAdd(BaseModel):
    audio_id: int


class PlaylistItemsReorder(BaseModel):
    item_ids: List[int]


class TranscriptSegmentCreate(BaseModel):
    segment_index: int = Field(ge=0)
    start_seconds: float = Field(allow_inf_nan=False)
    end_seconds: float = Field(allow_inf_nan=False)
    text: str


class TranscriptCreate(BaseModel):
    language: Optional[str] = None
    full_text: str
    model_name: Optional[str] = None
    provider_name: Optional[str] = None
    source_type: Literal["asr", "manual", "agent"] = "asr"
    task_config_summary: Optional[dict] = None
    glossary_version: Optional[str] = None
    quality_metrics: Optional[dict] = None
    segments: List[TranscriptSegmentCreate] = Field(
        default_factory=list,
        max_length=10_000,
    )

    @model_validator(mode="after")
    def validate_segment_indexes(self):
        indexes = [segment.segment_index for segment in self.segments]
        if indexes != list(range(len(indexes))):
            raise ValueError(
                "segment indexes must be unique, ordered, and start at zero"
            )
        return self


class TranscriptUpdate(BaseModel):
    full_text: str
    expected_updated_at: str = Field(min_length=1)


class TranscriptSegmentUpdate(BaseModel):
    id: int = Field(gt=0)
    text: str


class TranscriptSegmentsUpdate(BaseModel):
    expected_updated_at: str = Field(min_length=1)
    segments: List[TranscriptSegmentUpdate] = Field(min_length=1, max_length=1000)


class TranscriptChapterCreate(BaseModel):
    expected_revision_id: int = Field(gt=0)
    title: str = Field(min_length=1, max_length=200)
    start_seconds: float = Field(ge=0, allow_inf_nan=False)
    end_seconds: float = Field(gt=0, allow_inf_nan=False)


class TranscriptChapterUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    start_seconds: Optional[float] = Field(
        default=None,
        ge=0,
        allow_inf_nan=False,
    )
    end_seconds: Optional[float] = Field(
        default=None,
        gt=0,
        allow_inf_nan=False,
    )


class TranscriptChapterMerge(BaseModel):
    chapter_ids: List[int] = Field(min_length=2, max_length=100)
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)


class TranscriptIssueUpdate(BaseModel):
    status: Literal["open", "resolved", "dismissed"]
    closed_reason: Optional[str] = Field(default=None, max_length=500)


class SettingUpdate(BaseModel):
    key: str
    value: str


class SettingsSectionUpdate(BaseModel):
    values: dict[str, str] = Field(min_length=1, max_length=32)


class DatabaseBackupCreate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=80)


class ApplicationUpdatePrepare(BaseModel):
    target_version: str = Field(
        min_length=1,
        max_length=64,
        pattern=r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$",
    )


SavedViewBaseMode = Literal[
    "library",
    "favorites",
    "missingDescription",
    "transcribed",
    "missing",
    "aiFailed",
]


class SavedViewQuery(BaseModel):
    schema_version: Literal[1] = 1
    view: SavedViewBaseMode = "library"
    q: str = Field(default="", max_length=500)
    tag_id: Optional[int] = Field(default=None, gt=0)
    tag_ids: List[int] = Field(default_factory=list, max_length=50)
    excluded_tag_ids: List[int] = Field(default_factory=list, max_length=50)
    tag_mode: Literal["and", "or"] = "and"
    library_root_id: Optional[int] = Field(default=None, gt=0)
    transcript_filter: Literal["all", "yes", "no"] = "all"
    missing_filter: Literal["all", "available", "missing", "aiFailed"] = "all"
    sort: AudioSortMode = "default"
    display_mode: Literal["list"] = "list"


class SavedViewCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    query: SavedViewQuery


class SavedViewUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    query: Optional[SavedViewQuery] = None

    @model_validator(mode="after")
    def require_change(self):
        if self.name is None and self.query is None:
            raise ValueError("name or query is required")
        return self


class SavedViewCopy(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)


class SavedViewsReorder(BaseModel):
    view_ids: List[int] = Field(max_length=200)


class SmartPlaylistCreate(BaseModel):
    saved_view_id: int = Field(gt=0)
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    description: Optional[str] = Field(default=None, max_length=500)


class LLMConfig(BaseModel):
    endpoint: str
    model_name: str
    api_key: Optional[str] = None
    timeout: int = Field(default=60, ge=1, le=3600)
    max_tokens: Optional[int] = Field(default=800, gt=0)
    temperature: Optional[float] = Field(
        default=0.2,
        ge=0,
        le=2,
        allow_inf_nan=False,
    )


class LLMModelDiscoveryConfig(BaseModel):
    endpoint: str
    api_key: Optional[str] = None
    timeout: int = Field(default=60, ge=1, le=3600)


class BatchAudioRequest(BaseModel):
    audio_ids: List[Annotated[int, Field(gt=0)]] = Field(
        min_length=1,
        max_length=500,
    )


AgentScopeKind = Literal[
    "library",
    "audio",
    "selection",
    "playlist",
    "saved_view",
    "tag",
    "library_root",
]


class AgentScope(BaseModel):
    kind: AgentScopeKind = "library"
    audio_id: Optional[int] = Field(default=None, gt=0)
    audio_ids: List[int] = Field(default_factory=list, max_length=500)
    playlist_id: Optional[int] = Field(default=None, gt=0)
    saved_view_id: Optional[int] = Field(default=None, gt=0)
    tag_id: Optional[int] = Field(default=None, gt=0)
    library_root_id: Optional[int] = Field(default=None, gt=0)

    @model_validator(mode="after")
    def validate_scope_reference(self):
        expected = {
            "audio": self.audio_id,
            "selection": self.audio_ids,
            "playlist": self.playlist_id,
            "saved_view": self.saved_view_id,
            "tag": self.tag_id,
            "library_root": self.library_root_id,
        }
        if self.kind != "library" and not expected[self.kind]:
            raise ValueError(f"{self.kind} scope reference is required")
        return self


class SegmentSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    scope: AgentScope = Field(default_factory=AgentScope)
    limit: int = Field(default=20, ge=1, le=100)
    mode: Literal["auto", "fts", "hybrid"] = "auto"


class AgentConversationCreate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=80)
    scope: AgentScope = Field(default_factory=AgentScope)


class AgentConversationUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=80)
    scope: Optional[AgentScope] = None

    @model_validator(mode="after")
    def require_conversation_change(self):
        if self.title is None and self.scope is None:
            raise ValueError("title or scope is required")
        return self


class AgentRunCreate(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


class AgentOperationApproval(BaseModel):
    fingerprint: str = Field(min_length=64, max_length=64, pattern=r"^[0-9a-f]{64}$")


class ArchiveImportExecute(BaseModel):
    archive_id: str = Field(min_length=1, max_length=120, pattern=r"^[A-Za-z0-9._-]+$")
    fingerprint: str = Field(min_length=64, max_length=64, pattern=r"^[0-9a-f]{64}$")


class OrganizationRunOptions(BaseModel):
    transcribe_missing: bool = False
    generate_corrections: bool = True
    generate_tags: bool = True
    generate_description: bool = True
    generate_chapters: bool = True


class OrganizationRunCreate(BaseModel):
    scope: AgentScope = Field(default_factory=AgentScope)
    options: OrganizationRunOptions = Field(default_factory=OrganizationRunOptions)


class OrganizationProposalDecision(BaseModel):
    decision: Literal["accepted", "rejected", "skipped"]
    edited_value: Optional[Any] = None
    note: Optional[str] = Field(default=None, max_length=500)


class OrganizationRunApply(BaseModel):
    categories: List[Literal["correction", "tag", "description", "chapter"]] = Field(
        default_factory=lambda: ["correction", "tag", "description", "chapter"],
        min_length=1,
    )



BatchOrganizationAction = Literal[
    "add_tags",
    "remove_tags",
    "add_to_playlist",
    "set_favorite",
]


class BatchOrganizationRequest(BaseModel):
    audio_ids: List[int] = Field(min_length=1, max_length=500)
    action: BatchOrganizationAction
    tag_names: List[str] = Field(default_factory=list, max_length=50)
    tag_ids: List[int] = Field(default_factory=list, max_length=50)
    playlist_id: Optional[int] = None
    is_favorite: Optional[bool] = None

    @model_validator(mode="after")
    def validate_action_payload(self):
        if self.action == "add_tags" and not any(name.strip() for name in self.tag_names):
            raise ValueError("tag_names is required for add_tags")

        if self.action == "remove_tags" and not self.tag_ids:
            raise ValueError("tag_ids is required for remove_tags")

        if self.action == "add_to_playlist" and self.playlist_id is None:
            raise ValueError("playlist_id is required for add_to_playlist")

        if self.action == "set_favorite" and self.is_favorite is None:
            raise ValueError("is_favorite is required for set_favorite")

        return self


class ApiResponse(BaseModel):
    data: Any = None
    error: Optional[dict] = None
