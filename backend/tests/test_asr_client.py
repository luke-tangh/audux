from pathlib import Path

import httpx
import pytest

from app.asr_client import normalize_external_asr_response, transcribe_external_audio


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


class TestExternalASRClient:
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

        assert result["language"] == "zh"
        assert result["model_name"] == "qwen3-asr-1.7b"
        assert result["full_text"] == "你好，世界"
        assert result["segments"] == [
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
        ]

    def test_accepts_internal_field_names_and_text_only_response(self):
        result = normalize_external_asr_response(
            {
                "full_text": "text only",
                "segments": [],
            },
            configured_model_name="mimo-v2.5-asr",
            timestamp_policy="preferred",
        )

        assert result["model_name"] == "mimo-v2.5-asr"
        assert result["full_text"] == "text only"
        assert result["segments"] == []

    def test_required_timestamps_reject_text_only_response(self):
        with pytest.raises(ValueError, match="timestamps are required"):
            normalize_external_asr_response(
                {"text": "text only"},
                configured_model_name="model",
                timestamp_policy="required",
            )

    def test_rejects_invalid_segment_time_range(self):
        with pytest.raises(ValueError, match="invalid time range"):
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
        with pytest.raises(ValueError, match="string field 'text'"):
            normalize_external_asr_response(
                {"segments": []},
                configured_model_name="model",
                timestamp_policy="preferred",
            )


class TestExternalASRRequest:
    @pytest.mark.anyio
    async def test_posts_openai_compatible_multipart_request(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ):
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

        audio_path = tmp_path / "demo.mp3"
        audio_path.write_bytes(b"not-real-audio")
        monkeypatch.setattr("app.asr_client.httpx.AsyncClient", FakeAsyncClient)

        result = await transcribe_external_audio(
            file_path=str(audio_path),
            endpoint="http://127.0.0.1:8000/v1/",
            model_name="qwen3-asr-1.7b",
            api_key="secret",
            language="zh",
            timestamp_policy="preferred",
            timeout=123,
        )

        assert captured["url"] == (
            "http://127.0.0.1:8000/v1/audio/transcriptions"
        )
        assert captured["timeout"] == 123
        assert captured["headers"]["Authorization"] == "Bearer secret"
        assert captured["data"]["model"] == "qwen3-asr-1.7b"
        assert captured["data"]["response_format"] == "verbose_json"
        assert captured["data"]["language"] == "zh"
        assert captured["data"]["timestamp_granularities[]"] == "segment"
        assert captured["files"]["file"][0] == "demo.mp3"
        assert "multipart/form-data" in captured["encoded_content_type"]
        assert b'qwen3-asr-1.7b' in captured["encoded_body"]
        assert result["full_text"] == "ok"
