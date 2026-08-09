import pytest
from sqlmodel import Session

from tests.api_test_support import ApiIntegrationTest
from app import tasks
from app.models import AITask, AudioItem, Setting
from app.services.common import ServiceError


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
