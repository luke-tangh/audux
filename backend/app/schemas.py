from typing import Any, List, Literal, Optional
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
    last_position_seconds: float


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
    segment_index: int
    start_seconds: float
    end_seconds: float
    text: str


class TranscriptCreate(BaseModel):
    language: Optional[str] = None
    full_text: str
    model_name: Optional[str] = None
    segments: List[TranscriptSegmentCreate] = Field(default_factory=list)


class TranscriptUpdate(BaseModel):
    full_text: str
    expected_updated_at: str = Field(min_length=1)


class TranscriptSegmentUpdate(BaseModel):
    id: int = Field(gt=0)
    text: str


class TranscriptSegmentsUpdate(BaseModel):
    expected_updated_at: str = Field(min_length=1)
    segments: List[TranscriptSegmentUpdate] = Field(min_length=1, max_length=1000)


class SettingUpdate(BaseModel):
    key: str
    value: str


class DatabaseBackupCreate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=80)


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
    timeout: int = 60
    max_tokens: Optional[int] = 800
    temperature: Optional[float] = 0.2


class BatchAudioRequest(BaseModel):
    audio_ids: List[int]


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
