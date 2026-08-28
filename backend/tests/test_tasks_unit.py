import json

import pytest
from sqlmodel import Session, select

from tests.api_test_support import ApiIntegrationTest
from app import main as main_module
from app import task_handlers, tasks
from app.asr_config import build_asr_task_payload
from app.models import AITask, AudioItem, Setting, Transcript, TranscriptSegment
from app.services.errors import ServiceError


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


class TestTaskStateTransitions(ApiIntegrationTest):
    @pytest.fixture(autouse=True)
    def setup_audio(self, api_test_context, monkeypatch):
        library = self.root_path / "library"
        root = self.add_library_root(library)
        self.audio = self.add_audio(library / "task.mp3", root_id=root.id)
        monkeypatch.setattr(tasks, "engine", self.engine)

    def test_create_task_enforces_one_active_task_but_allows_history(self):
        with Session(self.engine) as session:
            first = tasks.create_task(
                session,
                self.audio.id,
                "analyze",
                {"provider": "local"},
            )
            assert first.status == "pending"
            assert tasks._snapshot_task(first).input_payload == {"provider": "local"}

            with pytest.raises(tasks.ActiveTaskConflict):
                tasks.create_task(session, self.audio.id, "analyze")

            first = session.get(AITask, first.id)
            first.status = "done"
            session.add(first)
            session.commit()

            second = tasks.create_task(session, self.audio.id, "analyze")
            assert second.id != first.id

    def test_claim_and_finalize_done_updates_task_and_audio_together(self):
        with Session(self.engine) as session:
            first = tasks.create_task(session, self.audio.id, "analyze")
            second = tasks.create_task(session, self.audio.id, "transcribe")

            claimed = tasks.claim_next_pending_task(session)
            assert claimed.id == first.id
            assert claimed.status == "running"
            assert claimed.started_at is not None

            next_claimed = tasks.claim_next_pending_task(session)
            assert next_claimed.id == second.id
            assert tasks.claim_next_pending_task(session) is None

            # A handler that already committed its output wins over a late cancel.
            claimed.status = "cancel_requested"
            session.add(claimed)
            session.commit()
            first_id = first.id

        tasks._mark_task_done(first_id)

        with Session(self.engine) as session:
            finished = session.get(AITask, first_id)
            audio = session.get(AudioItem, self.audio.id)
            assert finished.status == "done"
            assert finished.finished_at is not None
            assert audio.ai_status == "done"

    def test_failure_and_cancel_paths_preserve_structured_error_state(self):
        with Session(self.engine) as session:
            failed = tasks.create_task(session, self.audio.id, "transcribe")
            failed.status = "running"
            session.add(failed)
            session.commit()
            failed_id = failed.id

        tasks._mark_task_failed_or_canceled_after_exception(
            failed_id,
            ServiceError(
                400,
                "Provider rejected request",
                code="asr.provider_rejected",
                params={"provider": "external"},
            ),
        )

        with Session(self.engine) as session:
            failed = session.get(AITask, failed_id)
            audio = session.get(AudioItem, self.audio.id)
            assert failed.status == "failed"
            assert failed.error_code == "asr.provider_rejected"
            assert failed.error_params == '{"provider": "external"}'
            assert audio.transcript_status == "failed"

            canceled = tasks.create_task(session, self.audio.id, "analyze")
            canceled.status = "cancel_requested"
            session.add(canceled)
            session.commit()
            canceled_id = canceled.id

        tasks._mark_task_failed_or_canceled_after_exception(
            canceled_id,
            RuntimeError("worker stopped"),
        )

        with Session(self.engine) as session:
            canceled = session.get(AITask, canceled_id)
            audio = session.get(AudioItem, self.audio.id)
            assert canceled.status == "canceled"
            assert canceled.error_message is None
            assert audio.ai_status == "canceled"

    def test_finalize_cancel_updates_task_and_audio_in_one_commit(self, monkeypatch):
        with Session(self.engine) as session:
            task = tasks.create_task(session, self.audio.id, "analyze")
            task.status = "cancel_requested"
            session.add(task)
            session.commit()
            commit_count = 0
            original_commit = session.commit

            def tracked_commit():
                nonlocal commit_count
                commit_count += 1
                original_commit()

            monkeypatch.setattr(session, "commit", tracked_commit)
            tasks.finalize_canceled_task(session, int(task.id))

            assert commit_count == 1
            assert session.get(AITask, task.id).status == "canceled"
            assert session.get(AudioItem, self.audio.id).ai_status == "canceled"

    @pytest.mark.anyio
    async def test_worker_can_be_stopped_and_restarted(self, monkeypatch):
        monkeypatch.setattr(tasks, "recover_interrupted_tasks", lambda: 0)
        first = tasks.start_worker_once()
        assert tasks.start_worker_once() is first

        await tasks.stop_worker()
        assert first.cancelled()

        second = tasks.start_worker_once()
        assert second is not first
        await tasks.stop_worker()

    @pytest.mark.anyio
    async def test_application_lifespan_stops_all_workers(self, monkeypatch):
        events: list[str] = []

        for name in (
            "initialize_database_with_pending_restore",
            "_get_or_create_local_api_token",
            "recover_interrupted_scan_tasks",
        ):
            monkeypatch.setattr(main_module, name, lambda: None)
        monkeypatch.setattr(
            main_module,
            "recover_interrupted_health_tasks",
            lambda bind: None,
        )
        monkeypatch.setattr(
            main_module,
            "recover_interrupted_agent_runs",
            lambda bind: None,
        )
        monkeypatch.setattr(
            main_module,
            "recover_interrupted_runs",
            lambda bind: None,
        )
        monkeypatch.setattr(
            main_module,
            "start_worker_once",
            lambda: events.append("start-task"),
        )
        monkeypatch.setattr(
            main_module,
            "start_agent_worker_once",
            lambda: events.append("start-agent"),
        )
        monkeypatch.setattr(
            main_module,
            "start_organization_worker_once",
            lambda: events.append("start-organization"),
        )

        def stop(name: str):
            async def run():
                events.append(name)

            return run

        monkeypatch.setattr(main_module, "stop_worker", stop("stop-task"))
        monkeypatch.setattr(
            main_module,
            "stop_agent_worker",
            stop("stop-agent"),
        )
        monkeypatch.setattr(
            main_module,
            "stop_organization_worker",
            stop("stop-organization"),
        )

        async with main_module.lifespan(main_module.app):
            assert events == ["start-task", "start-agent", "start-organization"]

        assert set(events[3:]) == {
            "stop-task",
            "stop-agent",
            "stop-organization",
        }

    def test_numeric_settings_fall_back_for_missing_empty_and_invalid_values(self):
        with Session(self.engine) as session:
            session.add_all(
                [
                    Setting(key="valid-int", value="12"),
                    Setting(key="invalid-int", value="twelve"),
                    Setting(key="valid-float", value="1.25"),
                    Setting(key="empty-float", value=""),
                ]
            )
            session.commit()

            assert tasks.get_setting_int(session, "valid-int", 3) == 12
            assert tasks.get_setting_int(session, "invalid-int", 3) == 3
            assert tasks.get_setting_int(session, "missing", 3) == 3
            assert tasks.get_setting_float(session, "valid-float", 0.5) == 1.25
            assert tasks.get_setting_float(session, "empty-float", 0.5) == 0.5

    @pytest.mark.anyio
    async def test_external_chunking_snapshot_is_dispatched_and_persisted(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        with Session(self.engine) as session:
            for key, value in {
                "asr.provider": "external",
                "asr.external.endpoint": "http://127.0.0.1:8025/v1",
                "asr.external.model_name": "ark-asr",
                "asr.external.language": "zh",
                "asr.external.timestamp_policy": "required",
                "asr.external.timeout": "120",
                "asr.external.chunking_enabled": "true",
                "asr.external.chunk_seconds": "28",
                "asr.external.chunk_overlap_seconds": "1.5",
                "asr.external.chunk_concurrency": "4",
                "asr.external.prefer_silence": "true",
                "asr.external.vad_threshold": "0.55",
                "asr.external.minimum_silence_ms": "450",
                "asr.external.formatting_enabled": "true",
                "asr.external.case_glossary": "ark asr=ARK-ASR",
            }.items():
                session.add(Setting(key=key, value=value))
            session.commit()

            task = tasks.create_task(
                session,
                self.audio.id,
                "transcribe",
                build_asr_task_payload(session),
            )
            task.status = "running"
            session.add(task)
            session.commit()
            snapshot = tasks._snapshot_task(task)

        captured: dict = {}

        async def fake_chunked_transcription(**kwargs):
            captured.update(kwargs)
            return {
                "full_text": "chunked transcript",
                "language": "zh",
                "model_name": "ark-asr",
                "segments": [
                    {
                        "segment_index": 0,
                        "start_seconds": 0,
                        "end_seconds": 12,
                        "text": "chunked transcript",
                    }
                ],
            }

        monkeypatch.setattr(
            task_handlers,
            "transcribe_external_audio_chunked",
            fake_chunked_transcription,
        )

        await tasks.handle_transcribe_task(snapshot)

        assert captured["maximum_seconds"] == 28
        assert captured["overlap_seconds"] == 1.5
        assert captured["chunk_concurrency"] == 4
        assert captured["prefer_silence"] is True
        assert captured["vad_threshold"] == 0.55
        assert captured["minimum_silence_ms"] == 450
        assert captured["formatting_enabled"] is True
        assert captured["case_glossary"] == "ark asr=ARK-ASR"
        assert captured["is_canceled"]() is False

        with Session(self.engine) as session:
            transcript = session.exec(
                select(Transcript)
                .where(Transcript.audio_id == self.audio.id)
                .where(Transcript.is_current.is_(True))
            ).one()
            audio = session.get(AudioItem, self.audio.id)
            assert transcript.full_text == "chunked transcript"
            assert audio.transcript_status == "done"

    @pytest.mark.anyio
    async def test_retranscription_replaces_segmented_transcript_without_fk_error(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        with Session(self.engine) as session:
            old_transcript = Transcript(
                audio_id=self.audio.id,
                full_text="old transcript",
                model_name="old-model",
            )
            session.add(old_transcript)
            session.flush()
            session.add(
                TranscriptSegment(
                    transcript_id=old_transcript.id,
                    segment_index=0,
                    start_seconds=0,
                    end_seconds=2,
                    text="old transcript",
                )
            )
            for key, value in {
                "asr.provider": "external",
                "asr.external.endpoint": "http://127.0.0.1:8025/v1",
                "asr.external.model_name": "ark-asr",
            }.items():
                session.add(Setting(key=key, value=value))
            session.commit()

            task = tasks.create_task(
                session,
                self.audio.id,
                "transcribe",
                build_asr_task_payload(session),
            )
            task.status = "running"
            session.add(task)
            session.commit()
            snapshot = tasks._snapshot_task(task)

        async def fake_external_transcription(**kwargs):
            return {
                "full_text": "new transcript",
                "language": "en",
                "model_name": kwargs["model_name"],
                "segments": [
                    {
                        "segment_index": 0,
                        "start_seconds": 0,
                        "end_seconds": 3,
                        "text": "new transcript",
                    }
                ],
            }

        monkeypatch.setattr(
            task_handlers,
            "transcribe_external_audio",
            fake_external_transcription,
        )

        await tasks.handle_transcribe_task(snapshot)

        with Session(self.engine) as session:
            transcript = session.exec(
                select(Transcript)
                .where(Transcript.audio_id == self.audio.id)
                .where(Transcript.is_current.is_(True))
            ).one()
            segments = session.exec(
                select(TranscriptSegment).where(
                    TranscriptSegment.transcript_id == transcript.id
                )
            ).all()
            assert transcript.full_text == "New transcript"
            assert [segment.text for segment in segments] == ["New transcript"]
            assert len(
                session.exec(
                    select(Transcript).where(Transcript.audio_id == self.audio.id)
                ).all()
            ) == 2

    @pytest.mark.anyio
    async def test_direct_external_transcription_applies_text_formatting(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        with Session(self.engine) as session:
            for key, value in {
                "asr.provider": "external",
                "asr.external.endpoint": "http://127.0.0.1:8025/v1",
                "asr.external.model_name": "ark-asr",
                "asr.external.case_glossary": (
                    "ark asr=ARK-ASR-3B\npytorch=PyTorch"
                ),
            }.items():
                session.add(Setting(key=key, value=value))
            session.commit()

            task = tasks.create_task(
                session,
                self.audio.id,
                "transcribe",
                build_asr_task_payload(session),
            )
            task.status = "running"
            session.add(task)
            session.commit()
            snapshot = tasks._snapshot_task(task)

        async def fake_external_transcription(**kwargs):
            return {
                "full_text": "ark asr uses pytorch.",
                "language": "en",
                "model_name": kwargs["model_name"],
                "segments": [
                    {
                        "segment_index": 0,
                        "start_seconds": 0,
                        "end_seconds": 5,
                        "text": "ark asr uses pytorch.",
                    }
                ],
            }

        monkeypatch.setattr(
            task_handlers,
            "transcribe_external_audio",
            fake_external_transcription,
        )

        await tasks.handle_transcribe_task(snapshot)

        with Session(self.engine) as session:
            transcript = session.exec(
                select(Transcript)
                .where(Transcript.audio_id == self.audio.id)
                .where(Transcript.is_current.is_(True))
            ).one()
            assert transcript.full_text == "ARK-ASR-3B uses PyTorch."

    @pytest.mark.anyio
    async def test_analyze_persists_bounded_structured_output(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        with Session(self.engine) as session:
            session.add_all(
                [
                    Setting(key="llm.endpoint", value="http://127.0.0.1:11434/v1"),
                    Setting(key="llm.model_name", value="local-model"),
                    Setting(key="ai.output_language", value="en"),
                    Transcript(
                        audio_id=int(self.audio.id),
                        full_text="A local transcript used as evidence.",
                        is_current=True,
                    ),
                ]
            )
            session.commit()
            task = tasks.create_task(session, int(self.audio.id), "analyze")
            task.status = "running"
            session.add(task)
            session.commit()
            snapshot = tasks._snapshot_task(task)

        captured: dict = {}

        async def fake_chat(**kwargs):
            captured.update(kwargs)
            return {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "description": "x" * 900,
                                    "tags": [
                                        " topic ",
                                        "topic",
                                        "",
                                        "a" * 50,
                                    ],
                                    "language": "en",
                                }
                            )
                        }
                    }
                ]
            }

        monkeypatch.setattr(task_handlers, "call_openai_compatible_chat", fake_chat)

        await task_handlers.handle_analyze_task(snapshot)

        assert captured["model_name"] == "local-model"
        assert "A local transcript used as evidence." in captured["messages"][1]["content"]
        with Session(self.engine) as session:
            audio = session.get(AudioItem, self.audio.id)
            task = session.get(AITask, snapshot.id)
            output = json.loads(task.output_payload)
            assert audio.ai_status == "done"
            assert audio.language == "en"
            assert len(audio.description_ai) == 800
            assert output["description"] == audio.description_ai
            assert output["tags"] == ["topic", "a" * 40]

    @pytest.mark.anyio
    async def test_analyze_rejects_invalid_structured_output_after_preserving_raw_content(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        with Session(self.engine) as session:
            session.add_all(
                [
                    Setting(key="llm.endpoint", value="http://127.0.0.1:11434/v1"),
                    Setting(key="llm.model_name", value="local-model"),
                ]
            )
            session.commit()
            task = tasks.create_task(session, int(self.audio.id), "analyze")
            task.status = "running"
            session.add(task)
            session.commit()
            snapshot = tasks._snapshot_task(task)

        async def fake_chat(**kwargs):
            return {"choices": [{"message": {"content": "not-json"}}]}

        monkeypatch.setattr(task_handlers, "call_openai_compatible_chat", fake_chat)

        with pytest.raises(ValueError, match="LLM response is not valid JSON"):
            await task_handlers.handle_analyze_task(snapshot)

        with Session(self.engine) as session:
            task = session.get(AITask, snapshot.id)
            assert json.loads(task.output_payload) == {"raw_content": "not-json"}
