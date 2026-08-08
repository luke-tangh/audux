import json

import pytest
from sqlmodel import Session

from tests.api_test_support import ApiIntegrationTest
from app import tasks
from app.models import AITask, AudioItem, Transcript


class TestTaskApiLifecycle(ApiIntegrationTest):
    @pytest.fixture(autouse=True)
    def setup_audio_item(self, api_test_context):
        self.library = self.root_path / "library"
        self.library_root = self.add_library_root(self.library)
        self.audio = self.add_audio(
            self.library / "task-audio.mp3",
            root_id=self.library_root.id,
        )

    def test_settings_and_asr_ai_create_cancel_retry_lifecycle(self):
        settings = {
            "asr.provider": "external",
            "asr.external.endpoint": "http://127.0.0.1:9999/v1",
            "asr.external.model_name": "mock-asr",
            "asr.external.api_key": "asr-secret-value",
            "asr.external.language": "zh",
            "asr.external.timestamp_policy": "required",
            "asr.external.timeout": "30",
            "llm.endpoint": "http://127.0.0.1:9998/v1",
            "llm.model_name": "mock-llm",
            "llm.api_key": "llm-secret-value",
        }

        for key, value in settings.items():
            response = self.put_setting(key, value)
            assert response.status_code == 200, response.text

        unauthorized_settings = self.client.get("/settings")
        assert unauthorized_settings.status_code == 401

        listed_settings = self.client.get(
            "/settings",
            headers=self.auth_headers(),
        )
        assert listed_settings.status_code == 200
        returned = {
            row["key"]: row["value"]
            for row in listed_settings.json()
        }
        assert returned['asr.external.api_key'] == 'asr-secret-value'
        assert returned['llm.api_key'] == 'llm-secret-value'

        transcribe = self.client.post(
            f"/audio-items/{self.audio.id}/transcribe",
            headers=self.auth_headers(include_client=True),
        )
        assert transcribe.status_code == 200, transcribe.text
        transcribe_body = transcribe.json()
        assert transcribe_body['status'] == 'pending'
        assert transcribe_body['task_type'] == 'transcribe'
        assert 'asr-secret-value' not in transcribe_body['input_payload']
        assert 'api_key' not in json.loads(transcribe_body['input_payload'])['asr']

        cancel_transcribe = self.client.post(
            f"/ai-tasks/{transcribe_body['id']}/cancel",
            headers=self.auth_headers(include_client=True),
        )
        assert cancel_transcribe.status_code == 200
        assert cancel_transcribe.json()['status'] == 'canceled'

        retry_transcribe = self.client.post(
            f"/ai-tasks/{transcribe_body['id']}/retry",
            headers=self.auth_headers(include_client=True),
        )
        assert retry_transcribe.status_code == 200, retry_transcribe.text
        assert retry_transcribe.json()['status'] == 'pending'
        assert retry_transcribe.json()['retry_count'] == 1

        with Session(self.engine) as session:
            task = session.get(AITask, transcribe_body["id"])
            task.status = "running"
            session.add(task)
            audio = session.get(AudioItem, self.audio.id)
            audio.transcript_status = "running"
            session.add(audio)
            session.commit()

        request_cancel = self.client.post(
            f"/ai-tasks/{transcribe_body['id']}/cancel",
            headers=self.auth_headers(include_client=True),
        )
        assert request_cancel.status_code == 200
        assert request_cancel.json()['status'] == 'cancel_requested'

        analyze = self.client.post(
            f"/audio-items/{self.audio.id}/analyze",
            headers=self.auth_headers(include_client=True),
        )
        assert analyze.status_code == 200, analyze.text
        analyze_body = analyze.json()
        assert analyze_body['status'] == 'pending'
        assert analyze_body['task_type'] == 'analyze'
        assert 'llm-secret-value' not in analyze_body['input_payload']

        cancel_analyze = self.client.post(
            f"/ai-tasks/{analyze_body['id']}/cancel",
            headers=self.auth_headers(include_client=True),
        )
        assert cancel_analyze.status_code == 200
        assert cancel_analyze.json()['status'] == 'canceled'

        retry_analyze = self.client.post(
            f"/ai-tasks/{analyze_body['id']}/retry",
            headers=self.auth_headers(include_client=True),
        )
        assert retry_analyze.status_code == 200, retry_analyze.text
        assert retry_analyze.json()['status'] == 'pending'
        assert retry_analyze.json()['retry_count'] == 1

        with Session(self.engine) as session:
            stored_audio = session.get(AudioItem, self.audio.id)
            assert stored_audio.transcript_status == 'cancel_requested'
            assert stored_audio.ai_status == 'pending'


class TestInterruptedTaskRecovery(ApiIntegrationTest):
    def test_restart_recovery_reconciles_failed_canceled_and_completed_tasks(self):
        library = self.root_path / "library"
        root = self.add_library_root(library)

        failed_audio = self.add_audio(
            library / "failed.mp3",
            root_id=root.id,
            transcript_status="running",
        )
        canceled_audio = self.add_audio(
            library / "canceled.mp3",
            root_id=root.id,
            ai_status="cancel_requested",
        )
        completed_asr_audio = self.add_audio(
            library / "completed-asr.mp3",
            root_id=root.id,
            transcript_status="running",
        )
        completed_ai_audio = self.add_audio(
            library / "completed-ai.mp3",
            root_id=root.id,
            ai_status="running",
        )

        with Session(self.engine) as session:
            rows = [
                AITask(
                    audio_id=failed_audio.id,
                    task_type="transcribe",
                    status="running",
                ),
                AITask(
                    audio_id=canceled_audio.id,
                    task_type="analyze",
                    status="cancel_requested",
                ),
                AITask(
                    audio_id=completed_asr_audio.id,
                    task_type="transcribe",
                    status="running",
                ),
                AITask(
                    audio_id=completed_ai_audio.id,
                    task_type="analyze",
                    status="running",
                    output_payload=json.dumps(
                        {
                            "description": "already committed",
                            "tags": ["done"],
                        }
                    ),
                ),
            ]
            session.add_all(rows)
            session.add(
                Transcript(
                    audio_id=completed_asr_audio.id,
                    full_text="completed transcript",
                    status="done",
                )
            )
            session.commit()
            task_ids = [row.id for row in rows]

        recovered = tasks.recover_interrupted_tasks()
        assert recovered == 4

        with Session(self.engine) as session:
            recovered_tasks = [
                session.get(AITask, task_id)
                for task_id in task_ids
            ]
            assert [row.status for row in recovered_tasks] == ['failed', 'canceled', 'done', 'done']
            assert 'backend restart' in recovered_tasks[0].error_message
            assert recovered_tasks[0].finished_at is not None
            assert recovered_tasks[1].finished_at is not None

            assert session.get(AudioItem, failed_audio.id).transcript_status == 'failed'
            assert session.get(AudioItem, canceled_audio.id).ai_status == 'canceled'
            assert session.get(AudioItem, completed_asr_audio.id).transcript_status == 'done'
            assert session.get(AudioItem, completed_ai_audio.id).ai_status == 'done'
