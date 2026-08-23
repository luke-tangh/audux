import sqlite3
import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlmodel import create_engine

TEST_RUNTIME_DIR = tempfile.TemporaryDirectory(
    prefix="audux-schema-module-test-"
)

with pytest.MonkeyPatch.context() as monkeypatch:
    monkeypatch.setattr(Path, "home", lambda: Path(TEST_RUNTIME_DIR.name))
    from app import db
    from app import models as _models


class TestDatabaseSchema:
    @pytest.fixture(autouse=True)
    def schema_context(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> Iterator[None]:
        self.db_path = tmp_path / "database.sqlite"
        self.engine = create_engine(
            f"sqlite:///{self.db_path}",
            connect_args={"check_same_thread": False},
        )
        monkeypatch.setattr(db, "DB_PATH", self.db_path)
        monkeypatch.setattr(db, "engine", self.engine)

        try:
            yield
        finally:
            self.engine.dispose()

    def test_fresh_database_creates_only_the_current_schema(self):
        db.create_db_and_tables()
        db.create_db_and_tables()

        with self.engine.connect() as connection:
            assert connection.execute(
                text("SELECT version FROM app_schema WHERE id = 1")
            ).scalar_one() == db.CURRENT_SCHEMA_VERSION

            tables = {
                row[0]
                for row in connection.execute(
                    text(
                        """
                        SELECT name FROM sqlite_master
                        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
                        """
                    )
                )
            }
            assert "schema_migrations" not in tables
            assert {
                "app_schema",
                "audio_items",
                "saved_views",
                "playlists",
                "library_health_tasks",
                "playback_events",
                "search_index",
                "transcript_chapters",
                "transcript_issues",
                "segment_search_index",
                "agent_conversations",
                "agent_messages",
                "agent_runs",
                "agent_run_steps",
                "agent_tool_calls",
                "agent_citations",
                "agent_operation_plans",
                "agent_operation_items",
                "agent_operation_audit_events",
                "mcp_audit_events",
            }.issubset(tables)

            indexes = {
                row[0]
                for row in connection.execute(
                    text(
                        """
                        SELECT name FROM sqlite_master
                        WHERE type = 'index'
                        """
                    )
                )
            }
            assert {
                "ix_audio_items_file_hash",
                "ux_ai_tasks_active",
                "ux_scan_tasks_active_root",
                "ux_saved_views_name_nocase",
                "ux_library_health_tasks_active_type",
                "ix_playback_events_audio_started",
                "ux_transcripts_current_audio",
                "ux_transcripts_audio_revision",
                "ux_transcript_segments_revision_index",
                "ux_transcript_chapters_revision_index",
                "ux_agent_runs_active_conversation",
                "ux_agent_run_steps_index",
                "ux_agent_operation_plan_run",
                "ux_agent_operation_item_index",
            }.issubset(indexes)

    def test_unmarked_database_is_rejected_without_changes(self):
        with sqlite3.connect(self.db_path) as connection:
            connection.execute("CREATE TABLE sentinel(value TEXT NOT NULL)")
            connection.execute("INSERT INTO sentinel VALUES ('untouched')")

        with pytest.raises(RuntimeError, match="does not use the schema required"):
            db.create_db_and_tables()

        with sqlite3.connect(self.db_path) as connection:
            assert connection.execute("SELECT value FROM sentinel").fetchone()[0] == (
                "untouched"
            )
            assert connection.execute(
                "SELECT 1 FROM sqlite_master WHERE name = 'app_schema'"
            ).fetchone() is None

    def test_different_schema_version_is_rejected_without_changes(self):
        with sqlite3.connect(self.db_path) as connection:
            connection.execute("CREATE TABLE sentinel(value TEXT NOT NULL)")
            connection.execute(
                """
                CREATE TABLE app_schema (
                    id INTEGER PRIMARY KEY,
                    version INTEGER NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                "INSERT INTO app_schema VALUES (1, ?, '2026-01-01')",
                (db.CURRENT_SCHEMA_VERSION + 1,),
            )
            connection.execute("INSERT INTO sentinel VALUES ('untouched')")

        with pytest.raises(RuntimeError, match="does not match this pre-release build"):
            db.create_db_and_tables()

        with sqlite3.connect(self.db_path) as connection:
            assert connection.execute("SELECT value FROM sentinel").fetchone()[0] == (
                "untouched"
            )

    def test_backup_closes_connections_before_replacing_temporary_file(
        self,
        monkeypatch: pytest.MonkeyPatch,
        tmp_path: Path,
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

        backup_path = tmp_path / "backup.sqlite"
        db._verified_sqlite_backup(self.db_path, backup_path)

        with original_connect(backup_path) as backup:
            assert backup.execute("SELECT value FROM sentinel").fetchone()[0] == (
                "preserved"
            )
