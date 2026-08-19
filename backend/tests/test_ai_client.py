import asyncio

import pytest

from app.ai_client import (
    get_ai_message_content,
    list_openai_compatible_models,
    parse_ai_json_content,
    parse_ai_json_response,
)


class TestAIClient:
    def test_parse_ai_json_content_clean_json(self):
        assert parse_ai_json_content('{"ok": true, "value": 1}') == {
            "ok": True,
            "value": 1,
        }

    def test_parse_ai_json_content_extracts_json_object(self):
        content = """
        Here is the result:

        ```json
        {
          "description": "hello",
          "tags": ["a", "b"]
        }
        ```
        """

        assert parse_ai_json_content(content) == {
            "description": "hello",
            "tags": ["a", "b"],
        }

    def test_parse_ai_json_content_extracts_unicode_json_object(self):
        content = '模型输出：{"description": "你好，世界", "tags": ["中文", "AI"]} 完成。'

        assert parse_ai_json_content(content) == {
            "description": "你好，世界",
            "tags": ["中文", "AI"],
        }

    def test_parse_ai_json_content_invalid_raises(self):
        with pytest.raises(ValueError):
            parse_ai_json_content("not json")

    def test_parse_ai_json_content_malformed_embedded_json_raises(self):
        with pytest.raises(ValueError):
            parse_ai_json_content("prefix {not valid json} suffix")

    def test_get_ai_message_content_success(self):
        response = {
            "choices": [
                {
                    "message": {
                        "content": "hello",
                    }
                }
            ]
        }

        assert get_ai_message_content(response) == "hello"

    def test_get_ai_message_content_invalid_schema_raises(self):
        with pytest.raises(ValueError):
            get_ai_message_content({"choices": []})

    def test_parse_ai_json_response(self):
        response = {
            "choices": [
                {
                    "message": {
                        "content": '{"description": "ok", "tags": ["tag"]}',
                    }
                }
            ]
        }

        assert parse_ai_json_response(response) == {
            "description": "ok",
            "tags": ["tag"],
        }


class TestAIModelDiscovery:
    def test_lists_unique_openai_compatible_model_ids(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        captured: dict = {}

        class FakeResponse:
            def raise_for_status(self):
                return None

            def json(self):
                return {
                    "data": [
                        {"id": "model-b"},
                        {"id": " model-a "},
                        {"id": "model-b"},
                        {"name": "ignored"},
                    ]
                }

        class FakeAsyncClient:
            def __init__(self, timeout):
                captured["timeout"] = timeout

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, traceback):
                return None

            async def get(self, url, **kwargs):
                captured["url"] = url
                captured.update(kwargs)
                return FakeResponse()

        monkeypatch.setattr("app.ai_client.httpx.AsyncClient", FakeAsyncClient)

        models = asyncio.run(
            list_openai_compatible_models(
                "http://127.0.0.1:1234/v1/",
                api_key="secret",
                timeout=15,
            )
        )

        assert models == ["model-b", "model-a"]
        assert captured == {
            "timeout": 15,
            "url": "http://127.0.0.1:1234/v1/models",
            "headers": {
                "Accept": "application/json",
                "Authorization": "Bearer secret",
            },
        }

    def test_rejects_invalid_model_list_schema(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        class FakeResponse:
            def raise_for_status(self):
                return None

            def json(self):
                return {"models": ["not-openai-compatible"]}

        class FakeAsyncClient:
            def __init__(self, timeout):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, traceback):
                return None

            async def get(self, url, **kwargs):
                return FakeResponse()

        monkeypatch.setattr("app.ai_client.httpx.AsyncClient", FakeAsyncClient)

        with pytest.raises(ValueError, match="models response schema"):
            asyncio.run(list_openai_compatible_models("http://localhost:11434/v1"))
