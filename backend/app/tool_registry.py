from dataclasses import dataclass
from typing import Any, Callable, Literal

from pydantic import BaseModel, Field
from sqlmodel import Session

from .providers import LLMCapabilities
from .services.common import ServiceError
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


def build_default_tool_registry() -> ToolRegistry:
    registry = ToolRegistry()
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
    return registry


DEFAULT_TOOL_REGISTRY = build_default_tool_registry()
