import logging

import httpx

from app.logger import SensitiveDataFilter, redact_sensitive_text


class TestLoggerRedaction:
    def test_redacts_access_token_query_param(self):
        value = "GET /audio-items/1/file?access_token=secret-token&x=1"

        assert redact_sensitive_text(value) == (
            "GET /audio-items/1/file?access_token=[redacted]&x=1"
        )

    def test_redacts_access_token_query_param_after_ampersand(self):
        value = "GET /export/metadata?format=json&access_token=abc123"

        assert redact_sensitive_text(value) == (
            "GET /export/metadata?format=json&access_token=[redacted]"
        )

    def test_redacts_local_audio_token_header(self):
        value = "X-Local-Audio-Token: super-secret-token"

        assert redact_sensitive_text(value) == "X-Local-Audio-Token: [redacted]"

    def test_redacts_authorization_bearer_header(self):
        value = "Authorization: Bearer super-secret-api-key"

        assert redact_sensitive_text(value) == "Authorization: Bearer [redacted]"

    def test_redacts_multiple_sensitive_values(self):
        value = (
            "Authorization: Bearer api-key, "
            "X-Local-Audio-Token: local-token, "
            "GET /cover?access_token=query-token"
        )

        redacted = redact_sensitive_text(value)

        assert "api-key" not in redacted
        assert "local-token" not in redacted
        assert "query-token" not in redacted
        assert "[redacted]" in redacted

    def test_filter_redacts_sensitive_values_in_url_objects(self):
        record = logging.LogRecord(
            name="httpx",
            level=20,
            pathname=__file__,
            lineno=1,
            msg="HTTP Request: %s",
            args=(
                httpx.URL(
                    "http://127.0.0.1/audio?access_token=query-token"
                ),
            ),
            exc_info=None,
        )

        SensitiveDataFilter().filter(record)

        rendered = record.getMessage()
        assert "query-token" not in rendered
        assert "access_token=[redacted]" in rendered
