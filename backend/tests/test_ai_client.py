import unittest

from app.ai_client import parse_ai_json_content


class TestAIClient(unittest.TestCase):
    def test_parse_ai_json_content_clean_json(self):
        self.assertEqual(
            parse_ai_json_content('{"ok": true, "value": 1}'),
            {
                "ok": True,
                "value": 1,
            },
        )

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

        self.assertEqual(
            parse_ai_json_content(content),
            {
                "description": "hello",
                "tags": ["a", "b"],
            },
        )

    def test_parse_ai_json_content_invalid_raises(self):
        with self.assertRaises(ValueError):
            parse_ai_json_content("not json")


if __name__ == "__main__":
    unittest.main()
