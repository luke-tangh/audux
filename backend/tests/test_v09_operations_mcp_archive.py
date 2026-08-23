import asyncio
import json
import os
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest
from sqlmodel import SQLModel, Session, create_engine, select

from app import agent_tasks, db
from app.mcp_server import AuduxMcpServer
from app.models import (
    AgentConversation,
    AgentMessage,
    AgentOperationAuditEvent,
    AgentRun,
    AudioItem,
    AudioTag,
    Playlist,
    PlaylistItem,
    McpAuditEvent,
    Tag,
)
from app.services import agent_operation_service, archive_service
from app.services.errors import ServiceError
from app.providers import LLMCapabilities
from tests.api_test_support import ApiIntegrationTest


class TestV09OperationsMcpArchive(ApiIntegrationTest):
    def _run(self, session: Session, audio_ids: list[int]) -> AgentRun:
        conversation = AgentConversation(title="write", scope_json=json.dumps({"kind": "selection", "audio_ids": audio_ids}))
        session.add(conversation)
        session.flush()
        message = AgentMessage(conversation_id=int(conversation.id), role="user", content="organize")
        session.add(message)
        session.flush()
        run = AgentRun(
            conversation_id=int(conversation.id),
            user_message_id=int(message.id),
            status="done",
            scope_json=conversation.scope_json,
            allowed_audio_ids_json=json.dumps(audio_ids),
        )
        session.add(run)
        session.commit()
        session.refresh(run)
        return run

    def test_operation_plan_is_frozen_atomic_and_one_time(self):
        root = self.add_library_root(self.root_path / "library")
        first = self.add_audio(self.root_path / "library" / "one.mp3", root_id=root.id)
        second = self.add_audio(self.root_path / "library" / "two.mp3", root_id=root.id)
        with Session(self.engine) as session:
            playlist = Playlist(name="Review")
            session.add(playlist)
            session.commit()
            session.refresh(playlist)
            run = self._run(session, [int(first.id), int(second.id)])
            plan = agent_operation_service.create_plan_from_proposals(
                session,
                int(run.id),
                [
                    {"tool_name": "update_metadata", "arguments": {"audio_id": first.id, "title_user": "New title"}},
                    {"tool_name": "accept_tags", "arguments": {"audio_ids": [first.id, second.id], "tag_names": ["Keep"]}},
                    {"tool_name": "add_to_playlist", "arguments": {"audio_ids": [first.id], "playlist_id": playlist.id}},
                ],
            )
            assert plan["status"] == "awaiting_approval"
            assert plan["target_audio_ids"] == [first.id, second.id]
            assert all("before" in row and "after" in row for row in plan["items"])

            completed = agent_operation_service.approve_and_execute(session, plan["id"], plan["fingerprint"])
            assert completed["status"] == "done"
            assert session.get(AudioItem, first.id).title_user == "New title"
            tag = session.exec(select(Tag).where(Tag.name == "Keep")).one()
            assert session.get(AudioTag, (first.id, tag.id)) is not None
            assert session.get(AudioTag, (second.id, tag.id)) is not None
            assert session.exec(select(PlaylistItem).where(PlaylistItem.playlist_id == playlist.id)).one().audio_id == first.id
            events = session.exec(select(AgentOperationAuditEvent).where(AgentOperationAuditEvent.plan_id == plan["id"])).all()
            assert [row.event_type for row in events] == ["proposed", "approved", "executed"]

            with pytest.raises(ServiceError) as replayed:
                agent_operation_service.approve_and_execute(session, plan["id"], plan["fingerprint"])
            assert replayed.value.code == "agent.operation_approval_replayed"

    def test_operation_plan_rejects_scope_expansion_and_stale_before_value(self):
        root = self.add_library_root(self.root_path / "library")
        allowed = self.add_audio(self.root_path / "library" / "allowed.mp3", root_id=root.id)
        blocked = self.add_audio(self.root_path / "library" / "blocked.mp3", root_id=root.id)
        with Session(self.engine) as session:
            run = self._run(session, [int(allowed.id)])
            with pytest.raises(ServiceError) as outside:
                agent_operation_service.create_plan_from_proposals(
                    session,
                    int(run.id),
                    [{"tool_name": "accept_tags", "arguments": {"audio_ids": [blocked.id], "tag_names": ["No"]}}],
                )
            assert outside.value.code == "agent.scope_violation"

            plan = agent_operation_service.create_plan_from_proposals(
                session,
                int(run.id),
                [{"tool_name": "update_metadata", "arguments": {"audio_id": allowed.id, "title_user": "Planned"}}],
            )
            row = session.get(AudioItem, allowed.id)
            row.title_user = "Manual edit"
            session.add(row)
            session.commit()
            with pytest.raises(ServiceError) as stale:
                agent_operation_service.approve_and_execute(session, plan["id"], plan["fingerprint"])
            assert stale.value.code == "agent.operation_target_stale"
            assert session.get(AudioItem, allowed.id).title_user == "Manual edit"

    def test_agent_tool_call_creates_api_approvable_plan(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        root = self.add_library_root(self.root_path / "library")
        audio = self.add_audio(self.root_path / "library" / "one.mp3", root_id=root.id)
        self.add_setting("llm.endpoint", "http://127.0.0.1:1234/v1")
        self.add_setting("llm.model_name", "test-model")
        conversation = self.client.post(
            "/agent/conversations",
            headers=self.auth_headers(include_client=True),
            json={"scope": {"kind": "audio", "audio_id": audio.id}},
        ).json()
        run = self.client.post(
            f"/agent/conversations/{conversation['id']}/runs",
            headers=self.auth_headers(include_client=True),
            json={"content": "把标题改成新标题"},
        ).json()

        async def capabilities(*args, **kwargs):
            return LLMCapabilities(tool_calling=True)

        async def complete(*args, **kwargs):
            assert kwargs["tool_choice"] == "auto"
            assert all(row["function"]["name"].startswith("propose_") for row in kwargs["tools"])
            return {
                "choices": [{
                    "message": {
                        "content": None,
                        "tool_calls": [{
                            "id": "call-1",
                            "type": "function",
                            "function": {
                                "name": "propose_update_metadata",
                                "arguments": json.dumps({"audio_id": audio.id, "title_user": "新标题"}),
                            },
                        }],
                    },
                }],
            }

        monkeypatch.setattr(agent_tasks.db, "engine", self.engine)
        monkeypatch.setattr(agent_tasks, "probe_openai_compatible_capabilities", capabilities)
        monkeypatch.setattr(agent_tasks, "call_openai_compatible_chat", complete)
        with Session(self.engine) as session:
            assert agent_tasks.claim_next_pending_agent_run(session) is not None
        asyncio.run(agent_tasks.execute_agent_run(run["id"]))

        detail = self.client.get(f"/agent/runs/{run['id']}", headers=self.auth_headers()).json()
        plan = detail["operation_plan"]
        assert detail["status"] == "done"
        assert plan["items"][0]["before"] == {"title_user": None}
        blocked_run = self.client.post(
            f"/agent/conversations/{conversation['id']}/runs",
            headers=self.auth_headers(include_client=True),
            json={"content": "再运行一次"},
        )
        assert blocked_run.status_code == 409
        assert blocked_run.json()["detail"]["code"] == "agent.operation_plan_pending"
        approved = self.client.post(
            f"/agent/operation-plans/{plan['id']}/approve",
            headers=self.auth_headers(include_client=True),
            json={"fingerprint": plan["fingerprint"]},
        )
        assert approved.status_code == 200, approved.text
        assert approved.json()["status"] == "done"
        with Session(self.engine) as session:
            assert session.get(AudioItem, audio.id).title_user == "新标题"

    def test_mcp_exposes_only_read_tools_and_enforces_frozen_scope(self):
        root = self.add_library_root(self.root_path / "library")
        allowed = self.add_audio(self.root_path / "library" / "allowed.mp3", root_id=root.id)
        blocked = self.add_audio(self.root_path / "library" / "blocked.mp3", root_id=root.id)
        with Session(self.engine) as session:
            server = AuduxMcpServer(session, frozenset({int(allowed.id)}))
            initialized = server.dispatch({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}})
            assert initialized["result"]["serverInfo"]["name"] == "audux"
            listed = server.dispatch({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
            names = {row["name"] for row in listed["result"]["tools"]}
            assert {"list_audio", "search_scope", "get_audio_details", "get_transcript", "get_playlist", "scope_statistics"}.issubset(names)
            assert not any(name.startswith("propose_") for name in names)
            denied = server.dispatch({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "get_audio_details", "arguments": {"audio_id": blocked.id}}})
            assert denied["result"]["isError"] is True
            allowed_call = server.dispatch({"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "get_audio_details", "arguments": {"audio_id": allowed.id}}})
            output = allowed_call["result"]["structuredContent"]
            assert output["audio_id"] == allowed.id
            assert "file_path" not in output
            audits = session.exec(select(McpAuditEvent).order_by(McpAuditEvent.id)).all()
            assert [(row.tool_name, row.status) for row in audits] == [
                ("get_audio_details", "failed"),
                ("get_audio_details", "done"),
            ]

    def test_real_stdio_mcp_seam(self, tmp_path: Path):
        repository_root = Path(__file__).resolve().parents[2]
        requests = "\n".join(
            [
                json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}}),
                json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}}),
                json.dumps({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}),
                json.dumps({"jsonrpc": "2.0", "id": 3, "method": "ping", "params": {}}),
            ]
        ) + "\n"
        environment = dict(os.environ)
        environment["HOME"] = str(tmp_path / "mcp-home")
        completed = subprocess.run(
            [sys.executable, str(repository_root / "backend" / "run.py"), "--mcp"],
            cwd=repository_root / "backend",
            env=environment,
            input=requests,
            text=True,
            capture_output=True,
            timeout=15,
            check=True,
        )
        responses = [json.loads(line) for line in completed.stdout.splitlines()]
        assert [row["id"] for row in responses] == [1, 2, 3]
        assert responses[0]["result"]["serverInfo"]["name"] == "audux"
        assert not any(tool["name"].startswith("propose_") for tool in responses[1]["result"]["tools"])
        assert completed.stderr == ""

    def test_archive_dry_run_import_and_diagnostic_are_credential_free(
        self,
        monkeypatch: pytest.MonkeyPatch,
        tmp_path: Path,
    ):
        archive_dir = tmp_path / "archives"
        import_dir = tmp_path / "imports"
        monkeypatch.setattr(archive_service, "ARCHIVES_DIR", archive_dir)
        monkeypatch.setattr(archive_service, "IMPORTS_DIR", import_dir)
        root = self.add_library_root(self.root_path / "library")
        audio = self.add_audio(self.root_path / "library" / "one.mp3", root_id=root.id)
        self.add_setting("llm.api_key", "must-not-leak")
        self.add_setting("llm.model_name", "safe-model")

        with Session(self.engine) as session:
            archive = archive_service.create_archive(session)
            path = archive_dir / archive["file_name"]
            raw = path.read_bytes()
            assert b"must-not-leak" not in raw
            report = archive_service.import_dry_run(session, raw)
            assert report["can_import"] is False
            assert report["missing_audio"] == 1
            assert report["merge_strategy"] == "empty_library_only"
            diagnostic = archive_service.create_diagnostic_bundle(session)
            diagnostic_path = archive_dir / diagnostic["file_name"]
            with zipfile.ZipFile(diagnostic_path) as bundle:
                content = bundle.read("diagnostic.json")
            assert b"must-not-leak" not in content
            assert str(self.root_path).encode() not in content
            assert b'"transcripts_included":false' in content

        assert Path(archive_service.archive_response(archive["id"]).path) == path
        route_report = self.client.post(
            "/maintenance/archives/import/dry-run",
            headers=self.auth_headers(include_client=True),
            files={"file": ("library.audux.zip", raw, "application/zip")},
        )
        assert route_report.status_code == 200, route_report.text
        assert route_report.json()["can_import"] is False
        assert Path(archive_service.diagnostic_response(diagnostic["id"]).path) == diagnostic_path

        empty_path = tmp_path / "empty.sqlite"
        empty_engine = create_engine(f"sqlite:///{empty_path}", connect_args={"check_same_thread": False})
        monkeypatch.setattr(db, "engine", empty_engine)
        SQLModel.metadata.create_all(empty_engine)
        db.create_current_schema_objects()
        try:
            with Session(empty_engine) as empty_session:
                empty_report = archive_service.import_dry_run(empty_session, raw)
                assert empty_report["can_import"] is True
                result = archive_service.execute_import(
                    empty_session,
                    empty_report["archive_id"],
                    empty_report["fingerprint"],
                )
                assert result["ok"] is True
                imported = empty_session.get(AudioItem, audio.id)
                assert imported is not None
                assert imported.is_missing is True
                assert imported.library_root_id is None
                assert str(self.root_path) not in imported.file_path
        finally:
            empty_engine.dispose()
