import pytest
from pydantic import BaseModel

from app.providers import LLMCapabilities
from app.services.common import ServiceError
from app.tool_registry import RegisteredTool, ToolContext, ToolRegistry


class UnsafeArgs(BaseModel):
    root: str


class SafeArgs(BaseModel):
    audio_id: int


class NestedUnsafe(BaseModel):
    endpoint: str


class NestedUnsafeArgs(BaseModel):
    options: NestedUnsafe


def test_registry_rejects_model_controlled_scope_roots():
    registry = ToolRegistry()
    with pytest.raises(ValueError, match="forbidden"):
        registry.register(
            RegisteredTool("unsafe", "unsafe", "read", UnsafeArgs, lambda context, args: {})
        )
    with pytest.raises(ValueError, match="endpoint"):
        registry.register(
            RegisteredTool(
                "nested_unsafe",
                "nested unsafe",
                "read",
                NestedUnsafeArgs,
                lambda context, args: {},
            )
        )


def test_registry_never_executes_without_tool_calling_capability():
    registry = ToolRegistry()
    registry.register(
        RegisteredTool("safe", "safe", "read", SafeArgs, lambda context, args: {"ok": True})
    )
    context = ToolContext(
        session=object(),  # type: ignore[arg-type]
        allowed_audio_ids=frozenset({1}),
        session_id="test",
    )
    with pytest.raises(ServiceError) as captured:
        registry.execute(
            "safe",
            {"audio_id": 1},
            context,
            capabilities=LLMCapabilities(tool_calling=False),
        )
    assert captured.value.code == "agent.tool_calling_unsupported"
