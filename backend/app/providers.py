from dataclasses import dataclass
from typing import Any, AsyncIterator, Protocol, runtime_checkable


@dataclass(frozen=True)
class LLMCapabilities:
    structured_output: bool = False
    tool_calling: bool = False
    streaming_tool_calling: bool = False

    @property
    def agent_execution(self) -> bool:
        return self.tool_calling


@runtime_checkable
class ASRProvider(Protocol):
    name: str

    async def transcribe(
        self,
        audio_path: str,
        *,
        config: dict[str, Any],
    ) -> dict[str, Any]: ...


@runtime_checkable
class LLMProvider(Protocol):
    name: str
    capabilities: LLMCapabilities

    async def complete(
        self,
        messages: list[dict[str, Any]],
        *,
        tools: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]: ...

    async def stream(
        self,
        messages: list[dict[str, Any]],
        *,
        tools: list[dict[str, Any]] | None = None,
    ) -> AsyncIterator[dict[str, Any]]: ...


@runtime_checkable
class EmbeddingProvider(Protocol):
    name: str
    dimensions: int

    async def embed(self, texts: list[str]) -> list[list[float]]: ...
