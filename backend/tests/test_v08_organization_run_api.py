import asyncio
import json

import pytest
from sqlmodel import Session, select

from app import organization_tasks
from app.models import (
    AudioItem,
    AudioTag,
    OrganizationAuditEvent,
    OrganizationProposal,
    Tag,
    Transcript,
)
from app.services.organization_run_service import add_proposal
from tests.api_test_support import ApiIntegrationTest


class TestV08OrganizationRunApi(ApiIntegrationTest):
    def setup_method(self):
        self.library = None
        self.audio = None

    def _seed_transcript(self):
        library = self.root_path / "library"
        root = self.add_library_root(library)
        audio = self.add_audio(library / "v08.mp3", root_id=root.id)
        response = self.client.post(
            f"/audio-items/{audio.id}/transcript",
            headers=self.auth_headers(include_client=True),
            json={
                "language": "zh",
                "full_text": "欢迎来到 Audx\n今天讨论本地知识库",
                "segments": [
                    {"segment_index": 0, "start_seconds": 0, "end_seconds": 2, "text": "欢迎来到 Audx"},
                    {"segment_index": 1, "start_seconds": 2, "end_seconds": 5, "text": "今天讨论本地知识库"},
                ],
            },
        )
        assert response.status_code == 200, response.text
        self.library = library
        self.audio = audio
        return response.json()

    def _create_run(self):
        response = self.client.post(
            "/organization-runs",
            headers=self.auth_headers(include_client=True),
            json={
                "scope": {"kind": "audio", "audio_id": self.audio.id},
                "options": {"transcribe_missing": False},
            },
        )
        assert response.status_code == 200, response.text
        return response.json()

    def test_create_freezes_targets_and_persists_all_stages(self):
        transcript = self._seed_transcript()
        run = self._create_run()

        assert run["status"] == "pending"
        assert [step["stage"] for step in run["steps"]] == [
            "preflight", "transcribe", "validate", "review", "enrich", "apply", "reindex", "verify"
        ]
        assert run["targets"] == [
            {
                **run["targets"][0],
                "audio_id": self.audio.id,
                "source_transcript_id": transcript["transcript"]["id"],
            }
        ]

        second = self.add_audio(self.library / "later.mp3", root_id=self.audio.library_root_id)
        assert second.id is not None
        loaded = self.client.get(
            f"/organization-runs/{run['id']}", headers=self.auth_headers()
        ).json()
        assert [target["audio_id"] for target in loaded["targets"]] == [self.audio.id]
        assert [event["event_type"] for event in loaded["audit_events"]] == ["run.created"]

    def test_edited_acceptance_validates_the_value_before_recording_decision(self):
        transcript = self._seed_transcript()
        run = self._create_run()
        with Session(self.engine) as session:
            proposal = add_proposal(
                session,
                run_id=run["id"],
                audio_id=self.audio.id,
                source_transcript_id=transcript["transcript"]["id"],
                source_segment_id=None,
                kind="tag",
                original_value=None,
                proposed_value={"name": "知识库"},
                evidence=[{"segment_id": transcript["segments"][0]["id"]}],
            )
            session.commit()
            proposal_id = proposal.id

        decision = self.client.request(
            "PATCH",
            f"/organization-proposals/{proposal_id}",
            headers=self.auth_headers(include_client=True),
            json={"decision": "accepted", "edited_value": {"name": "  "}},
        )
        assert decision.status_code == 400, decision.text
        with Session(self.engine) as session:
            assert session.get(OrganizationProposal, proposal_id).status == "pending"

    def test_decision_detects_revision_conflict_and_marks_proposal_stale(self):
        transcript = self._seed_transcript()
        run = self._create_run()
        with Session(self.engine) as session:
            proposal = add_proposal(
                session,
                run_id=run["id"],
                audio_id=self.audio.id,
                source_transcript_id=transcript["transcript"]["id"],
                source_segment_id=transcript["segments"][0]["id"],
                kind="correction",
                original_value={"text": "欢迎来到 Audx"},
                proposed_value={"text": "欢迎来到 Audux"},
                evidence=[{"segment_id": transcript["segments"][0]["id"]}],
            )
            session.commit()
            proposal_id = proposal.id

        changed = self.client.request(
            "PATCH",
            f"/audio-items/{self.audio.id}/transcript/segments",
            headers=self.auth_headers(include_client=True),
            json={
                "expected_updated_at": transcript["transcript"]["updated_at"],
                "segments": [{"id": transcript["segments"][0]["id"], "text": "手工改动"}],
            },
        )
        assert changed.status_code == 200, changed.text
        decision = self.client.request(
            "PATCH",
            f"/organization-proposals/{proposal_id}",
            headers=self.auth_headers(include_client=True),
            json={"decision": "accepted"},
        )
        assert decision.status_code == 409, decision.text
        with Session(self.engine) as session:
            assert session.get(OrganizationProposal, proposal_id).status == "stale"

    def test_accept_and_apply_correction_tag_description_and_chapter_atomically(self):
        transcript = self._seed_transcript()
        run = self._create_run()
        source_id = transcript["transcript"]["id"]
        segment_id = transcript["segments"][0]["id"]
        specs = [
            ("correction", segment_id, {"text": "欢迎来到 Audx"}, {"text": "欢迎来到 Audux"}),
            ("tag", None, None, {"name": "知识库", "matches_existing": False}),
            ("description", None, None, {"text": "一段关于本地知识库的讨论。"}),
            ("chapter", None, None, {"title": "开场", "start_seconds": 0, "end_seconds": 2}),
        ]
        proposal_ids = []
        with Session(self.engine) as session:
            for kind, source_segment_id, original, proposed in specs:
                row = add_proposal(
                    session,
                    run_id=run["id"],
                    audio_id=self.audio.id,
                    source_transcript_id=source_id,
                    source_segment_id=source_segment_id,
                    kind=kind,
                    original_value=original,
                    proposed_value=proposed,
                    evidence=[{"segment_id": segment_id, "start_seconds": 0, "end_seconds": 2}],
                    rationale="test evidence",
                    confidence="high",
                )
                proposal_ids.append(row.id)
            session.commit()

        for proposal_id in proposal_ids:
            decision = self.client.request(
                "PATCH",
                f"/organization-proposals/{proposal_id}",
                headers=self.auth_headers(include_client=True),
                json={"decision": "accepted"},
            )
            assert decision.status_code == 200, decision.text

        applied = self.client.post(
            f"/organization-runs/{run['id']}/apply",
            headers=self.auth_headers(include_client=True),
            json={"categories": ["correction", "tag", "description", "chapter"]},
        )
        assert applied.status_code == 200, applied.text
        body = applied.json()
        assert body["status"] == "done"
        assert {proposal["status"] for proposal in body["proposals"]} == {"applied"}

        current = self.client.get(
            f"/audio-items/{self.audio.id}/transcript", headers=self.auth_headers()
        ).json()
        assert current["transcript"]["id"] != source_id
        assert current["transcript"]["source_type"] == "agent"
        assert current["segments"][0]["text"] == "欢迎来到 Audux"
        assert current["chapters"][0]["title"] == "开场"
        with Session(self.engine) as session:
            audio = session.get(AudioItem, self.audio.id)
            assert audio.description_user == "一段关于本地知识库的讨论。"
            tag = session.exec(select(Tag).where(Tag.name == "知识库")).one()
            assert session.get(AudioTag, (self.audio.id, tag.id)) is not None
            assert len(session.exec(select(Transcript).where(Transcript.audio_id == self.audio.id)).all()) == 2
            assert len(session.exec(select(OrganizationAuditEvent).where(OrganizationAuditEvent.run_id == run["id"])).all()) == 9

    def test_apply_rolls_back_all_writes_on_revision_conflict(self):
        transcript = self._seed_transcript()
        run = self._create_run()
        with Session(self.engine) as session:
            proposal = add_proposal(
                session,
                run_id=run["id"],
                audio_id=self.audio.id,
                source_transcript_id=transcript["transcript"]["id"],
                source_segment_id=None,
                kind="tag",
                original_value=None,
                proposed_value={"name": "不应写入"},
                evidence=[{"segment_id": transcript["segments"][0]["id"]}],
            )
            proposal.status = "accepted"
            session.add(proposal)
            session.commit()

        self.client.request(
            "PATCH",
            f"/audio-items/{self.audio.id}/transcript/segments",
            headers=self.auth_headers(include_client=True),
            json={
                "expected_updated_at": transcript["transcript"]["updated_at"],
                "segments": [{"id": transcript["segments"][0]["id"], "text": "并发改动"}],
            },
        )
        result = self.client.post(
            f"/organization-runs/{run['id']}/apply",
            headers=self.auth_headers(include_client=True),
            json={"categories": ["tag"]},
        )
        assert result.status_code == 400  # source change made the accepted proposal stale
        with Session(self.engine) as session:
            assert session.exec(select(Tag).where(Tag.name == "不应写入")).first() is None

    def test_rejecting_the_last_proposal_completes_review_without_writes(self):
        transcript = self._seed_transcript()
        run = self._create_run()
        with Session(self.engine) as session:
            proposal = add_proposal(
                session,
                run_id=run["id"],
                audio_id=self.audio.id,
                source_transcript_id=transcript["transcript"]["id"],
                source_segment_id=transcript["segments"][0]["id"],
                kind="correction",
                original_value={"text": "欢迎来到 Audx"},
                proposed_value={"text": "欢迎来到 Audux"},
                evidence=[{"segment_id": transcript["segments"][0]["id"]}],
            )
            session.commit()
            proposal_id = proposal.id

        decision = self.client.request(
            "PATCH",
            f"/organization-proposals/{proposal_id}",
            headers=self.auth_headers(include_client=True),
            json={"decision": "rejected", "note": "原文就是这样"},
        )
        assert decision.status_code == 200, decision.text
        loaded = self.client.get(
            f"/organization-runs/{run['id']}", headers=self.auth_headers()
        ).json()
        assert loaded["status"] == "done"
        assert {step["stage"]: step["status"] for step in loaded["steps"]}[
            "apply"
        ] == "skipped"

    def test_revalidation_report_and_diagnostics_exclude_sensitive_file_data(self):
        transcript = self._seed_transcript()
        with Session(self.engine) as session:
            revision = session.get(Transcript, transcript["transcript"]["id"])
            revision.full_text = "故意制造不一致"
            session.add(revision)
            session.commit()

        first = self.client.post(
            f"/audio-items/{self.audio.id}/transcript/validate",
            headers=self.auth_headers(include_client=True),
        )
        assert first.status_code == 200, first.text
        assert first.json()["validation_report"]["new_issue_ids"]

        diagnostics = self.client.get(
            f"/audio-items/{self.audio.id}/transcript/diagnostics",
            headers=self.auth_headers(),
        )
        assert diagnostics.status_code == 200, diagnostics.text
        body = diagnostics.json()
        assert body["revision"]["text_characters"] == len("故意制造不一致")
        serialized = diagnostics.text
        assert str(self.library) not in serialized
        assert '"full_text":' not in serialized
        assert "api_key" not in serialized.lower()

    def test_worker_generates_only_segment_evidenced_proposals(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        transcript = self._seed_transcript()
        self.add_setting("llm.endpoint", "http://127.0.0.1:11434/v1")
        self.add_setting("llm.model_name", "test-model")
        run = self._create_run()
        first_segment = transcript["segments"][0]
        second_segment = transcript["segments"][1]

        async def fake_chat(**kwargs):
            return {
                "choices": [{
                    "message": {
                        "content": json.dumps(
                            {
                                "corrections": [{
                                    "segment_id": first_segment["id"],
                                    "new_text": "欢迎来到 Audux",
                                    "reason": "品牌拼写",
                                    "confidence": "high",
                                }],
                                "tags": [{
                                    "name": "知识库",
                                    "segment_ids": [second_segment["id"], 999999],
                                    "reason": "主题明确",
                                    "confidence": "medium",
                                }],
                                "description": {
                                    "text": "介绍本地知识库。",
                                    "segment_ids": [second_segment["id"]],
                                    "confidence": "medium",
                                },
                                "chapters": [{
                                    "title": "开场",
                                    "start_seconds": 0,
                                    "end_seconds": 2,
                                    "segment_ids": [first_segment["id"]],
                                    "confidence": "high",
                                }],
                            },
                            ensure_ascii=False,
                        )
                    }
                }]
            }

        monkeypatch.setattr(organization_tasks, "call_openai_compatible_chat", fake_chat)
        with Session(self.engine) as session:
            claimed = organization_tasks.claim_next_pending_run(session)
            assert claimed.id == run["id"]

        asyncio.run(organization_tasks.execute_run(run["id"]))
        loaded = self.client.get(
            f"/organization-runs/{run['id']}", headers=self.auth_headers()
        ).json()
        assert loaded["status"] == "awaiting_review"
        assert {proposal["kind"] for proposal in loaded["proposals"]} == {
            "correction", "tag", "description", "chapter"
        }
        tag = next(row for row in loaded["proposals"] if row["kind"] == "tag")
        assert [item["segment_id"] for item in tag["evidence"]] == [
            second_segment["id"]
        ]
        assert loaded["remote_characters"] > 0

        # Reprocessing an identical provider result cannot grow this run's proposal set.
        duplicate_response = asyncio.run(fake_chat())
        with Session(self.engine) as session:
            target = session.exec(select(organization_tasks.OrganizationRunTarget)).one()
            before = len(session.exec(select(OrganizationProposal)).all())
            created = organization_tasks._store_generated(
                session,
                run["id"],
                target,
                json.loads(duplicate_response["choices"][0]["message"]["content"]),
            )
            session.commit()
            assert created == 0
            assert len(session.exec(select(OrganizationProposal)).all()) == before
