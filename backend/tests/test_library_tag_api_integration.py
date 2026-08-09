import pytest
from sqlmodel import Session, select

from tests.api_test_support import ApiIntegrationTest
from app.models import AudioTag, Tag
from app.services import library_service


class TestLibraryAndTagApi(ApiIntegrationTest):
    @pytest.fixture(autouse=True)
    def setup_library(self, api_test_context):
        self.library = self.root_path / "library"
        self.root = self.add_library_root(self.library)
        self.audio = self.add_audio(
            self.library / "existing.mp3",
            root_id=self.root.id,
        )

    def test_sync_scan_root_updates_existing_and_imports_new_audio(self):
        (self.library / "new.flac").write_bytes(b"new-audio")

        scanned = self.client.post(
            f"/library-roots/{self.root.id}/scan-sync",
            headers=self.auth_headers(include_client=True),
        )
        assert scanned.status_code == 200, scanned.text
        assert scanned.json() == {"imported": 1, "updated": 1, "missing": 0}

        disabled = self.client.request(
            "PATCH",
            f"/library-roots/{self.root.id}",
            headers=self.auth_headers(include_client=True),
            json={"is_enabled": False},
        )
        assert disabled.status_code == 200, disabled.text
        assert disabled.json()["is_enabled"] is False

        listed = self.client.get(
            "/library-roots",
            headers=self.auth_headers(),
        )
        assert listed.status_code == 200, listed.text
        assert [(row["id"], row["is_enabled"]) for row in listed.json()] == [
            (self.root.id, False)
        ]

    def test_scan_task_listing_cancel_and_conflict_lifecycle(self):
        with Session(self.engine) as session:
            pending = library_service.create_scan_task(session, self.root.id)
            pending_id = pending.id

        listed = self.client.get(
            f"/scan-tasks?root_id={self.root.id}&limit=1",
            headers=self.auth_headers(),
        )
        assert listed.status_code == 200, listed.text
        assert [task["id"] for task in listed.json()] == [pending_id]

        fetched = self.client.get(
            f"/scan-tasks/{pending_id}",
            headers=self.auth_headers(),
        )
        assert fetched.status_code == 200, fetched.text
        assert fetched.json()["status"] == "pending"

        canceled = self.client.post(
            f"/scan-tasks/{pending_id}/cancel",
            headers=self.auth_headers(include_client=True),
        )
        assert canceled.status_code == 200, canceled.text
        assert canceled.json()["status"] == "canceled"
        assert canceled.json()["finished_at"] is not None

        cannot_cancel = self.client.post(
            f"/scan-tasks/{pending_id}/cancel",
            headers=self.auth_headers(include_client=True),
        )
        assert cannot_cancel.status_code == 400, cannot_cancel.text
        assert cannot_cancel.json()["detail"]["code"] == "library.scan_cannot_cancel"

        with Session(self.engine) as session:
            running = library_service.create_scan_task(session, self.root.id)
            running.status = "running"
            session.add(running)
            session.commit()
            running_id = running.id

        conflict = self.client.post(
            f"/library-roots/{self.root.id}/scan",
            headers=self.auth_headers(include_client=True),
        )
        assert conflict.status_code == 409, conflict.text
        assert conflict.json()["detail"]["code"] == "library.scan_active"

        requested = self.client.post(
            f"/scan-tasks/{running_id}/cancel",
            headers=self.auth_headers(include_client=True),
        )
        assert requested.status_code == 200, requested.text
        assert requested.json()["status"] == "cancel_requested"

        requested_again = self.client.post(
            f"/scan-tasks/{running_id}/cancel",
            headers=self.auth_headers(include_client=True),
        )
        assert requested_again.status_code == 200, requested_again.text
        assert requested_again.json()["status"] == "cancel_requested"

        missing = self.client.get(
            "/scan-tasks/999999",
            headers=self.auth_headers(),
        )
        assert missing.status_code == 404, missing.text

    def test_tag_add_rename_remove_and_force_delete_lifecycle(self):
        headers = self.auth_headers(include_client=True)
        added = self.client.post(
            f"/audio-items/{self.audio.id}/tags",
            headers=headers,
            json={"tags": [" alpha ", "", "alpha", "beta"], "source": "user"},
        )
        assert added.status_code == 200, added.text
        added_tags = added.json()
        assert all("name" in tag for tag in added_tags), added_tags
        assert [tag["name"] for tag in added_tags] == ["alpha", "alpha", "beta"]

        listed = self.client.get("/tags", headers=self.auth_headers())
        assert [tag["name"] for tag in listed.json()] == ["alpha", "beta"]
        alpha_id, beta_id = [tag["id"] for tag in listed.json()]

        with Session(self.engine) as session:
            links = session.exec(
                select(AudioTag).where(AudioTag.audio_id == self.audio.id)
            ).all()
            assert {link.tag_id for link in links} == {alpha_id, beta_id}

        empty_name = self.client.request(
            "PATCH",
            f"/tags/{beta_id}",
            headers=headers,
            json={"name": "   "},
        )
        assert empty_name.status_code == 400, empty_name.text
        assert empty_name.json()["detail"]["code"] == "tag.name_required"

        duplicate_name = self.client.request(
            "PATCH",
            f"/tags/{beta_id}",
            headers=headers,
            json={"name": "alpha"},
        )
        assert duplicate_name.status_code == 409, duplicate_name.text
        assert duplicate_name.json()["detail"]["code"] == "tag.name_exists"

        renamed = self.client.request(
            "PATCH",
            f"/tags/{beta_id}",
            headers=headers,
            json={"name": " gamma "},
        )
        assert renamed.status_code == 200, renamed.text
        assert renamed.json()["name"] == "gamma"

        blocked = self.client.request(
            "DELETE",
            f"/tags/{beta_id}",
            headers=headers,
        )
        assert blocked.status_code == 400, blocked.text
        assert blocked.json()["detail"]["code"] == "tag.in_use"

        forced = self.client.request(
            "DELETE",
            f"/tags/{beta_id}?force=true",
            headers=headers,
        )
        assert forced.status_code == 200, forced.text
        assert forced.json() == {"ok": True, "affected_audio_items": 1}

        removed = self.client.request(
            "DELETE",
            f"/audio-items/{self.audio.id}/tags/{alpha_id}",
            headers=headers,
        )
        assert removed.status_code == 200, removed.text

        missing_relation = self.client.request(
            "DELETE",
            f"/audio-items/{self.audio.id}/tags/{alpha_id}",
            headers=headers,
        )
        assert missing_relation.status_code == 404, missing_relation.text

        deleted = self.client.request(
            "DELETE",
            f"/tags/{alpha_id}",
            headers=headers,
        )
        assert deleted.status_code == 200, deleted.text
        with Session(self.engine) as session:
            assert session.exec(select(Tag)).all() == []

    def test_tag_validation_errors_are_structured(self):
        headers = self.auth_headers(include_client=True)
        with Session(self.engine) as session:
            tag = Tag(name="source")
            session.add(tag)
            session.commit()
            session.refresh(tag)
            tag_id = tag.id

        same = self.client.post(
            f"/tags/{tag_id}/merge",
            headers=headers,
            json={"target_tag_id": tag_id},
        )
        assert same.status_code == 400, same.text
        assert same.json()["detail"]["code"] == "tag.same_source_target"

        missing_target = self.client.post(
            f"/tags/{tag_id}/merge",
            headers=headers,
            json={"target_tag_id": 999999},
        )
        assert missing_target.status_code == 404, missing_target.text
        assert missing_target.json()["detail"]["code"] == "tag.target_not_found"

        missing_source = self.client.post(
            "/tags/999998/merge",
            headers=headers,
            json={"target_tag_id": tag_id},
        )
        assert missing_source.status_code == 404, missing_source.text
        assert missing_source.json()["detail"]["code"] == "tag.source_not_found"

        missing_audio = self.client.post(
            "/audio-items/999999/tags",
            headers=headers,
            json={"tags": ["new"], "source": "user"},
        )
        assert missing_audio.status_code == 404, missing_audio.text
