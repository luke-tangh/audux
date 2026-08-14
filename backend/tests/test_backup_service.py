import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlmodel import SQLModel, Session, create_engine, select

from app import db
from app.models import (
    AITask,
    AudioItem,
    AudioTag,
    LibraryHealthTask,
    LibraryRoot,
    Playlist,
    PlaylistItem,
    ScanTask,
    Setting,
    Tag,
    Transcript,
)
from app.services import backup_service


class TestDatabaseBackupService:
    @pytest.fixture(autouse=True)
    def backup_context(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> Iterator[None]:
        self.data_dir = tmp_path / "data"
        self.data_dir.mkdir()
        self.db_path = self.data_dir / "database.sqlite"
        self.backups_dir = self.data_dir / "backups"
        self.engine = create_engine(
            f"sqlite:///{self.db_path}",
            connect_args={"check_same_thread": False},
        )
        SQLModel.metadata.create_all(self.engine)
        with self.engine.begin() as connection:
            connection.execute(
                text(
                    """
                    CREATE TABLE app_schema (
                        id INTEGER PRIMARY KEY,
                        version INTEGER NOT NULL,
                        created_at TEXT NOT NULL
                    )
                    """
                )
            )
            connection.execute(
                text(
                    """
                    INSERT INTO app_schema(id, version, created_at)
                    VALUES (1, :version, '2026-08-10T00:00:00')
                    """
                ),
                {"version": db.CURRENT_SCHEMA_VERSION},
            )

        monkeypatch.setattr(db, "DB_PATH", self.db_path)
        monkeypatch.setattr(db, "BACKUPS_DIR", self.backups_dir)
        monkeypatch.setattr(db, "engine", self.engine)
        monkeypatch.setattr(backup_service, "BACKUPS_DIR", self.backups_dir)
        monkeypatch.setattr(
            backup_service,
            "PENDING_RESTORE_PATH",
            self.data_dir / "pending-database-restore.json",
        )
        monkeypatch.setattr(
            backup_service,
            "RESTORE_RESULT_PATH",
            self.data_dir / "database-restore-result.json",
        )

        try:
            yield
        finally:
            self.engine.dispose()

    def set_value(self, value: str) -> None:
        with Session(self.engine) as session:
            setting = session.get(Setting, "test.value")
            if setting:
                setting.value = value
            else:
                setting = Setting(key="test.value", value=value)
            session.add(setting)
            session.commit()

    def get_value(self) -> str | None:
        with Session(self.engine) as session:
            setting = session.get(Setting, "test.value")
            return setting.value if setting else None

    def create_backup(self, name: str = "测试快照") -> dict:
        with Session(self.engine) as session:
            return backup_service.create_database_backup(session, name)

    def seed_library_data(self) -> None:
        with Session(self.engine) as session:
            root = LibraryRoot(path=str(self.data_dir / "library"))
            audio = AudioItem(
                file_path=str(self.data_dir / "library" / "episode.mp3"),
                file_name="episode.mp3",
                title_user="快照音频",
            )
            tag = Tag(name="快照标签")
            playlist = Playlist(name="快照列表")
            session.add_all([root, audio, tag, playlist])
            session.commit()
            session.refresh(root)
            session.refresh(audio)
            session.refresh(tag)
            session.refresh(playlist)
            audio.library_root_id = root.id
            session.add_all(
                [
                    audio,
                    AudioTag(audio_id=audio.id, tag_id=tag.id),
                    PlaylistItem(
                        playlist_id=playlist.id,
                        audio_id=audio.id,
                        order_index=0,
                    ),
                    Transcript(audio_id=audio.id, full_text="快照转写"),
                    AITask(audio_id=audio.id, task_type="analyze", status="done"),
                    ScanTask(root_id=root.id, status="done"),
                ]
            )
            session.commit()

    def test_create_list_validate_delete_and_reject_unsafe_ids(self):
        self.set_value("preserved")
        created = self.create_backup("整理标签之前")

        assert created["name"] == "整理标签之前"
        assert created["integrity_status"] == "valid"
        assert created["restore_compatible"] is True
        assert created["schema_version"] == db.CURRENT_SCHEMA_VERSION
        assert len(backup_service.list_database_backups()) == 1

        validated = backup_service.validate_database_backup(created["id"])
        assert validated["sha256"] == created["sha256"]

        with pytest.raises(backup_service.ServiceError, match="Invalid database backup id"):
            backup_service.delete_database_backup("../database.sqlite")

        assert backup_service.delete_database_backup(created["id"]) == {
            "ok": True,
            "id": created["id"],
        }
        assert backup_service.list_database_backups() == []

    def test_corrupt_and_different_schema_snapshots_are_not_restorable(self):
        corrupted = self.create_backup()
        (self.backups_dir / corrupted["id"]).write_bytes(b"not a sqlite database")
        checked = backup_service.validate_database_backup(corrupted["id"])
        assert checked["integrity_status"] == "invalid"
        assert checked["restore_compatible"] is False

        future_path = self.backups_dir / "database.manual-future.sqlite"
        with Session(create_engine(f"sqlite:///{future_path}")) as session:
            session.exec(
                text(
                    "CREATE TABLE app_schema (id INTEGER PRIMARY KEY, version INTEGER, created_at TEXT)"
                )
            )
            session.exec(
                text(
                    "INSERT INTO app_schema VALUES (1, 2, '2026-08-10')"
                )
            )
            session.commit()

        future = backup_service.validate_database_backup(future_path.name)
        assert future["integrity_status"] == "valid"
        assert future["restore_compatible"] is False
        assert "does not match" in str(future["compatibility_error"])

    def test_preflight_blocks_active_tasks_and_pending_snapshots_are_protected(self):
        backup = self.create_backup()
        with Session(self.engine) as session:
            session.add(AITask(audio_id=999, task_type="analyze", status="running"))
            session.add(LibraryHealthTask(task_type="health_check", status="running"))
            session.commit()
            blocked = backup_service.restore_preflight(session, backup["id"])
            assert blocked["ok"] is False
            assert blocked["active_ai_tasks"] == 1
            assert blocked["active_health_tasks"] == 1

            task = session.exec(select(AITask)).one()
            task.status = "done"
            session.add(task)
            health_task = session.exec(select(LibraryHealthTask)).one()
            health_task.status = "done"
            session.add(health_task)
            session.commit()
            pending = backup_service.schedule_database_restore(session, backup["id"])

        assert pending["status"] == "pending"
        assert backup_service.PENDING_RESTORE_PATH.is_file()
        with pytest.raises(backup_service.ServiceError, match="required by the pending"):
            backup_service.delete_database_backup(backup["id"])
        with pytest.raises(backup_service.ServiceError, match="required by the pending"):
            backup_service.delete_database_backup(pending["safety_snapshot_id"])

        assert backup_service.cancel_pending_database_restore() == {"ok": True}
        assert not backup_service.PENDING_RESTORE_PATH.exists()
        assert (self.backups_dir / pending["safety_snapshot_id"]).is_file()

    def test_restart_applies_restore_and_keeps_pre_restore_safety_snapshot(self):
        self.set_value("snapshot")
        self.seed_library_data()
        backup = self.create_backup("目标快照")
        self.set_value("current")
        with Session(self.engine) as session:
            pending = backup_service.schedule_database_restore(session, backup["id"])
        self.set_value("latest-before-restart")

        backup_service.initialize_database_with_pending_restore()

        assert self.get_value() == "snapshot"
        with Session(self.engine) as session:
            assert session.exec(select(AudioItem.title_user)).one() == "快照音频"
            assert session.exec(select(Tag.name)).one() == "快照标签"
            assert session.exec(select(Playlist.name)).one() == "快照列表"
            assert session.exec(select(Transcript.full_text)).one() == "快照转写"
            assert len(session.exec(select(AITask)).all()) == 1
            assert len(session.exec(select(ScanTask)).all()) == 1
        assert not backup_service.PENDING_RESTORE_PATH.exists()
        assert (self.backups_dir / pending["safety_snapshot_id"]).is_file()
        safety_engine = create_engine(
            f"sqlite:///{self.backups_dir / pending['safety_snapshot_id']}"
        )
        try:
            with Session(safety_engine) as safety_session:
                safety_value = safety_session.get(Setting, "test.value")
                assert safety_value is not None
                assert safety_value.value == "latest-before-restart"
        finally:
            safety_engine.dispose()
        result = json.loads(backup_service.RESTORE_RESULT_PATH.read_text())
        assert result["status"] == "succeeded"

    def test_failed_restored_database_initialization_rolls_back_current_data(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        self.set_value("snapshot")
        backup = self.create_backup("目标快照")
        self.set_value("current")
        with Session(self.engine) as session:
            backup_service.schedule_database_restore(session, backup["id"])

        original_initialize = db.create_db_and_tables
        calls = 0

        def fail_restored_database_once():
            nonlocal calls
            calls += 1
            if calls == 1:
                raise RuntimeError("injected restored database failure")
            original_initialize()

        monkeypatch.setattr(db, "create_db_and_tables", fail_restored_database_once)
        backup_service.initialize_database_with_pending_restore()

        assert self.get_value() == "current"
        result = json.loads(backup_service.RESTORE_RESULT_PATH.read_text())
        assert result["status"] == "rolled_back"
        assert "injected" in result["error"]
