from pathlib import Path

import pytest
from sqlmodel import Session

from tests.api_test_support import ApiIntegrationTest
from app import local_security
from app.models import AITask, AudioItem, Setting


class TestLocalApiSecurity(ApiIntegrationTest):
    def test_token_origin_and_unsafe_method_guards(self):
        assert self.client.get('/health').status_code == 200

        missing_client = self.client.get("/auth/token")
        assert missing_client.status_code == 403
        assert missing_client.json()['detail']['code'] == 'security.missing_client'

        assert self.client.get('/settings').status_code == 401
        invalid_token = self.client.get(
            "/settings",
            headers={"X-Audux-Token": "not-the-token"},
        )
        assert invalid_token.status_code == 401

        protected = self.client.get(
            "/settings",
            headers=self.auth_headers(),
        )
        assert protected.status_code == 200

        query_token = self.client.get(
            f"/settings?access_token={self.token}",
        )
        assert query_token.status_code == 401

        download_query_token = self.client.get(
            f"/audio-items/999/file?access_token={self.token}",
        )
        assert download_query_token.status_code == 404

        forbidden_origin = self.client.get(
            "/settings",
            headers=self.auth_headers(origin="https://example.com"),
        )
        assert forbidden_origin.status_code == 403
        assert forbidden_origin.json()['detail']['code'] == 'security.forbidden_origin'

        allowed_origin = self.client.get(
            "/settings",
            headers=self.auth_headers(origin="http://localhost:5173"),
        )
        assert allowed_origin.status_code == 200
        assert allowed_origin.headers['access-control-allow-origin'] == 'http://localhost:5173'

        missing_unsafe_header = self.client.put(
            "/settings",
            headers=self.auth_headers(),
            json={"key": "scanner.hash_strategy", "value": "sampled"},
        )
        assert missing_unsafe_header.status_code == 403
        assert missing_unsafe_header.json()['detail']['code'] == 'security.missing_client'

        accepted = self.put_setting("scanner.hash_strategy", "sampled")
        assert accepted.status_code == 200
        assert accepted.json()['value'] == 'sampled'

    def test_settings_sections_are_validated_and_saved_as_a_group(self):
        values = {
            "llm.endpoint": "http://127.0.0.1:1234/v1",
            "llm.model_name": "local-model",
            "llm.api_key": "",
            "llm.timeout": "60",
            "llm.max_tokens": "800",
            "llm.temperature": "0.20",
            "llm.allow_remote_endpoint": "false",
            "ai.output_language": "auto",
        }
        saved = self.client.put(
            "/settings/llm",
            headers=self.auth_headers(include_client=True),
            json={"values": values},
        )

        assert saved.status_code == 200
        assert len(saved.json()) == len(values)
        with Session(self.engine) as session:
            assert session.get(Setting, "llm.model_name").value == "local-model"
            assert session.get(Setting, "llm.temperature").value == "0.20"

        invalid_values = {**values, "llm.model_name": "partial", "llm.timeout": ""}
        rejected = self.client.put(
            "/settings/llm",
            headers=self.auth_headers(include_client=True),
            json={"values": invalid_values},
        )
        assert rejected.status_code == 400
        assert rejected.json()["detail"]["code"] == "settings.invalid_value"
        with Session(self.engine) as session:
            assert session.get(Setting, "llm.model_name").value == "local-model"

    def test_token_file_is_private_and_not_stored_as_a_setting(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        token_path = Path(local_security.AUDUX_TOKEN_FILE)
        assert token_path.read_text(encoding='utf-8') == self.token

        token_path.unlink()

        restricted_paths = []

        def record_restriction(path: Path):
            restricted_paths.append(path)

        monkeypatch.setattr(
            local_security,
            "restrict_private_file",
            record_restriction,
        )
        replacement_token = local_security._get_or_create_local_api_token()

        assert replacement_token
        assert restricted_paths == [token_path]

        with Session(self.engine) as session:
            assert session.get(Setting, 'local_api_token') is None


class TestLibraryRootPathRestrictions(ApiIntegrationTest):
    def test_library_root_creation_validates_and_normalizes_directories(self):
        missing = self.root_path / "missing"
        missing_response = self.client.post(
            "/library-roots",
            headers=self.auth_headers(include_client=True),
            json={"path": str(missing)},
        )
        assert missing_response.status_code == 400
        assert missing_response.json()['detail']['code'] == 'library.invalid_directory'

        file_path = self.root_path / "not-a-directory"
        file_path.write_text("file", encoding="utf-8")
        file_response = self.client.post(
            "/library-roots",
            headers=self.auth_headers(include_client=True),
            json={"path": str(file_path)},
        )
        assert file_response.status_code == 400

        library = self.root_path / "library"
        library.mkdir()
        created = self.client.post(
            "/library-roots",
            headers=self.auth_headers(include_client=True),
            json={"path": str(library / ".")},
        )
        assert created.status_code == 200
        assert created.json()['path'] == str(library.resolve())

        duplicate = self.client.post(
            "/library-roots",
            headers=self.auth_headers(include_client=True),
            json={"path": str(library.resolve())},
        )
        assert duplicate.status_code == 409

    def test_relocate_rejects_paths_outside_configured_roots_and_symlink_escape(self):
        library = self.root_path / "library"
        root = self.add_library_root(library)
        original = library / "original.mp3"
        audio = self.add_audio(original, root_id=root.id)

        outside = self.root_path / "outside.mp3"
        outside.write_bytes(b"outside")

        outside_response = self.client.post(
            f"/audio-items/{audio.id}/relocate",
            headers=self.auth_headers(include_client=True),
            json={"file_path": str(outside)},
        )
        assert outside_response.status_code == 400
        assert outside_response.json()['detail']['code'] == 'audio.outside_library'

        symlink = library / "escaped.mp3"
        symlink.symlink_to(outside)
        symlink_response = self.client.post(
            f"/audio-items/{audio.id}/relocate",
            headers=self.auth_headers(include_client=True),
            json={"file_path": str(symlink)},
        )
        assert symlink_response.status_code == 400
        assert symlink_response.json()['detail']['code'] == 'audio.outside_library'

        replacement = library / "replacement.mp3"
        replacement.write_bytes(b"replacement")
        accepted = self.client.post(
            f"/audio-items/{audio.id}/relocate",
            headers=self.auth_headers(include_client=True),
            json={"file_path": str(replacement)},
        )
        assert accepted.status_code == 200
        assert accepted.json()['file_path'] == str(replacement.resolve())

        with Session(self.engine) as session:
            stored = session.get(AudioItem, audio.id)
            assert stored.library_root_id == root.id

    def test_transcribe_rejects_audio_outside_configured_roots(self):
        library = self.root_path / "library"
        self.add_library_root(library)
        outside = self.root_path / "outside.mp3"
        audio = self.add_audio(outside, root_id=None)

        response = self.client.post(
            f"/audio-items/{audio.id}/transcribe",
            headers=self.auth_headers(include_client=True),
        )

        assert response.status_code == 400
        assert response.json()['detail']['code'] == 'audio.outside_library'

    def test_delete_file_revalidates_library_boundary_and_cleans_up_after_commit(self):
        library = self.root_path / "library"
        root = self.add_library_root(library)
        inside = library / "inside.mp3"
        audio = self.add_audio(inside, root_id=root.id)

        deleted = self.client.request(
            "DELETE",
            f"/audio-items/{audio.id}?delete_file=true",
            headers=self.auth_headers(include_client=True),
        )
        assert deleted.status_code == 200, deleted.text
        assert deleted.json() == {
            "ok": True,
            "file_deleted": True,
            "cleanup_error": None,
        }
        assert not inside.exists()
        with Session(self.engine) as session:
            assert session.get(AudioItem, audio.id) is None

        outside = self.root_path / "outside.mp3"
        detached = self.add_audio(outside, root_id=None)
        rejected = self.client.request(
            "DELETE",
            f"/audio-items/{detached.id}?delete_file=true",
            headers=self.auth_headers(include_client=True),
        )
        assert rejected.status_code == 400, rejected.text
        assert rejected.json()["detail"]["code"] == "audio.outside_library"
        assert outside.is_file()
        with Session(self.engine) as session:
            assert session.get(AudioItem, detached.id) is not None

        busy_path = library / "busy.mp3"
        busy = self.add_audio(busy_path, root_id=root.id)
        with Session(self.engine) as session:
            session.add(
                AITask(audio_id=busy.id, task_type="transcribe", status="running")
            )
            session.commit()

        active_task_rejection = self.client.request(
            "DELETE",
            f"/audio-items/{busy.id}",
            headers=self.auth_headers(include_client=True),
        )
        assert active_task_rejection.status_code == 409
        assert active_task_rejection.json()["detail"]["code"] == (
            "audio.task_active_delete"
        )
        with Session(self.engine) as session:
            assert session.get(AudioItem, busy.id) is not None
