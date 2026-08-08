import pytest

from app.ai_client import (
    get_ai_message_content,
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
