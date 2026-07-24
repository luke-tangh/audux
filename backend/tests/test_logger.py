import unittest

from app.logger import redact_sensitive_text


class TestLoggerRedaction(unittest.TestCase):
    def test_redacts_access_token_query_param(self):
        value = "GET /audio-items/1/file?access_token=secret-token&x=1"

        self.assertEqual(
            redact_sensitive_text(value),
            "GET /audio-items/1/file?access_token=[redacted]&x=1",
        )

    def test_redacts_access_token_query_param_after_ampersand(self):
        value = "GET /export/metadata?format=json&access_token=abc123"

        self.assertEqual(
            redact_sensitive_text(value),
            "GET /export/metadata?format=json&access_token=[redacted]",
        )

    def test_redacts_local_audio_token_header(self):
        value = "X-Local-Audio-Token: super-secret-token"

        self.assertEqual(
            redact_sensitive_text(value),
            "X-Local-Audio-Token: [redacted]",
        )

    def test_redacts_authorization_bearer_header(self):
        value = "Authorization: Bearer super-secret-api-key"

        self.assertEqual(
            redact_sensitive_text(value),
            "Authorization: Bearer [redacted]",
        )

    def test_redacts_multiple_sensitive_values(self):
        value = (
            "Authorization: Bearer api-key, "
            "X-Local-Audio-Token: local-token, "
            "GET /cover?access_token=query-token"
        )

        redacted = redact_sensitive_text(value)

        self.assertNotIn("api-key", redacted)
        self.assertNotIn("local-token", redacted)
        self.assertNotIn("query-token", redacted)
        self.assertIn("[redacted]", redacted)


if __name__ == "__main__":
    unittest.main()
