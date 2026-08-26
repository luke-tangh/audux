import logging
import os
import sqlite3
from contextlib import closing
from pathlib import Path

from sqlalchemy import event, text
from sqlmodel import SQLModel, Session, create_engine

from .time_utils import utc_now_iso


logger = logging.getLogger(__name__)
CURRENT_SCHEMA_VERSION = 6


def _ensure_private_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if os.name != "nt":
        try:
            path.chmod(0o700)
        except OSError:
            logger.warning("Could not restrict directory permissions: %s", path)


def restrict_private_file(path: Path) -> None:
    if os.name == "nt" or not path.exists():
        return
    try:
        path.chmod(0o600)
    except OSError:
        logger.warning("Could not restrict file permissions: %s", path)


APP_DATA_DIR = Path.home() / ".audux"
_ensure_private_directory(APP_DATA_DIR)

COVERS_DIR = APP_DATA_DIR / "covers"
_ensure_private_directory(COVERS_DIR)

LOGS_DIR = APP_DATA_DIR / "logs"
_ensure_private_directory(LOGS_DIR)

EXPORTS_DIR = APP_DATA_DIR / "exports"
_ensure_private_directory(EXPORTS_DIR)

BACKUPS_DIR = APP_DATA_DIR / "backups"
_ensure_private_directory(BACKUPS_DIR)

COMPONENTS_DIR = APP_DATA_DIR / "components"
_ensure_private_directory(COMPONENTS_DIR)

MODELS_DIR = APP_DATA_DIR / "models"
_ensure_private_directory(MODELS_DIR)

