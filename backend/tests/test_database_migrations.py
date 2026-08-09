import sqlite3
import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlmodel import SQLModel, Session, create_engine

TEST_RUNTIME_DIR = tempfile.TemporaryDirectory(
    prefix="local-audio-migration-module-test-"
)

with pytest.MonkeyPatch.context() as monkeypatch:
    monkeypatch.setattr(Path, "home", lambda: Path(TEST_RUNTIME_DIR.name))
    from app import db
    from app.models import (
        AITask,
        AudioItem,
        AudioTag,
        LibraryRoot,
        Playlist,
        PlaylistItem,
        ScanTask,
        Tag,
        Transcript,
    )


class TestDatabaseMigrations:
    @pytest.fixture(autouse=True)
    def migration_context(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> Iterator[None]:
        self.root = tmp_path
        self.db_path = self.root / "database.sqlite"
        self.backups_dir = self.root / "backups"
        self.engine = create_engine(
            f"sqlite:///{self.db_path}",
            connect_args={"check_same_thread": False},
        )
        monkeypatch.setattr(db, "DB_PATH", self.db_path)
        monkeypatch.setattr(db, "BACKUPS_DIR", self.backups_dir)
        monkeypatch.setattr(db, "engine", self.engine)

        try:
            yield
        finally:
            self.engine.dispose()

    def seed_v4_database(self):
        SQLModel.metadata.create_all(self.engine)

        with self.engine.begin() as connection:
            connection.execute(
                text(
                    """
                    CREATE TABLE schema_migrations (
                        version INTEGER PRIMARY KEY,
                        name TEXT NOT NULL,
                        applied_at TEXT NOT NULL
                    )
                    """
                )
            )
            for version in range(1, 5):
                connection.execute(
                    text(
                        """
                        INSERT INTO schema_migrations(version, name, applied_at)
                        VALUES (:version, :name, '2026-01-01T00:00:00')
                        """
                    ),
                    {"version": version, "name": f"migration-{version}"},
                )

        with Session(self.engine) as session:
            root = LibraryRoot(path=str(self.root / "library"))
            session.add(root)
            session.commit()
            session.refresh(root)

            audio = AudioItem(
                file_path=str(self.root / "library" / "example.mp3"),
                file_name="example.mp3",
                library_root_id=root.id,
                title_user="升级测试音频",
            )
            tag = Tag(name="保留标签")
            playlist = Playlist(name="保留列表")
            session.add_all([audio, tag, playlist])
            session.commit()
            session.refresh(audio)
            session.refresh(tag)
            session.refresh(playlist)

            session.add_all(
                [
                    AudioTag(audio_id=audio.id, tag_id=tag.id),
                    PlaylistItem(
                        playlist_id=playlist.id,
                        audio_id=audio.id,
                        order_index=0,
                    ),
                    Transcript(audio_id=audio.id, full_text="需要保留的转写内容"),
                    AITask(audio_id=audio.id, task_type="analyze", status="pending"),
                    AITask(audio_id=audio.id, task_type="analyze", status="running"),
                    ScanTask(root_id=root.id, status="pending"),
                    ScanTask(root_id=root.id, status="running"),
                ]
            )
            session.commit()

    def test_v4_upgrade_creates_verified_backup_and_preserves_data(self):
        self.seed_v4_database()

        db.create_db_and_tables()

        backup_paths = list(self.backups_dir.glob("*.sqlite"))
        assert len(backup_paths) == 1
        assert 'pre-migration-v4-to-v9' in backup_paths[0].name

        with sqlite3.connect(backup_paths[0]) as backup:
            assert backup.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
            assert backup.execute('SELECT MAX(version) FROM schema_migrations').fetchone()[0] == 4
            active_tasks = backup.execute(
                "SELECT COUNT(*) FROM ai_tasks WHERE status IN ('pending', 'running')"
            ).fetchone()[0]
            assert active_tasks == 2

        with self.engine.connect() as connection:
            schema_version = connection.execute(
                text("SELECT MAX(version) FROM schema_migrations")
            ).scalar_one()
            assert schema_version == db.CURRENT_SCHEMA_VERSION
            assert connection.execute(
                text("SELECT title_user FROM audio_items")
            ).scalar_one() == "升级测试音频"
            assert connection.execute(text('SELECT name FROM tags')).scalar_one() == '保留标签'
            assert connection.execute(text('SELECT name FROM playlists')).scalar_one() == '保留列表'
            assert connection.execute(
                text("SELECT full_text FROM transcripts")
            ).scalar_one() == "需要保留的转写内容"
            assert connection.execute(
                text(
                    """
                    SELECT COUNT(*) FROM ai_tasks
                    WHERE status IN ('pending', 'running', 'cancel_requested')
                    """
                )
            ).scalar_one() == 1
            ai_task_columns = {
                row[1] for row in connection.execute(text("PRAGMA table_info(ai_tasks)"))
            }
            scan_task_columns = {
                row[1] for row in connection.execute(text("PRAGMA table_info(scan_tasks)"))
            }
            assert {"error_code", "error_params"}.issubset(ai_task_columns)
            assert {"error_code", "error_params"}.issubset(scan_task_columns)
            saved_view_columns = {
                row[1] for row in connection.execute(text("PRAGMA table_info(saved_views)"))
            }
            assert {
                "id",
                "name",
                "query_json",
                "schema_version",
                "sort_order",
                "created_at",
                "updated_at",
            }.issubset(saved_view_columns)
            saved_view_indexes = {
                row[1] for row in connection.execute(text("PRAGMA index_list(saved_views)"))
            }
            assert "ux_saved_views_name_nocase" in saved_view_indexes
            assert "ix_saved_views_sort_order" in saved_view_indexes
            playlist_columns = {
                row[1] for row in connection.execute(text("PRAGMA table_info(playlists)"))
            }
            assert {
                "kind",
                "query_json",
                "query_schema_version",
                "last_refreshed_at",
            }.issubset(playlist_columns)
            playlist_indexes = {
                row[1] for row in connection.execute(text("PRAGMA index_list(playlists)"))
            }
            assert "ix_playlists_kind" in playlist_indexes
            assert connection.execute(
                text(
                    """
                    SELECT COUNT(*) FROM scan_tasks
                    WHERE status IN ('pending', 'running', 'cancel_requested')
                    """
                )
            ).scalar_one() == 1

        db.create_db_and_tables()
        assert len(list(self.backups_dir.glob('*.sqlite'))) == 1

    def test_v9_adds_smart_playlist_columns_to_a_v8_playlist_table(self):
        with self.engine.begin() as connection:
            connection.execute(
                text(
                    """
                    CREATE TABLE schema_migrations (
                        version INTEGER PRIMARY KEY,
                        name TEXT NOT NULL,
                        applied_at TEXT NOT NULL
                    )
                    """
                )
            )
            for version in range(1, 9):
                connection.execute(
                    text(
                        """
                        INSERT INTO schema_migrations(version, name, applied_at)
                        VALUES (:version, :name, '2026-01-01T00:00:00')
                        """
                    ),
                    {"version": version, "name": f"migration-{version}"},
                )
            connection.execute(
                text(
                    """
                    CREATE TABLE playlists (
                        id INTEGER PRIMARY KEY,
                        name TEXT NOT NULL,
                        description TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """
                )
            )
            connection.execute(
                text(
                    """
                    INSERT INTO playlists(name, created_at, updated_at)
                    VALUES ('旧手动列表', '2026-01-01T00:00:00', '2026-01-01T00:00:00')
                    """
                )
            )

        db.run_migrations()
        db.run_migrations()

        with self.engine.connect() as connection:
            columns = {
                row[1] for row in connection.execute(text("PRAGMA table_info(playlists)"))
            }
            assert {
                "kind",
                "query_json",
                "query_schema_version",
                "last_refreshed_at",
            }.issubset(columns)
            row = connection.execute(
                text("SELECT name, kind, query_json FROM playlists")
            ).one()
            assert row == ("旧手动列表", "manual", None)
            assert connection.execute(
                text("SELECT MAX(version) FROM schema_migrations")
            ).scalar_one() == 9

    def test_backup_failure_prevents_schema_changes(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        self.seed_v4_database()

        def fail_backup(*args, **kwargs):
            raise OSError("backup destination unavailable")

        monkeypatch.setattr(db, "_verified_sqlite_backup", fail_backup)
        with pytest.raises(OSError, match="backup destination unavailable"):
            db.create_db_and_tables()

        with self.engine.connect() as connection:
            assert connection.execute(
                text("SELECT MAX(version) FROM schema_migrations")
            ).scalar_one() == 4

    def test_backup_closes_sqlite_connections_before_replacing_temporary_file(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        with sqlite3.connect(self.db_path) as connection:
            connection.execute("CREATE TABLE sentinel(value TEXT NOT NULL)")
            connection.execute("INSERT INTO sentinel VALUES ('preserved')")

        opened_connections: list[sqlite3.Connection] = []
        original_connect = sqlite3.connect
        original_replace = Path.replace

        def tracked_connect(*args, **kwargs):
            connection = original_connect(*args, **kwargs)
            opened_connections.append(connection)
            return connection

        def replace_after_connections_close(path: Path, target: Path):
            assert len(opened_connections) == 3
            for connection in opened_connections:
                with pytest.raises(sqlite3.ProgrammingError, match="closed"):
                    connection.execute("SELECT 1")
            return original_replace(path, target)

        monkeypatch.setattr(db.sqlite3, "connect", tracked_connect)
        monkeypatch.setattr(Path, "replace", replace_after_connections_close)

        backup_path = self.backups_dir / "database.sqlite"
        self.backups_dir.mkdir()
        db._verified_sqlite_backup(self.db_path, backup_path)

        with original_connect(backup_path) as backup:
            assert backup.execute("SELECT value FROM sentinel").fetchone()[0] == (
                "preserved"
            )

    def test_newer_schema_is_never_modified(self):
        with sqlite3.connect(self.db_path) as connection:
            connection.execute("CREATE TABLE sentinel(value TEXT NOT NULL)")
            connection.execute(
                """
                CREATE TABLE schema_migrations (
                    version INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    applied_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                "INSERT INTO schema_migrations VALUES (99, 'future', '2026-01-01')"
            )
            connection.execute("INSERT INTO sentinel VALUES ('untouched')")
            connection.commit()

        with pytest.raises(RuntimeError, match="newer than this application"):
            db.create_db_and_tables()

        with sqlite3.connect(self.db_path) as connection:
            assert connection.execute("SELECT value FROM sentinel").fetchone()[0] == (
                "untouched"
            )
