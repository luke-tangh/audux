import logging
import sqlite3
from contextlib import closing
from pathlib import Path

from sqlalchemy import event, text
from sqlmodel import SQLModel, Session, create_engine

from .time_utils import utc_now_iso


logger = logging.getLogger(__name__)
CURRENT_SCHEMA_VERSION = 2

APP_DATA_DIR = Path.home() / ".audux"
APP_DATA_DIR.mkdir(parents=True, exist_ok=True)

COVERS_DIR = APP_DATA_DIR / "covers"
COVERS_DIR.mkdir(parents=True, exist_ok=True)

LOGS_DIR = APP_DATA_DIR / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)

EXPORTS_DIR = APP_DATA_DIR / "exports"
EXPORTS_DIR.mkdir(parents=True, exist_ok=True)

BACKUPS_DIR = APP_DATA_DIR / "backups"
BACKUPS_DIR.mkdir(parents=True, exist_ok=True)

COMPONENTS_DIR = APP_DATA_DIR / "components"
COMPONENTS_DIR.mkdir(parents=True, exist_ok=True)

MODELS_DIR = APP_DATA_DIR / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)

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
            f"{schema_version} does not match this pre-release build "
            f"({CURRENT_SCHEMA_VERSION})."
        )

    SQLModel.metadata.create_all(engine)
    _write_current_schema_marker()
    create_current_schema_objects()


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
                "Database does not use the schema required by this pre-release build."
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


def create_fts_tables():
    with engine.begin() as conn:
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


def create_current_schema_objects():
    """Create objects that SQLModel cannot express for a fresh current schema."""
    create_fts_tables()

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
    ]

    with engine.begin() as conn:
        for statement in statements:
            conn.execute(text(statement))
