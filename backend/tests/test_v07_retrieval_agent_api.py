import asyncio

import pytest
from sqlmodel import Session

from app import agent_tasks
from app.models import AgentRun, AudioTag, Playlist, PlaylistItem, SavedView, Tag
from app.providers import LLMCapabilities
from app.schemas import AgentScope, SavedViewQuery
from app.services.retrieval_service import resolve_scope
from app.services.saved_view_service import encode_saved_view_query
from tests.api_test_support import ApiIntegrationTest


class TestV07RetrievalAgentApi(ApiIntegrationTest):
    def _add_transcript(self, audio_id: int, text: str, start: float = 2.0):
        response = self.client.post(
            f"/audio-items/{audio_id}/transcript",
            headers=self.auth_headers(include_client=True),
            json={
                "full_text": text,
                "source_type": "manual",
                "segments": [
                    {
                        "segment_index": 0,
                        "start_seconds": start,
                        "end_seconds": start + 4,
                        "text": text,
                    }
                ],
            },
        )
        assert response.status_code == 200, response.text
        return response.json()

    def test_segment_search_enforces_selection_scope_and_reports_fts_fallback(self):
        root = self.add_library_root(self.root_path / "library")
        allowed = self.add_audio(self.root_path / "library" / "allowed.mp3", root_id=root.id)
        blocked = self.add_audio(self.root_path / "library" / "blocked.mp3", root_id=root.id)
        allowed_revision = self._add_transcript(allowed.id, "共同关键词 允许范围证据")
        self._add_transcript(blocked.id, "共同关键词 不应泄漏的证据")

        response = self.client.post(
            "/search/segments",
            headers=self.auth_headers(include_client=True),
            json={
                "query": "共同关键词",
                "scope": {"kind": "selection", "audio_ids": [allowed.id]},
                "mode": "hybrid",
                "limit": 20,
            },
        )

        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["retrieval_mode"] == "fts"
        assert payload["fallback_reason"] == "embedding_not_configured"
        assert payload["scope_audio_count"] == 1
        assert [row["audio_id"] for row in payload["items"]] == [allowed.id]
        assert payload["items"][0]["revision_id"] == allowed_revision["transcript"]["id"]
        assert payload["items"][0]["start_seconds"] == 2.0

    def test_all_dynamic_scope_kinds_share_saved_view_and_root_filters(self):
        root = self.add_library_root(self.root_path / "library")
        included = self.add_audio(self.root_path / "library" / "included.mp3", root_id=root.id)
        excluded = self.add_audio(self.root_path / "library" / "excluded.mp3", root_id=root.id)
        with Session(self.engine) as session:
            included_row = session.get(type(included), included.id)
            assert included_row is not None
            included_row.is_favorite = True
            tag = Tag(name="范围标签")
            session.add_all([included_row, tag])
            session.flush()
            session.add(AudioTag(audio_id=included.id, tag_id=tag.id))
            query = SavedViewQuery(view="favorites")
            view = SavedView(
                name="收藏视图",
                query_json=encode_saved_view_query(query),
                schema_version=1,
            )
            manual = Playlist(name="手动范围")
            smart = Playlist(
                name="智能范围",
                kind="smart",
                query_json=encode_saved_view_query(query),
                query_schema_version=1,
            )
            session.add_all([view, manual, smart])
            session.flush()
            session.add(PlaylistItem(playlist_id=manual.id, audio_id=included.id, order_index=0))
            session.commit()

            assert resolve_scope(session, AgentScope(kind="tag", tag_id=tag.id)).audio_ids == {included.id}
            assert resolve_scope(session, AgentScope(kind="library_root", library_root_id=root.id)).audio_ids == {included.id, excluded.id}
            assert resolve_scope(session, AgentScope(kind="saved_view", saved_view_id=view.id)).audio_ids == {included.id}
            assert resolve_scope(session, AgentScope(kind="playlist", playlist_id=manual.id)).audio_ids == {included.id}
            assert resolve_scope(session, AgentScope(kind="playlist", playlist_id=smart.id)).audio_ids == {included.id}

    def test_conversation_run_freezes_server_resolved_scope_and_can_be_canceled(self):
        root = self.add_library_root(self.root_path / "library")
        audio = self.add_audio(self.root_path / "library" / "one.mp3", root_id=root.id)

        created = self.client.post(
            "/agent/conversations",
            headers=self.auth_headers(include_client=True),
            json={"title": "限定问答", "scope": {"kind": "audio", "audio_id": audio.id}},
        )
        assert created.status_code == 200, created.text
        conversation = created.json()
        assert conversation["scope_audio_count"] == 1

        started = self.client.post(
            f"/agent/conversations/{conversation['id']}/runs",
            headers=self.auth_headers(include_client=True),
            json={"content": "转写里说了什么？"},
        )
        assert started.status_code == 200, started.text
        run_id = started.json()["id"]

        with Session(self.engine) as session:
            run = session.get(AgentRun, run_id)
            assert run is not None
            assert run.allowed_audio_ids_json == f"[{audio.id}]"

        canceled = self.client.post(
            f"/agent/runs/{run_id}/cancel",
            headers=self.auth_headers(include_client=True),
        )
        assert canceled.status_code == 200, canceled.text
        assert canceled.json()["status"] == "canceled"

        deleted = self.client.request(
            "DELETE",
            f"/agent/conversations/{conversation['id']}",
            headers=self.auth_headers(include_client=True),
        )
        assert deleted.status_code == 200, deleted.text

    def test_agent_answer_citations_are_hidden_after_revision_changes(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        root = self.add_library_root(self.root_path / "library")
        audio = self.add_audio(self.root_path / "library" / "evidence.mp3", root_id=root.id)
        first = self._add_transcript(audio.id, "memory practice improves recall")
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
            json={"content": "memory"},
        ).json()

        async def capabilities(*args, **kwargs):
            return LLMCapabilities(tool_calling=True)

        async def complete(*args, **kwargs):
            return {"choices": [{"message": {"content": "练习能改善回忆。[C1]"}}]}

        monkeypatch.setattr(agent_tasks.db, "engine", self.engine)
        monkeypatch.setattr(agent_tasks, "probe_openai_compatible_capabilities", capabilities)
        monkeypatch.setattr(agent_tasks, "call_openai_compatible_chat", complete)

        with Session(self.engine) as session:
            claimed = agent_tasks.claim_next_pending_agent_run(session)
            assert claimed is not None
        asyncio.run(agent_tasks.execute_agent_run(run["id"]))

        completed = self.client.get(
            f"/agent/runs/{run['id']}",
            headers=self.auth_headers(),
        )
        assert completed.status_code == 200, completed.text
        assert completed.json()["status"] == "done"
        citations = completed.json()["message"]["citations"]
        assert len(citations) == 1
        assert citations[0]["transcript_id"] == first["transcript"]["id"]

        current = self.client.get(
            f"/audio-items/{audio.id}/transcript",
            headers=self.auth_headers(),
        ).json()
        revised = self.client.request(
            "PATCH",
            f"/audio-items/{audio.id}/transcript",
            headers=self.auth_headers(include_client=True),
            json={
                "full_text": "replacement revision",
                "expected_updated_at": current["transcript"]["updated_at"],
            },
        )
        assert revised.status_code == 200, revised.text

        detail = self.client.get(
            f"/agent/conversations/{conversation['id']}",
            headers=self.auth_headers(),
        ).json()
        assistant = next(message for message in detail["messages"] if message["role"] == "assistant")
        assert assistant["citations"] == []

        deleted = self.client.request(
            "DELETE",
            f"/audio-items/{audio.id}/transcript",
            headers=self.auth_headers(include_client=True),
        )
        assert deleted.status_code == 200, deleted.text


def test_agent_answer_removes_model_invented_citation_labels():
    sources = [{"label": "C1"}, {"label": "C2"}]
    assert agent_tasks._sanitize_answer_citations(
        "已验证 [C1]，伪造 [C99]。",
        sources,
    ) == "已验证 [C1]，伪造 。"
