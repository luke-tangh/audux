from typing import Optional, List, Any
from pydantic import BaseModel


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


class TagsAddRequest(BaseModel):
    tags: List[str]
    source: str = "user"


class PlaylistCreate(BaseModel):
    name: str
    description: Optional[str] = None


class PlaylistItemAdd(BaseModel):
    audio_id: int


class TranscriptSegmentCreate(BaseModel):
    segment_index: int
    start_seconds: float
    end_seconds: float
    text: str


class TranscriptCreate(BaseModel):
    language: Optional[str] = None
    full_text: str
    model_name: Optional[str] = None
    segments: List[TranscriptSegmentCreate] = []


class SettingUpdate(BaseModel):
    key: str
    value: str


class LLMConfig(BaseModel):
    endpoint: str
    model_name: str
    api_key: Optional[str] = None
    timeout: int = 60
    max_tokens: Optional[int] = 800
    temperature: Optional[float] = 0.2


class ApiResponse(BaseModel):
    data: Any = None
    error: Optional[dict] = None
