import unittest
from pathlib import Path
from unittest.mock import patch

from sqlmodel import Session

from tests.api_test_support import ApiIntegrationTestCase
from app import local_security
from app.models import AudioItem, Setting


class TestLocalApiSecurity(ApiIntegrationTestCase, unittest.TestCase):
    def test_token_origin_and_unsafe_method_guards(self):
        self.assertEqual(self.client.get("/health").status_code, 200)

        missing_client = self.client.get("/auth/token")
        self.assertEqual(missing_client.status_code, 403)
        self.assertEqual(missing_client.json()["detail"], "Missing local client header")

        self.assertEqual(self.client.get("/settings").status_code, 401)
        self.assertEqual(
            self.client.get(
                "/settings",
                headers={"X-Local-Audio-Token": "not-the-token"},
            ).status_code,
            401,
        )

        protected = self.client.get(
            "/settings",
            headers=self.auth_headers(),
        )
        self.assertEqual(protected.status_code, 200)

        query_token = self.client.get(
            f"/settings?access_token={self.token}",
        )
        self.assertEqual(query_token.status_code, 401)

        download_query_token = self.client.get(
            f"/audio-items/999/file?access_token={self.token}",
        )
        self.assertEqual(download_query_token.status_code, 404)

        forbidden_origin = self.client.get(
            "/settings",
            headers=self.auth_headers(origin="https://example.com"),
        )
        self.assertEqual(forbidden_origin.status_code, 403)
        self.assertEqual(forbidden_origin.json()["detail"], "Forbidden origin")

        allowed_origin = self.client.get(
            "/settings",
            headers=self.auth_headers(origin="http://localhost:5173"),
        )
        self.assertEqual(allowed_origin.status_code, 200)
        self.assertEqual(
            allowed_origin.headers["access-control-allow-origin"],
            "http://localhost:5173",
        )

        missing_unsafe_header = self.client.put(
            "/settings",
            headers=self.auth_headers(),
            json={"key": "scanner.hash_strategy", "value": "sampled"},
        )
        self.assertEqual(missing_unsafe_header.status_code, 403)
        self.assertEqual(
            missing_unsafe_header.json()["detail"],
            "Missing local client header",
        )

        accepted = self.put_setting("scanner.hash_strategy", "sampled")
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(accepted.json()["value"], "sampled")

    def test_token_file_is_private_and_not_stored_as_a_setting(self):
        token_path = Path(local_security.LOCAL_TOKEN_FILE)
        self.assertEqual(token_path.read_text(encoding="utf-8"), self.token)

        token_path.unlink()

        with patch.object(local_security.os, "chmod") as chmod:
            replacement_token = local_security._get_or_create_local_api_token()

        self.assertTrue(replacement_token)
        chmod.assert_called_once_with(token_path, 0o600)

        with Session(self.engine) as session:
            self.assertIsNone(session.get(Setting, "local_api_token"))


class TestLibraryRootPathRestrictions(ApiIntegrationTestCase, unittest.TestCase):
    def test_library_root_creation_validates_and_normalizes_directories(self):
        missing = self.root_path / "missing"
        missing_response = self.client.post(
            "/library-roots",
            headers=self.auth_headers(include_client=True),
            json={"path": str(missing)},
        )
        self.assertEqual(missing_response.status_code, 400)
        self.assertEqual(missing_response.json()["detail"], "Invalid directory")

        file_path = self.root_path / "not-a-directory"
        file_path.write_text("file", encoding="utf-8")
        file_response = self.client.post(
            "/library-roots",
            headers=self.auth_headers(include_client=True),
            json={"path": str(file_path)},
        )
        self.assertEqual(file_response.status_code, 400)

        library = self.root_path / "library"
        library.mkdir()
        created = self.client.post(
            "/library-roots",
            headers=self.auth_headers(include_client=True),
            json={"path": str(library / ".")},
        )
        self.assertEqual(created.status_code, 200)
        self.assertEqual(created.json()["path"], str(library.resolve()))

        duplicate = self.client.post(
            "/library-roots",
            headers=self.auth_headers(include_client=True),
            json={"path": str(library.resolve())},
        )
        self.assertEqual(duplicate.status_code, 409)

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
        self.assertEqual(outside_response.status_code, 400)
        self.assertIn("configured library root", outside_response.json()["detail"])

        symlink = library / "escaped.mp3"
        symlink.symlink_to(outside)
        symlink_response = self.client.post(
            f"/audio-items/{audio.id}/relocate",
            headers=self.auth_headers(include_client=True),
            json={"file_path": str(symlink)},
        )
        self.assertEqual(symlink_response.status_code, 400)
        self.assertIn("configured library root", symlink_response.json()["detail"])

        replacement = library / "replacement.mp3"
        replacement.write_bytes(b"replacement")
        accepted = self.client.post(
            f"/audio-items/{audio.id}/relocate",
            headers=self.auth_headers(include_client=True),
            json={"file_path": str(replacement)},
        )
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(accepted.json()["file_path"], str(replacement.resolve()))

        with Session(self.engine) as session:
            stored = session.get(AudioItem, audio.id)
            self.assertEqual(stored.library_root_id, root.id)

    def test_transcribe_rejects_audio_outside_configured_roots(self):
        library = self.root_path / "library"
        self.add_library_root(library)
        outside = self.root_path / "outside.mp3"
        audio = self.add_audio(outside, root_id=None)

        response = self.client.post(
            f"/audio-items/{audio.id}/transcribe",
            headers=self.auth_headers(include_client=True),
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("configured library root", response.json()["detail"])


if __name__ == "__main__":
    unittest.main()
