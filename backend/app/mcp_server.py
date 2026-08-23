from __future__ import annotations

import json
import os
import sys
from typing import Any, TextIO

from sqlmodel import Session

from . import db
from .providers import LLMCapabilities
from .models import McpAuditEvent
from .schemas import AgentScope
from .services.common import ServiceError
from .services.retrieval_service import resolve_scope
from .tool_registry import DEFAULT_TOOL_REGISTRY, ToolContext
from .version import APP_VERSION


MCP_PROTOCOL_VERSION = "2025-06-18"
SUPPORTED_PROTOCOL_VERSIONS = {MCP_PROTOCOL_VERSION, "2024-11-05"}
MAX_REQUEST_CHARACTERS = 256 * 1024


def _configured_audio_ids() -> frozenset[int] | None:
    raw = os.getenv("AUDUX_MCP_AUDIO_IDS", "").strip()
    if not raw:
        return None
    try:
        values = frozenset(int(value.strip()) for value in raw.split(",") if value.strip())
    except ValueError as error:
        raise RuntimeError("AUDUX_MCP_AUDIO_IDS must be a comma-separated list of positive integers") from error
    if not values or any(value <= 0 for value in values) or len(values) > 500:
        raise RuntimeError("AUDUX_MCP_AUDIO_IDS must contain 1-500 positive integers")
    return values


class AuduxMcpServer:
    def __init__(self, session: Session, allowed_audio_ids: frozenset[int]):
        self.session = session
        self.allowed_audio_ids = allowed_audio_ids
        self.initialized = False

    def _result(self, request_id: Any, result: Any) -> dict[str, Any]:
        return {"jsonrpc": "2.0", "id": request_id, "result": result}

    def _error(self, request_id: Any, code: int, message: str, data: Any = None) -> dict[str, Any]:
        error: dict[str, Any] = {"code": code, "message": message}
        if data is not None:
            error["data"] = data
        return {"jsonrpc": "2.0", "id": request_id, "error": error}

    def _audit(self, name: str, arguments: dict[str, Any], status: str, error_code: str | None = None) -> None:
        self.session.add(
            McpAuditEvent(
                tool_name=name,
                status=status,
                arguments_json=json.dumps(arguments, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
                scope_audio_count=len(self.allowed_audio_ids),
                error_code=error_code,
            )
        )
        self.session.commit()

    def dispatch(self, request: dict[str, Any]) -> dict[str, Any] | None:
        request_id = request.get("id")
        method = request.get("method")
        if request.get("jsonrpc") != "2.0" or not isinstance(method, str):
            return self._error(request_id, -32600, "Invalid Request")
        if request_id is None:
            if method == "notifications/initialized":
                self.initialized = True
            return None
        params = request.get("params") or {}
        if not isinstance(params, dict):
            return self._error(request_id, -32602, "Invalid params")
        try:
            if method == "initialize":
                requested = str(params.get("protocolVersion") or MCP_PROTOCOL_VERSION)
                protocol = requested if requested in SUPPORTED_PROTOCOL_VERSIONS else MCP_PROTOCOL_VERSION
                return self._result(
                    request_id,
                    {
                        "protocolVersion": protocol,
                        "capabilities": {"tools": {"listChanged": False}},
                        "serverInfo": {"name": "audux", "version": APP_VERSION},
                        "instructions": "Read-only access to a server-frozen Audux library scope. Tool outputs never include credentials or absolute file paths.",
                    },
                )
            if method == "ping":
                return self._result(request_id, {})
            if method == "tools/list":
                tools = [schema["function"] for schema in DEFAULT_TOOL_REGISTRY.schemas(maximum_permission="read")]
                return self._result(request_id, {"tools": [{"name": row["name"], "description": row["description"], "inputSchema": row["parameters"]} for row in tools]})
            if method == "tools/call":
                name = params.get("name")
                arguments = params.get("arguments") or {}
                if not isinstance(name, str) or not isinstance(arguments, dict):
                    return self._error(request_id, -32602, "Invalid tool call")
                output = DEFAULT_TOOL_REGISTRY.execute(
                    name,
                    arguments,
                    ToolContext(
                        session=self.session,
                        allowed_audio_ids=self.allowed_audio_ids,
                        session_id="mcp-stdio",
                        permission="read",
                    ),
                    capabilities=LLMCapabilities(tool_calling=True),
                )
                self._audit(name, arguments, "done")
                return self._result(
                    request_id,
                    {
                        "content": [{"type": "text", "text": json.dumps(output, ensure_ascii=False)}],
                        "structuredContent": output,
                        "isError": False,
                    },
                )
            return self._error(request_id, -32601, "Method not found")
        except ServiceError as error:
            if method == "tools/call":
                attempted_name = str(params.get("name") or "invalid")[:100]
                attempted_arguments = params.get("arguments") if isinstance(params.get("arguments"), dict) else {}
                self._audit(attempted_name, attempted_arguments, "failed", error.code)
            return self._result(
                request_id,
                {
                    "content": [{"type": "text", "text": error.detail}],
                    "structuredContent": {"code": error.code, "params": error.params},
                    "isError": True,
                },
            )
        except Exception:
            if method == "tools/call":
                attempted_name = str(params.get("name") or "invalid")[:100]
                attempted_arguments = params.get("arguments") if isinstance(params.get("arguments"), dict) else {}
                try:
                    self._audit(attempted_name, attempted_arguments, "failed", "mcp.internal_error")
                except Exception:
                    self.session.rollback()
            # Never serialize exception details: they may include local paths or
            # provider configuration.
            return self._error(request_id, -32603, "Internal error")


def serve_stdio(input_stream: TextIO = sys.stdin, output_stream: TextIO = sys.stdout) -> None:
    db.create_db_and_tables()
    with Session(db.engine) as session:
        library_ids = resolve_scope(session, AgentScope(kind="library")).audio_ids
        configured = _configured_audio_ids()
        allowed = library_ids if configured is None else library_ids.intersection(configured)
        server = AuduxMcpServer(session, allowed)
        for line in input_stream:
            if len(line) > MAX_REQUEST_CHARACTERS:
                response = server._error(None, -32600, "Request too large")
            else:
                try:
                    request = json.loads(line)
                    response = server.dispatch(request) if isinstance(request, dict) else server._error(None, -32600, "Invalid Request")
                except json.JSONDecodeError:
                    response = server._error(None, -32700, "Parse error")
            if response is not None:
                output_stream.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n")
                output_stream.flush()