DB_PATH = APP_DATA_DIR / "database.sqlite"
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(
    DATABASE_URL,
    echo=False,
    connect_args={
        "check_same_thread": False,
        "timeout": 30,
    },
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=30000")
    cursor.close()


def get_session():
    with Session(engine) as session:
        yield session


def create_db_and_tables():
    schema_version = _database_schema_version(DB_PATH)
    if schema_version is not None and schema_version != CURRENT_SCHEMA_VERSION:
        raise RuntimeError(
            "Database schema version "
            f"{schema_version} is not supported by this Audux build "
            f"(required: {CURRENT_SCHEMA_VERSION}). The database was not modified."
        )

    SQLModel.metadata.create_all(engine)
    _write_current_schema_marker()
    create_current_schema_objects()
    for path in (
        DB_PATH,
        DB_PATH.with_name(DB_PATH.name + "-wal"),
        DB_PATH.with_name(DB_PATH.name + "-shm"),
    ):
        restrict_private_file(path)


def _database_schema_version(path: Path) -> int | None:
    """Return the schema version for a current-format database."""
    if not path.exists() or path.stat().st_size == 0:
        return None

    uri = f"file:{path.resolve().as_posix()}?mode=ro"

    with sqlite3.connect(uri, uri=True) as conn:
        user_table = conn.execute(
            """
            SELECT 1
            FROM sqlite_master
            WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
            LIMIT 1
            """
        ).fetchone()

        if user_table is None:
            return None

        schema_table = conn.execute(
            """
            SELECT 1
            FROM sqlite_master
            WHERE type = 'table' AND name = 'app_schema'
            """
        ).fetchone()

        if schema_table is None:
            raise RuntimeError(
                "Database schema version marker is missing. The database was not modified."
            )

        rows = conn.execute("SELECT version FROM app_schema WHERE id = 1").fetchall()
        if len(rows) != 1:
            raise RuntimeError("Database schema marker is invalid.")
        return int(rows[0][0])


def _verified_sqlite_backup(source_path: Path, destination_path: Path):
    temporary_path = destination_path.with_suffix(destination_path.suffix + ".tmp")

    try:
        # sqlite3 connections used as context managers only commit or roll back;
        # they do not close. Windows cannot replace the temporary backup while
        # either the destination or verification connection still has it open.
        with closing(sqlite3.connect(source_path)) as source:
            with closing(sqlite3.connect(temporary_path)) as destination:
                source.backup(destination)

        with closing(sqlite3.connect(temporary_path)) as verification:
            result = verification.execute("PRAGMA quick_check").fetchone()
            if result is None or result[0] != "ok":
                raise RuntimeError(f"Database backup verification failed: {result}")

        temporary_path.replace(destination_path)

        try:
            destination_path.chmod(0o600)
        except OSError:
            logger.debug(
                "Could not restrict database backup permissions: %s",
                destination_path,
            )
    except Exception:
        try:
            temporary_path.unlink(missing_ok=True)
        except OSError:
            logger.warning(
                "Could not remove failed temporary database backup: %s",
                temporary_path,
                exc_info=True,
            )
        raise


def create_fts_tables(bind=None):
    target = bind or engine
    with target.begin() as conn:
        conn.execute(
            text(
                """
                CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
                    audio_id UNINDEXED,
                    title,
                    author,
                    description,
                    tags,
                    transcript
                );
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE VIRTUAL TABLE IF NOT EXISTS segment_search_index USING fts5(
                    audio_id UNINDEXED,
                    transcript_id UNINDEXED,
                    segment_id UNINDEXED,
                    segment_index UNINDEXED,
                    start_seconds UNINDEXED,
                    end_seconds UNINDEXED,
                    title,
                    author,
                    description,
                    tags,
                    transcript
                );
                """
            )
        )


def _write_current_schema_marker():
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS app_schema (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    version INTEGER NOT NULL,
                    created_at TEXT NOT NULL
                );
                """
            )
        )
        conn.execute(
            text(
                """
                INSERT INTO app_schema(id, version, created_at)
                VALUES (1, :version, :created_at)
                ON CONFLICT(id) DO NOTHING;
                """
            ),
            {
                "version": CURRENT_SCHEMA_VERSION,
                "created_at": utc_now_iso(),
            },
        )


def create_current_schema_objects(bind=None):
    """Create objects that SQLModel cannot express for a fresh current schema."""
    target = bind or engine
    create_fts_tables(target)

    statements = [
        """
        CREATE INDEX IF NOT EXISTS ix_audio_items_file_hash
        ON audio_items(file_hash)
        WHERE file_hash IS NOT NULL;
        """,
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_tasks_active
        ON ai_tasks(audio_id, task_type)
        WHERE status IN ('pending', 'running', 'cancel_requested');
        """,
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_scan_tasks_active_root
        ON scan_tasks(root_id)
        WHERE status IN ('pending', 'running', 'cancel_requested');
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_audio_items_updated_at
        ON audio_items(updated_at);
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_audio_items_transcript_status
        ON audio_items(transcript_status);
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_audio_items_ai_status
        ON audio_items(ai_status);
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_audio_items_is_missing
        ON audio_items(is_missing);
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_audio_items_is_favorite
        ON audio_items(is_favorite);
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_audio_items_library_root_id
        ON audio_items(library_root_id);
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_audio_items_library_root_updated_at
        ON audio_items(library_root_id, updated_at);
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_playback_events_audio_started
        ON playback_events(audio_id, started_at DESC);
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_playback_events_started_completed
        ON playback_events(started_at DESC, completed);
        """,
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_saved_views_name_nocase
        ON saved_views(name COLLATE NOCASE);
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_saved_views_sort_order
        ON saved_views(sort_order, id);
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_library_health_tasks_status
        ON library_health_tasks(status, created_at);
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_library_health_tasks_type
        ON library_health_tasks(task_type, created_at);
        """,
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_library_health_tasks_active_type
        ON library_health_tasks(task_type)
        WHERE status IN ('pending', 'running', 'cancel_requested');
        """,
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_transcripts_current_audio
        ON transcripts(audio_id)
        WHERE is_current = 1;
        """,
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_transcripts_audio_revision
        ON transcripts(audio_id, revision_number);
        """,
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_transcript_segments_revision_index
        ON transcript_segments(transcript_id, segment_index);
        """,
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_transcript_chapters_revision_index
        ON transcript_chapters(transcript_id, chapter_index);
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_transcript_issues_revision_status
        ON transcript_issues(transcript_id, status);
        """,
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_agent_runs_active_conversation
        ON agent_runs(conversation_id)
        WHERE status IN ('pending', 'running', 'cancel_requested');
        """,
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_agent_run_steps_index
        ON agent_run_steps(run_id, step_index);
        """,
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_agent_operation_plan_run
        ON agent_operation_plans(run_id);
        """,
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_agent_operation_item_index
        ON agent_operation_items(plan_id, item_index);
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_agent_conversations_updated
        ON agent_conversations(updated_at DESC);
        """,
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_organization_run_targets_audio
        ON organization_run_targets(run_id, audio_id);
        """,
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_organization_run_steps_stage
        ON organization_run_steps(run_id, stage);
        """,
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_organization_proposals_dedupe
        ON organization_proposals(run_id, dedupe_key);
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_organization_proposals_review
        ON organization_proposals(run_id, status, kind);
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_organization_runs_updated
        ON organization_runs(updated_at DESC);
        """,
    ]

    with target.begin() as conn:
        for statement in statements:
            conn.execute(text(statement))
