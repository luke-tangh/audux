from dataclasses import dataclass
from typing import Any, Callable, Literal

from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func
from sqlmodel import Session, select

from .providers import LLMCapabilities
from .models import AudioItem, AudioTag, Playlist, PlaylistItem, Tag, Transcript
from .schemas import AgentScope, AudioUpdate, SavedViewQuery
from .services.errors import ServiceError
from .services.retrieval_service import search_segments
from .services.retrieval_service import resolve_scope
from .services.transcript_service import get_transcript


ToolPermission = Literal["read", "propose", "execute", "restricted"]
_PERMISSION_RANK: dict[ToolPermission, int] = {
    "read": 0,
    "propose": 1,
    "execute": 2,
    "restricted": 3,
}
_FORBIDDEN_ARGUMENT_NAMES = {
    "path",
    "root",
    "library_root",
    "api_key",
    "token",
    "endpoint",
    "command",
    "shell",
}


@dataclass(frozen=True)
class ToolContext:
    session: Session
    allowed_audio_ids: frozenset[int]
    session_id: str
    permission: ToolPermission = "read"

    def require_audio(self, audio_id: int) -> None:
        if audio_id not in self.allowed_audio_ids:
            raise ServiceError(403, "Audio is outside the active Agent scope")


class GetTranscriptSegmentArgs(BaseModel):
    audio_id: int = Field(gt=0)
    segment_id: int = Field(gt=0)


class ListTranscriptIssuesArgs(BaseModel):
    audio_id: int = Field(gt=0)


class SearchScopeArgs(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    limit: int = Field(default=10, ge=1, le=40)


class GetAudioDetailsArgs(BaseModel):
    audio_id: int = Field(gt=0)


class EmptyArgs(BaseModel):
    pass


class ListAudioArgs(BaseModel):
    limit: int = Field(default=50, ge=1, le=100)


class GetTranscriptArgs(BaseModel):
    audio_id: int = Field(gt=0)
    segment_limit: int = Field(default=100, ge=1, le=200)


class GetPlaylistArgs(BaseModel):
    playlist_id: int = Field(gt=0)
    limit: int = Field(default=100, ge=1, le=200)


class ProposeMetadataArgs(AudioUpdate):
    audio_id: int = Field(gt=0)

    @model_validator(mode="after")
    def require_change(self):
        if not self.model_dump(exclude={"audio_id"}, exclude_unset=True):
            raise ValueError("At least one metadata change is required")
        return self


class ProposeTagsArgs(BaseModel):
    audio_ids: list[int] = Field(min_length=1, max_length=100)
    tag_names: list[str] = Field(min_length=1, max_length=20)


class ProposePlaylistArgs(BaseModel):
    audio_ids: list[int] = Field(min_length=1, max_length=100)
    playlist_id: int = Field(gt=0)


class ProposeSavedViewArgs(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    query: SavedViewQuery


class ProposeTranscriptionArgs(BaseModel):
    audio_ids: list[int] = Field(min_length=1, max_length=100)


ToolHandler = Callable[[ToolContext, BaseModel], dict[str, Any]]


@dataclass(frozen=True)
class RegisteredTool:
    name: str
    description: str
    permission: ToolPermission
    input_model: type[BaseModel]
    handler: ToolHandler


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, RegisteredTool] = {}

    def register(self, tool: RegisteredTool) -> None:
        schema = tool.input_model.model_json_schema()

        def property_names(value: Any) -> set[str]:
            names: set[str] = set()
            if isinstance(value, dict):
                properties = value.get("properties")
                if isinstance(properties, dict):
                    names.update(str(name) for name in properties)
                for child in value.values():
                    names.update(property_names(child))
            elif isinstance(value, list):
                for child in value:
                    names.update(property_names(child))
            return names

        forbidden = _FORBIDDEN_ARGUMENT_NAMES.intersection(property_names(schema))
        if forbidden:
            raise ValueError(
                f"Tool {tool.name} exposes forbidden scope or secret arguments: "
                f"{', '.join(sorted(forbidden))}"
            )
        if tool.name in self._tools:
            raise ValueError(f"Tool already registered: {tool.name}")
        self._tools[tool.name] = tool

    def schemas(self, *, maximum_permission: ToolPermission = "read") -> list[dict]:
        return [
            {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.input_model.model_json_schema(),
                },
            }
            for tool in self._tools.values()
            if _PERMISSION_RANK[tool.permission] <= _PERMISSION_RANK[maximum_permission]
        ]

    def execute(
        self,
        name: str,
        arguments: dict[str, Any],
        context: ToolContext,
        *,
        capabilities: LLMCapabilities,
    ) -> dict[str, Any]:
        if not capabilities.tool_calling:
            raise ServiceError(
                409,
                "The configured model does not support tool calling",
                "agent.tool_calling_unsupported",
            )
        tool = self._tools.get(name)
        if not tool:
            raise ServiceError(404, "Agent tool not found")
        if _PERMISSION_RANK[tool.permission] > _PERMISSION_RANK[context.permission]:
            raise ServiceError(403, "Agent tool permission denied")
        validated = tool.input_model.model_validate(arguments)
        return tool.handler(context, validated)


