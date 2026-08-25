from pathlib import Path

import pytest

import app.local_security as security


@pytest.fixture(autouse=True)
def disable_allow_all_cors(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(security, "ALLOW_ALL_CORS", False)


class TestLocalSecurity:
    @pytest.mark.parametrize(
        "origin",
        [
            "http://localhost:5173",
            "https://localhost",
            "http://127.0.0.1:5173",
            "https://tauri.localhost",
            "tauri://localhost",
        ],
    )
    def test_allowed_request_origins(self, origin: str):
        assert security._is_allowed_request_origin(origin)

    @pytest.mark.parametrize(
        "origin",
        [
            "https://example.com",
            "http://localhost.evil.com",
            "http://127.0.0.2:3000",
            "http://[::1]:5173",
            "http://foo.localhost:5173",
            "file://localhost/path",
            "ftp://localhost",
            "not-a-url",
        ],
    )
    def test_disallowed_request_origins(self, origin: str):
        assert not security._is_allowed_request_origin(origin)

    def test_token_initialization_fails_if_token_cannot_be_persisted(
        self,
        monkeypatch: pytest.MonkeyPatch,
        tmp_path: Path,
    ):
        token_path = tmp_path / "missing-parent" / "local_api_token"
        monkeypatch.setattr(security, "AUDUX_TOKEN_FILE", token_path)

        with pytest.raises(RuntimeError, match="Failed to initialize local API token"):
            security._get_or_create_local_api_token()

        assert not token_path.exists()

    def test_token_initialization_fails_if_existing_token_cannot_be_secured(
        self,
        monkeypatch: pytest.MonkeyPatch,
        tmp_path: Path,
    ):
        token_path = tmp_path / "local_api_token"
        token_path.write_text("stable-token", encoding="utf-8")
        monkeypatch.setattr(security, "AUDUX_TOKEN_FILE", token_path)

        def fail_restriction(_):
            raise OSError("chmod denied")

        monkeypatch.setattr(security, "restrict_private_file", fail_restriction)

        with pytest.raises(RuntimeError, match="Failed to initialize local API token"):
            security._get_or_create_local_api_token()

    @pytest.mark.parametrize(
        "endpoint",
        [
            "http://localhost:1234/v1",
            "http://127.0.0.1:1234/v1",
            "http://127.1.2.3:1234/v1",
            "http://[::1]:8765/v1",
            "http://model.localhost/v1",
        ],
    )
    def test_local_llm_endpoints(self, endpoint: str):
        assert security._is_local_endpoint(endpoint)
        assert security._llm_privacy_warning(endpoint) is None

    @pytest.mark.parametrize(
        "endpoint",
        [
            "https://example.com/v1",
            "http://192.168.1.2:1234/v1",
            "http://10.0.0.2:1234/v1",
            "not-a-url",
        ],
    )
    def test_remote_llm_endpoints_have_privacy_warning(self, endpoint: str):
        assert not security._is_local_endpoint(endpoint)

        warning = security._llm_privacy_warning(endpoint)
        assert warning is not None
        assert "不是 localhost" in warning

    def test_asr_privacy_warning_describes_full_audio_upload(self):
        assert security._asr_privacy_warning("http://127.0.0.1:8000/v1") is None

        warning = security._asr_privacy_warning("https://asr.example.com/v1")
        assert warning is not None
        assert "完整音频文件" in warning

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ("1", True),
            ("true", True),
            ("TRUE", True),
            ("yes", True),
            ("on", True),
            (" On ", True),
            ("", False),
            ("0", False),
            ("false", False),
            ("no", False),
            ("off", False),
            (None, False),
        ],
    )
    def test_setting_truthy(self, value: str | None, expected: bool):
        assert security._setting_truthy(value) is expected

    @pytest.mark.parametrize(
        ("path", "expected"),
        [
            ("/audio-items/1/file", True),
            ("/audio-items/1/cover", True),
            ("/audio-items/1/transcript/export", True),
            ("/playlists/1/export", True),
            ("/export/metadata", True),
            ("/logs/app/file", True),
            ("/settings", False),
            ("/audio-items", False),
            ("/audio-items/1", False),
            ("/audio-items/1/transcript", False),
            ("/logs/app", False),
        ],
    )
    def test_query_tokens_are_limited_to_media_and_download_paths(
        self,
        path: str,
        expected: bool,
    ):
        assert security._path_allows_query_token(path) is expected
