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
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class PlaylistItem(SQLModel, table=True):
    __tablename__ = "playlist_items"

    id: Optional[int] = Field(default=None, primary_key=True)
    playlist_id: int = Field(foreign_key="playlists.id", index=True)
    audio_id: int = Field(foreign_key="audio_items.id", index=True)
    order_index: int
    created_at: str = Field(default_factory=now_iso)


class Transcript(SQLModel, table=True):
    __tablename__ = "transcripts"

    id: Optional[int] = Field(default=None, primary_key=True)
    audio_id: int = Field(foreign_key="audio_items.id", unique=True, index=True)
    language: Optional[str] = None
    full_text: str
    model_name: Optional[str] = None
    status: str = "done"
    generated_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class TranscriptSegment(SQLModel, table=True):
    __tablename__ = "transcript_segments"

    id: Optional[int] = Field(default=None, primary_key=True)
    transcript_id: int = Field(foreign_key="transcripts.id", index=True)
    segment_index: int
    start_seconds: float
    end_seconds: float
    text: str


class AITask(SQLModel, table=True):
    __tablename__ = "ai_tasks"

    id: Optional[int] = Field(default=None, primary_key=True)
    audio_id: int = Field(foreign_key="audio_items.id", index=True)
    task_type: str
    status: str = "pending"
    input_payload: Optional[str] = None
    output_payload: Optional[str] = None
    error_message: Optional[str] = None
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

    created_at: str = Field(default_factory=now_iso)
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    updated_at: str = Field(default_factory=now_iso)
