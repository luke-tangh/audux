from collections.abc import Iterator
from pathlib import Path

import pytest

from app.services import backup_service
from tests.api_test_support import ApiIntegrationTest


class TestBackupApiIntegration(ApiIntegrationTest):
    @pytest.fixture(autouse=True)
    def backup_api_paths(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> Iterator[None]:
        backups_dir = tmp_path / "managed-backups"
        monkeypatch.setattr(backup_service, "BACKUPS_DIR", backups_dir)
        monkeypatch.setattr(
            backup_service,
            "PENDING_RESTORE_PATH",
            tmp_path / "pending-database-restore.json",
        )
        monkeypatch.setattr(
            backup_service,
            "RESTORE_RESULT_PATH",
            tmp_path / "database-restore-result.json",
        )
        yield

    def test_backup_create_validate_restore_schedule_cancel_and_delete(self):
        created_response = self.client.post(
            "/maintenance/database-backups",
            headers=self.auth_headers(include_client=True),
            json={"name": "API 快照"},
        )
        assert created_response.status_code == 200, created_response.text
        created = created_response.json()
        assert created["name"] == "API 快照"
        assert created["integrity_status"] == "valid"

        listed = self.client.get(
            "/maintenance/database-backups",
            headers=self.auth_headers(),
        )
        assert listed.status_code == 200
        assert [row["id"] for row in listed.json()] == [created["id"]]

        validated = self.client.post(
            f"/maintenance/database-backups/{created['id']}/validate",
            headers=self.auth_headers(include_client=True),
        )
        assert validated.status_code == 200
        assert validated.json()["sha256"] == created["sha256"]

        preflight = self.client.post(
            f"/maintenance/database-backups/{created['id']}/restore/preflight",
            headers=self.auth_headers(include_client=True),
        )
        assert preflight.status_code == 200, preflight.text
        assert preflight.json()["ok"] is True

        scheduled = self.client.post(
            f"/maintenance/database-backups/{created['id']}/restore",
            headers=self.auth_headers(include_client=True),
        )
        assert scheduled.status_code == 200, scheduled.text
        assert scheduled.json()["restart_required"] is True

        protected_delete = self.client.request(
            "DELETE",
            f"/maintenance/database-backups/{created['id']}",
            headers=self.auth_headers(include_client=True),
        )
        assert protected_delete.status_code == 409
        assert protected_delete.json()["detail"]["code"] == "backup.pending_snapshot"

        status = self.client.get(
            "/maintenance/database-restore",
            headers=self.auth_headers(),
        )
        assert status.status_code == 200
        assert status.json()["pending"]["snapshot_id"] == created["id"]

        canceled = self.client.request(
            "DELETE",
            "/maintenance/database-restore/pending",
            headers=self.auth_headers(include_client=True),
        )
        assert canceled.status_code == 200

        deleted = self.client.request(
            "DELETE",
            f"/maintenance/database-backups/{created['id']}",
            headers=self.auth_headers(include_client=True),
        )
        assert deleted.status_code == 200

    def test_mutating_backup_routes_require_local_client_header(self):
        response = self.client.post(
            "/maintenance/database-backups",
            headers=self.auth_headers(),
            json={"name": "blocked"},
        )
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "security.missing_client"

    def test_prepare_application_update_creates_safety_snapshot(self):
        response = self.client.post(
            "/maintenance/application-update/prepare",
            headers=self.auth_headers(include_client=True),
            json={"target_version": "1.0.1"},
        )
        assert response.status_code == 200, response.text
        prepared = response.json()
        assert prepared["ok"] is True
        assert prepared["target_version"] == "1.0.1"
        assert prepared["backup"]["kind"] == "pre_update"
        assert prepared["backup"]["integrity_status"] == "valid"

    def test_prepare_application_update_validates_version(self):
        response = self.client.post(
            "/maintenance/application-update/prepare",
            headers=self.auth_headers(include_client=True),
            json={"target_version": "not a version"},
        )
        assert response.status_code == 422
