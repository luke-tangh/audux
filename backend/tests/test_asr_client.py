import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from app.asr_client import normalize_external_asr_response, transcribe_external_audio


class TestExternalASRClient(unittest.TestCase):
    def test_normalizes_verbose_json_segments(self):
        result = normalize_external_asr_response(
            {
                "text": "你好，世界",
                "language": "zh",
                "model": "qwen3-asr-1.7b",
                "segments": [
                    {
                        "id": 10,
                        "start": 0,
                        "end": 1.25,
                        "text": " 你好 ",
                    },
                    {
                        "id": 11,
                        "start": 1.25,
                        "end": 2.5,
                        "text": "世界",
                    },
                ],
            },
            configured_model_name="configured-model",
            timestamp_policy="preferred",
        )

        self.assertEqual(result["language"], "zh")
        self.assertEqual(result["model_name"], "qwen3-asr-1.7b")
        self.assertEqual(result["full_text"], "你好，世界")
        self.assertEqual(
            result["segments"],
            [
                {
                    "segment_index": 0,
                    "start_seconds": 0.0,
                    "end_seconds": 1.25,
                    "text": "你好",
                },
                {
                    "segment_index": 1,
                    "start_seconds": 1.25,
                    "end_seconds": 2.5,
                    "text": "世界",
                },
            ],
        )

    def test_accepts_internal_field_names_and_text_only_response(self):
        result = normalize_external_asr_response(
            {
                "full_text": "text only",
                "segments": [],
            },
            configured_model_name="mimo-v2.5-asr",
            timestamp_policy="preferred",
        )

        self.assertEqual(result["model_name"], "mimo-v2.5-asr")
        self.assertEqual(result["full_text"], "text only")
        self.assertEqual(result["segments"], [])

    def test_required_timestamps_reject_text_only_response(self):
        with self.assertRaisesRegex(ValueError, "timestamps are required"):
            normalize_external_asr_response(
                {"text": "text only"},
                configured_model_name="model",
                timestamp_policy="required",
            )

    def test_rejects_invalid_segment_time_range(self):
        with self.assertRaisesRegex(ValueError, "invalid time range"):
            normalize_external_asr_response(
                {
                    "text": "bad",
                    "segments": [
                        {
                            "start": 2,
                            "end": 1,
                            "text": "bad",
                        }
                    ],
                },
                configured_model_name="model",
                timestamp_policy="preferred",
            )

    def test_requires_text_field(self):
        with self.assertRaisesRegex(ValueError, "string field 'text'"):
            normalize_external_asr_response(
                {"segments": []},
                configured_model_name="model",
                timestamp_policy="preferred",
            )


class TestExternalASRRequest(unittest.IsolatedAsyncioTestCase):
    async def test_posts_openai_compatible_multipart_request(self):
        captured: dict = {}

        class FakeResponse:
            def raise_for_status(self):
                return None

            def json(self):
                return {
                    "text": "ok",
                    "language": "zh",
                    "segments": [
                        {
                            "start": 0,
                            "end": 1,
                            "text": "ok",
                        }
                    ],
                }

        class FakeAsyncClient:
            def __init__(self, timeout):
                captured["timeout"] = timeout

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, traceback):
                return None

            async def post(self, url, **kwargs):
                captured["url"] = url
                captured.update(kwargs)
                encoded_request = httpx.Request("POST", url, **kwargs)
                captured["encoded_content_type"] = encoded_request.headers[
                    "content-type"
                ]
                captured["encoded_body"] = encoded_request.read()
                return FakeResponse()

        with tempfile.TemporaryDirectory() as tmp:
            audio_path = Path(tmp) / "demo.mp3"
            audio_path.write_bytes(b"not-real-audio")

            with patch("app.asr_client.httpx.AsyncClient", FakeAsyncClient):
                result = await transcribe_external_audio(
                    file_path=str(audio_path),
                    endpoint="http://127.0.0.1:8000/v1/",
                    model_name="qwen3-asr-1.7b",
                    api_key="secret",
                    language="zh",
                    timestamp_policy="preferred",
                    timeout=123,
                )

        self.assertEqual(
            captured["url"],
            "http://127.0.0.1:8000/v1/audio/transcriptions",
        )
        self.assertEqual(captured["timeout"], 123)
        self.assertEqual(
            captured["headers"]["Authorization"],
            "Bearer secret",
        )
        self.assertEqual(captured["data"]["model"], "qwen3-asr-1.7b")
        self.assertEqual(captured["data"]["response_format"], "verbose_json")
        self.assertEqual(captured["data"]["language"], "zh")
        self.assertEqual(
            captured["data"]["timestamp_granularities[]"],
            "segment",
        )
        self.assertEqual(captured["files"]["file"][0], "demo.mp3")
        self.assertIn("multipart/form-data", captured["encoded_content_type"])
        self.assertIn(b'qwen3-asr-1.7b', captured["encoded_body"])
        self.assertEqual(result["full_text"], "ok")


if __name__ == "__main__":
    unittest.main()
