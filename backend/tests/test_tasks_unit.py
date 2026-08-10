import pytest
from sqlmodel import Session, select

from tests.api_test_support import ApiIntegrationTest
from app import tasks
from app.asr_config import build_asr_task_payload
from app.models import AITask, AudioItem, Setting, Transcript
from app.services.common import ServiceError


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
                "asr.external.prefer_silence": "true",
                "asr.external.vad_threshold": "0.55",
                "asr.external.minimum_silence_ms": "450",
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
            tasks,
            "transcribe_external_audio_chunked",
            fake_chunked_transcription,
        )

        await tasks.handle_transcribe_task(snapshot)

        assert captured["maximum_seconds"] == 28
        assert captured["overlap_seconds"] == 1.5
        assert captured["prefer_silence"] is True
        assert captured["vad_threshold"] == 0.55
        assert captured["minimum_silence_ms"] == 450
        assert captured["is_canceled"]() is False

        with Session(self.engine) as session:
            transcript = session.exec(
                select(Transcript).where(Transcript.audio_id == self.audio.id)
            ).one()
            audio = session.get(AudioItem, self.audio.id)
            assert transcript.full_text == "chunked transcript"
            assert audio.transcript_status == "done"