def _get_transcript_segment(context: ToolContext, payload: BaseModel) -> dict[str, Any]:
    args = GetTranscriptSegmentArgs.model_validate(payload)
    context.require_audio(args.audio_id)
    transcript = get_transcript(context.session, args.audio_id)
    segment = next(
        (row for row in transcript["segments"] if row["id"] == args.segment_id),
        None,
    )
    if segment is None:
        raise ServiceError(404, "Current transcript segment not found")
    revision = transcript["transcript"]
    return {
        "audio_id": args.audio_id,
        "revision_id": revision["id"],
        "segment_id": segment["id"],
        "start_seconds": segment["start_seconds"],
        "end_seconds": segment["end_seconds"],
        "text": segment["text"],
    }


def _list_transcript_issues(context: ToolContext, payload: BaseModel) -> dict[str, Any]:
    args = ListTranscriptIssuesArgs.model_validate(payload)
    context.require_audio(args.audio_id)
    transcript = get_transcript(context.session, args.audio_id)
    return {
        "audio_id": args.audio_id,
        "revision_id": transcript["transcript"]["id"],
        "issues": transcript["issues"],
    }


def _search_scope(context: ToolContext, payload: BaseModel) -> dict[str, Any]:
    args = SearchScopeArgs.model_validate(payload)
    result = search_segments(
        context.session,
        args.query,
        AgentScope.model_construct(
            kind="selection",
            audio_ids=sorted(context.allowed_audio_ids),
        ),
        limit=args.limit,
        mode="auto",
    )
    remaining = 24000
    bounded_items = []
    for row in result["items"]:
        if remaining <= 0:
            break
        text_value = str(row.get("text") or "")[:remaining]
        bounded_items.append({
            **row,
            "text": text_value,
            "citation_id": (
                f"transcript:{row['revision_id']}:segment:{row['segment_id']}"
                if row.get("revision_id") and row.get("segment_id")
                else f"audio:{row['audio_id']}"
            ),
        })
        remaining -= len(text_value)
    result["items"] = bounded_items
    return result


def _get_audio_details(context: ToolContext, payload: BaseModel) -> dict[str, Any]:
    args = GetAudioDetailsArgs.model_validate(payload)
    context.require_audio(args.audio_id)
    audio = context.session.get(AudioItem, args.audio_id)
    if not audio:
        raise ServiceError(404, "Audio not found")
    tags = context.session.exec(
        select(Tag)
        .join(AudioTag, AudioTag.tag_id == Tag.id)
        .where(AudioTag.audio_id == args.audio_id)
        .order_by(Tag.name)
    ).all()
    transcript = context.session.exec(
        select(Transcript)
        .where(Transcript.audio_id == args.audio_id)
        .where(Transcript.is_current.is_(True))
    ).first()
    return {
        "audio_id": args.audio_id,
        "title": audio.title_user or audio.title_original or audio.file_name,
        "author": audio.author_user or audio.author_original or "",
        "description": (audio.description_user or audio.description_ai or audio.description_original or "")[:4000],
        "duration_seconds": audio.duration_seconds,
        "language": audio.language,
        "tags": [tag.name for tag in tags],
        "revision_id": transcript.id if transcript else None,
        "citation_id": f"audio:{args.audio_id}",
    }


