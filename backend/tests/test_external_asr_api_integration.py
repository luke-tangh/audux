import asyncio

import httpx
import pytest
from sqlmodel import Session

from tests.api_test_support import ApiIntegrationTest
from app import asr_client, tasks
from app.models import AITask, AudioItem


class TestExternalAsrFullChain(ApiIntegrationTest):
    @pytest.fixture(autouse=True)
    def setup_mock_asr_transport(self, api_test_context, monkeypatch):
        self.captured_request = None

        async def handle_request(request: httpx.Request) -> httpx.Response:
            self.captured_request = {
                "path": request.url.path,
                "authorization": request.headers.get("Authorization"),
                "content_type": request.headers.get("Content-Type"),
                "body": await request.aread(),
            }
            return httpx.Response(
                200,
                json={
                    "text": "完整 mock 转写",
                    "language": "zh",
                    "model": "mock-asr-response-model",
                    "segments": [
                        {
                            "start": 0,
                            "end": 1.25,
                            "text": "第一段",
                        },
                        {
                            "start": 1.25,
                            "end": 2.5,
                            "text": "第二段",
                        },
                    ],
                },
                request=request,
            )

        transport = httpx.MockTransport(handle_request)
        monkeypatch.setattr(
            asr_client,
            "_create_async_client",
            lambda timeout: httpx.AsyncClient(
                timeout=timeout,
                transport=transport,
            ),
        )

        yield

    def test_api_task_worker_http_upload_and_transcript_persistence(self):
        endpoint = "http://127.0.0.1:9999/v1"
        settings = {
            "asr.provider": "external",
            "asr.external.endpoint": endpoint,
            "asr.external.model_name": "mock-asr-request-model",
            "asr.external.api_key": "mock-asr-secret",
            "asr.external.language": "zh",
            "asr.external.timestamp_policy": "required",
            "asr.external.timeout": "30",
        }

        for key, value in settings.items():
            response = self.put_setting(key, value)
            assert response.status_code == 200, response.text

        library = self.root_path / "library"
        root_response = self.client.post(
            "/library-roots",
            headers=self.auth_headers(include_client=True),
            json={"path": str(library)},
        )
        assert root_response.status_code == 400

        library.mkdir()
        root_response = self.client.post(
            "/library-roots",
            headers=self.auth_headers(include_client=True),
            json={"path": str(library)},
        )
        assert root_response.status_code == 200, root_response.text
        root_id = root_response.json()["id"]

        audio_path = library / "complete-chain.mp3"
        audio_path.write_bytes(b"mock-audio-binary-content")
        audio = self.add_audio(audio_path, root_id=root_id)

        enqueue = self.client.post(
            f"/audio-items/{audio.id}/transcribe",
            headers=self.auth_headers(include_client=True),
        )
        assert enqueue.status_code == 200, enqueue.text
        task_id = enqueue.json()["id"]
        assert enqueue.json()['status'] == 'pending'
        assert 'mock-asr-secret' not in enqueue.json()['input_payload']

        with Session(self.engine) as session:
            task = tasks.claim_next_pending_task(session)
            assert task is not None
            snapshot = tasks._snapshot_task(task)

        asyncio.run(tasks.handle_transcribe_task(snapshot))
        tasks._mark_task_done(task_id)

        captured = self.captured_request
        assert captured is not None
        assert captured['path'] == '/v1/audio/transcriptions'
        assert captured['authorization'] == 'Bearer mock-asr-secret'
        assert 'multipart/form-data' in captured['content_type']
        assert b'filename="complete-chain.mp3"' in captured['body']
        assert b'mock-audio-binary-content' in captured['body']
        assert b'mock-asr-request-model' in captured['body']
        assert b'verbose_json' in captured['body']
        assert b'segment' in captured['body']
        assert b'zh' in captured['body']

        transcript = self.client.get(
            f"/audio-items/{audio.id}/transcript",
            headers=self.auth_headers(),
        )
        assert transcript.status_code == 200, transcript.text
        transcript_body = transcript.json()
        assert transcript_body['transcript']['full_text'] == '完整 mock 转写'
        assert transcript_body['transcript']['model_name'] == 'mock-asr-response-model'
        assert [segment['text'] for segment in transcript_body['segments']] == ['第一段', '第二段']
        assert transcript_body['segments'][1]['start_seconds'] == 1.25

        task_response = self.client.get(
            f"/ai-tasks/{task_id}",
            headers=self.auth_headers(),
        )
        assert task_response.status_code == 200
        assert task_response.json()['status'] == 'done'

        with Session(self.engine) as session:
            stored_audio = session.get(AudioItem, audio.id)
            stored_task = session.get(AITask, task_id)
            assert stored_audio.transcript_status == 'done'
            assert stored_task.status == 'done'
