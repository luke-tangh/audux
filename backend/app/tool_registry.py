from dataclasses import dataclass
from typing import Any, Callable, Literal

from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlmodel import Session, select

from .providers import LLMCapabilities
from .models import AudioItem, AudioTag, Playlist, Tag, Transcript
from .schemas import AgentScope
from .services.common import ServiceError
from .services.retrieval_service import search_segments
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
    return search_segments(
        context.session,
        args.query,
        AgentScope.model_construct(
            kind="selection",
            audio_ids=sorted(context.allowed_audio_ids),
        ),
        limit=args.limit,
        mode="auto",
    )


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
        "description": audio.description_user or audio.description_ai or audio.description_original or "",
        "duration_seconds": audio.duration_seconds,
        "language": audio.language,
        "tags": [tag.name for tag in tags],
        "revision_id": transcript.id if transcript else None,
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
    return registry


DEFAULT_TOOL_REGISTRY = build_default_tool_registry()