def _list_scope_tags(context: ToolContext, payload: BaseModel) -> dict[str, Any]:
    EmptyArgs.model_validate(payload)
    if not context.allowed_audio_ids:
        return {"tags": []}
    rows = context.session.exec(
        select(Tag.id, Tag.name, func.count(AudioTag.audio_id))
        .join(AudioTag, AudioTag.tag_id == Tag.id)
        .where(AudioTag.audio_id.in_(context.allowed_audio_ids))
        .group_by(Tag.id, Tag.name)
        .order_by(func.count(AudioTag.audio_id).desc(), Tag.name)
    ).all()
    return {"tags": [{"id": row[0], "name": row[1], "count": row[2]} for row in rows]}


def _list_playlists(context: ToolContext, payload: BaseModel) -> dict[str, Any]:
    EmptyArgs.model_validate(payload)
    rows = context.session.exec(select(Playlist).order_by(Playlist.name)).all()
    return {"playlists": [{"id": row.id, "name": row.name, "kind": row.kind} for row in rows]}


def _scope_statistics(context: ToolContext, payload: BaseModel) -> dict[str, Any]:
    EmptyArgs.model_validate(payload)
    if not context.allowed_audio_ids:
        return {"audio_count": 0, "duration_seconds": 0, "transcribed_count": 0}
    rows = context.session.exec(
        select(AudioItem).where(AudioItem.id.in_(context.allowed_audio_ids))
    ).all()
    return {
        "audio_count": len(rows),
        "duration_seconds": sum(row.duration_seconds or 0 for row in rows),
        "transcribed_count": sum(row.transcript_status == "done" for row in rows),
    }


def _list_audio(context: ToolContext, payload: BaseModel) -> dict[str, Any]:
    args = ListAudioArgs.model_validate(payload)
    if not context.allowed_audio_ids:
        return {"items": []}
    rows = context.session.exec(
        select(AudioItem)
        .where(AudioItem.id.in_(context.allowed_audio_ids))
        .order_by(AudioItem.id)
        .limit(args.limit)
    ).all()
    return {
        "items": [
            {
                "audio_id": row.id,
                "title": (row.title_user or row.title_original or row.file_name)[:500],
                "author": (row.author_user or row.author_original or "")[:500],
                "duration_seconds": row.duration_seconds,
                "transcript_status": row.transcript_status,
                "citation_id": f"audio:{row.id}",
            }
            for row in rows
        ]
    }


def _get_transcript(context: ToolContext, payload: BaseModel) -> dict[str, Any]:
    args = GetTranscriptArgs.model_validate(payload)
    context.require_audio(args.audio_id)
    value = get_transcript(context.session, args.audio_id)
    revision = value["transcript"]
    segments = []
    remaining = 24000
    for row in value["segments"][: args.segment_limit]:
        if remaining <= 0:
            break
        text_value = str(row["text"])[:remaining]
        segments.append({**row, "text": text_value})
        remaining -= len(text_value)
    return {
        "audio_id": args.audio_id,
        "revision_id": revision["id"],
        "language": revision.get("language"),
        "segments": [
            {
                "segment_id": row["id"],
                "start_seconds": row["start_seconds"],
                "end_seconds": row["end_seconds"],
                "text": row["text"],
                "citation_id": f"transcript:{revision['id']}:segment:{row['id']}",
            }
            for row in segments
        ],
        "truncated": len(value["segments"]) > len(segments),
    }


def _get_playlist(context: ToolContext, payload: BaseModel) -> dict[str, Any]:
    args = GetPlaylistArgs.model_validate(payload)
    playlist = context.session.get(Playlist, args.playlist_id)
    if not playlist:
        raise ServiceError(404, "Playlist not found")
    if playlist.kind != "manual":
        playlist_scope = resolve_scope(
            context.session,
            AgentScope(kind="playlist", playlist_id=int(playlist.id)),
        )
        audio_ids = sorted(playlist_scope.audio_ids.intersection(context.allowed_audio_ids))[: args.limit]
        return {
            "playlist_id": playlist.id,
            "name": playlist.name,
            "kind": playlist.kind,
            "audio_ids": audio_ids,
            "citation_id": f"playlist:{playlist.id}",
        }
    rows = context.session.exec(
        select(PlaylistItem)
        .where(PlaylistItem.playlist_id == args.playlist_id)
        .where(PlaylistItem.audio_id.in_(context.allowed_audio_ids))
        .order_by(PlaylistItem.order_index)
        .limit(args.limit)
    ).all()
    return {
        "playlist_id": playlist.id,
        "name": playlist.name,
        "kind": playlist.kind,
        "audio_ids": [row.audio_id for row in rows],
        "citation_id": f"playlist:{playlist.id}",
    }


