import asyncio
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from sqlmodel import Session

from tests.api_test_support import ApiIntegrationTestCase
from app import tasks
from app.models import AITask, AudioItem


class MockAsrHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(content_length)

        self.server.captured_request = {
            "path": self.path,
            "authorization": self.headers.get("Authorization"),
            "content_type": self.headers.get("Content-Type"),
            "body": body,
        }

        response = json.dumps(
            {
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
                        "start_seconds": 1.25,
                        "end_seconds": 2.5,
                        "text": "第二段",
                    },
                ],
            },
            ensure_ascii=False,
        ).encode("utf-8")

        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def log_message(self, format, *args):
        return


class TestExternalAsrFullChain(ApiIntegrationTestCase, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.mock_server = ThreadingHTTPServer(
            ("127.0.0.1", 0),
            MockAsrHandler,
        )
        self.mock_server.captured_request = None
        self.mock_thread = threading.Thread(
            target=self.mock_server.serve_forever,
            daemon=True,
        )
        self.mock_thread.start()

    def tearDown(self):
        self.mock_server.shutdown()
        self.mock_server.server_close()
        self.mock_thread.join(timeout=5)
        super().tearDown()

    def test_api_task_worker_http_upload_and_transcript_persistence(self):
        endpoint = (
            f"http://127.0.0.1:{self.mock_server.server_address[1]}/v1"
        )
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
            self.assertEqual(response.status_code, 200, response.text)

        library = self.root_path / "library"
        root_response = self.client.post(
            "/library-roots",
            headers=self.auth_headers(include_client=True),
            json={"path": str(library)},
        )
        self.assertEqual(root_response.status_code, 400)

        library.mkdir()
        root_response = self.client.post(
            "/library-roots",
            headers=self.auth_headers(include_client=True),
            json={"path": str(library)},
        )
        self.assertEqual(root_response.status_code, 200, root_response.text)
        root_id = root_response.json()["id"]

        audio_path = library / "complete-chain.mp3"
        audio_path.write_bytes(b"mock-audio-binary-content")
        audio = self.add_audio(audio_path, root_id=root_id)

        enqueue = self.client.post(
            f"/audio-items/{audio.id}/transcribe",
            headers=self.auth_headers(include_client=True),
        )
        self.assertEqual(enqueue.status_code, 200, enqueue.text)
        task_id = enqueue.json()["id"]
        self.assertEqual(enqueue.json()["status"], "pending")
        self.assertNotIn("mock-asr-secret", enqueue.json()["input_payload"])

        with Session(self.engine) as session:
            task = tasks.claim_next_pending_task(session)
            self.assertIsNotNone(task)
            snapshot = tasks._snapshot_task(task)

        asyncio.run(tasks.handle_transcribe_task(snapshot))
        tasks._mark_task_done(task_id)

        captured = self.mock_server.captured_request
        self.assertIsNotNone(captured)
        self.assertEqual(captured["path"], "/v1/audio/transcriptions")
        self.assertEqual(
            captured["authorization"],
            "Bearer mock-asr-secret",
        )
        self.assertIn("multipart/form-data", captured["content_type"])
        self.assertIn(b'filename="complete-chain.mp3"', captured["body"])
        self.assertIn(b"mock-audio-binary-content", captured["body"])
        self.assertIn(b"mock-asr-request-model", captured["body"])
        self.assertIn(b"verbose_json", captured["body"])
        self.assertIn(b"segment", captured["body"])
        self.assertIn(b"zh", captured["body"])

        transcript = self.client.get(
            f"/audio-items/{audio.id}/transcript",
            headers=self.auth_headers(),
        )
        self.assertEqual(transcript.status_code, 200, transcript.text)
        transcript_body = transcript.json()
        self.assertEqual(
            transcript_body["transcript"]["full_text"],
            "完整 mock 转写",
        )
        self.assertEqual(
            transcript_body["transcript"]["model_name"],
            "mock-asr-response-model",
        )
        self.assertEqual(
            [segment["text"] for segment in transcript_body["segments"]],
            ["第一段", "第二段"],
        )
        self.assertEqual(
            transcript_body["segments"][1]["start_seconds"],
            1.25,
        )

        task_response = self.client.get(
            f"/ai-tasks/{task_id}",
            headers=self.auth_headers(),
        )
        self.assertEqual(task_response.status_code, 200)
        self.assertEqual(task_response.json()["status"], "done")

        with Session(self.engine) as session:
            stored_audio = session.get(AudioItem, audio.id)
            stored_task = session.get(AITask, task_id)
            self.assertEqual(stored_audio.transcript_status, "done")
            self.assertEqual(stored_task.status, "done")


if __name__ == "__main__":
    unittest.main()