def _proposal(context: ToolContext, payload: BaseModel, tool_name: str) -> dict[str, Any]:
    value = payload.model_dump(exclude_unset=True)
    audio_ids = value.get("audio_ids") or ([value["audio_id"]] if value.get("audio_id") else [])
    for audio_id in dict.fromkeys(audio_ids):
        context.require_audio(int(audio_id))
    return {"proposal": {"tool_name": tool_name, "arguments": value}}


def build_default_tool_registry() -> ToolRegistry:
    registry = ToolRegistry()
    registry.register(
        RegisteredTool(
            name="search_scope",
            description="Search metadata and current transcript segments only inside the server-provided Agent scope.",
            permission="read",
            input_model=SearchScopeArgs,
            handler=_search_scope,
        )
    )
    registry.register(
        RegisteredTool(
            name="get_audio_details",
            description="Read metadata for one audio item inside the active scope.",
            permission="read",
            input_model=GetAudioDetailsArgs,
            handler=_get_audio_details,
        )
    )
    registry.register(
        RegisteredTool(
            name="get_transcript_segment",
            description="Read one current transcript segment and its playable evidence anchor.",
            permission="read",
            input_model=GetTranscriptSegmentArgs,
            handler=_get_transcript_segment,
        )
    )
    registry.register(
        RegisteredTool(
            name="list_transcript_issues",
            description="List deterministic quality issues for a current transcript revision.",
            permission="read",
            input_model=ListTranscriptIssuesArgs,
            handler=_list_transcript_issues,
        )
    )
    registry.register(
        RegisteredTool("list_scope_tags", "List tags used by audio in the active scope.", "read", EmptyArgs, _list_scope_tags)
    )
    registry.register(
        RegisteredTool("list_playlists", "List playlist names and kinds without reading out-of-scope audio.", "read", EmptyArgs, _list_playlists)
    )
    registry.register(
        RegisteredTool("scope_statistics", "Summarize counts and duration inside the active scope.", "read", EmptyArgs, _scope_statistics)
    )
    registry.register(RegisteredTool("list_audio", "List bounded audio summaries in the active scope.", "read", ListAudioArgs, _list_audio))
    registry.register(RegisteredTool("get_transcript", "Read bounded current transcript segments with stable citation ids.", "read", GetTranscriptArgs, _get_transcript))
    registry.register(RegisteredTool("get_playlist", "Read in-scope members of one playlist.", "read", GetPlaylistArgs, _get_playlist))
    registry.register(RegisteredTool("propose_update_metadata", "Propose low-risk user metadata changes. This never writes until desktop approval.", "propose", ProposeMetadataArgs, lambda c, p: _proposal(c, p, "update_metadata")))
    registry.register(RegisteredTool("propose_accept_tags", "Propose adding tags to frozen in-scope audio ids. This never writes until desktop approval.", "propose", ProposeTagsArgs, lambda c, p: _proposal(c, p, "accept_tags")))
    registry.register(RegisteredTool("propose_add_to_playlist", "Propose adding frozen in-scope audio ids to an existing manual playlist.", "propose", ProposePlaylistArgs, lambda c, p: _proposal(c, p, "add_to_playlist")))
    registry.register(RegisteredTool("propose_create_saved_view", "Propose creating a saved view from a fully visible query.", "propose", ProposeSavedViewArgs, lambda c, p: _proposal(c, p, "create_saved_view")))
    registry.register(RegisteredTool("propose_queue_transcription", "Propose queuing transcription for frozen in-scope audio ids.", "propose", ProposeTranscriptionArgs, lambda c, p: _proposal(c, p, "queue_transcription")))
    return registry


DEFAULT_TOOL_REGISTRY = build_default_tool_registry()
