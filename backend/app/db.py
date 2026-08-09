import logging
import sqlite3
from contextlib import closing
from pathlib import Path
from sqlmodel import SQLModel, Session, create_engine
from sqlalchemy import text, event

from .time_utils import utc_now_iso


logger = logging.getLogger(__name__)
CURRENT_SCHEMA_VERSION = 7

APP_DATA_DIR = Path.home() / ".local_audio_library"
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
    backup_path = prepare_database_for_migrations()
    SQLModel.metadata.create_all(engine)
    create_fts_tables()
    run_migrations()

    if backup_path is not None:
        logger.info("Database migration backup created: %s", backup_path)


def _database_schema_state(path: Path) -> tuple[int | None, set[int]]:
    """Return the highest and complete set of applied migration versions."""
    if not path.exists() or path.stat().st_size == 0:
        return None, set()

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
            return None, set()

        migrations_table = conn.execute(
            """
            SELECT 1
            FROM sqlite_master
            WHERE type = 'table' AND name = 'schema_migrations'
            """
        ).fetchone()

        if migrations_table is None:
            return 0, set()

        rows = conn.execute("SELECT version FROM schema_migrations").fetchall()
        applied_versions = {int(row[0]) for row in rows}
        return max(applied_versions, default=0), applied_versions


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


def prepare_database_for_migrations() -> Path | None:
    """Create a verified backup before changing an existing database schema."""
    schema_version, applied_versions = _database_schema_state(DB_PATH)
    expected_versions = set(range(1, CURRENT_SCHEMA_VERSION + 1))

    if schema_version is None or applied_versions == expected_versions:
        return None

    if schema_version > CURRENT_SCHEMA_VERSION:
        raise RuntimeError(
            "Database schema version "
            f"{schema_version} is newer than this application supports "
            f"({CURRENT_SCHEMA_VERSION}). Refusing to modify it."
        )

    BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = utc_now_iso().replace("-", "").replace(":", "").replace(".", "")
    backup_path = BACKUPS_DIR / (
        f"database.pre-migration-v{schema_version}-to-v{CURRENT_SCHEMA_VERSION}-"
        f"{timestamp}Z.sqlite"
    )
    _verified_sqlite_backup(DB_PATH, backup_path)
    return backup_path


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


def _migration_applied(conn, version: int) -> bool:
    row = conn.execute(
        text("SELECT version FROM schema_migrations WHERE version = :version"),
        {"version": version},
    ).fetchone()
    return row is not None


def _mark_migration_applied(conn, version: int, name: str):
    conn.execute(
        text(
            """
            INSERT INTO schema_migrations(version, name, applied_at)
            VALUES (:version, :name, :applied_at)
            """
        ),
        {
            "version": version,
            "name": name,
            "applied_at": utc_now_iso(),
        },
    )


def _table_columns(conn, table_name: str) -> set[str]:
    rows = conn.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
    return {row[1] for row in rows}


def _add_column_if_missing(conn, table_name: str, column_name: str, ddl: str):
    columns = _table_columns(conn, table_name)
    if column_name not in columns:
        conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {ddl}"))


def _table_exists(conn, table_name: str) -> bool:
    row = conn.execute(
        text(
            """
            SELECT name FROM sqlite_master
            WHERE type='table' AND name = :table_name
            """
        ),
        {"table_name": table_name},
    ).fetchone()
    return row is not None


def _dedupe_active_ai_tasks(conn):
    """
    创建 active task 唯一索引前，处理旧库里可能已经存在的重复 active task。

    保留每个 audio_id + task_type 下 id 最小的一条 active task，
    其余 active task 标记为 canceled，避免 CREATE UNIQUE INDEX 失败。
    """
    now = utc_now_iso()

    conn.execute(
        text(
            """
            UPDATE ai_tasks
            SET status = 'canceled',
                error_message = COALESCE(error_message, :message),
                finished_at = COALESCE(finished_at, :now),
                updated_at = :now
            WHERE status IN ('pending', 'running', 'cancel_requested')
              AND id NOT IN (
                  SELECT MIN(id)
                  FROM ai_tasks
                  WHERE status IN ('pending', 'running', 'cancel_requested')
                  GROUP BY audio_id, task_type
              )
            """
        ),
        {
            "now": now,
            "message": "Duplicate active task canceled during schema migration",
        },
    )


def _dedupe_active_scan_tasks(conn):
    """
    创建 active scan task 唯一索引前，处理旧库里可能已经存在的同 root 重复扫描任务。
    """
    now = utc_now_iso()

    conn.execute(
        text(
            """
            UPDATE scan_tasks
            SET status = 'canceled',
                error_message = COALESCE(error_message, :message),
                finished_at = COALESCE(finished_at, :now),
                updated_at = :now
            WHERE status IN ('pending', 'running', 'cancel_requested')
              AND id NOT IN (
                  SELECT MIN(id)
                  FROM scan_tasks
                  WHERE status IN ('pending', 'running', 'cancel_requested')
                  GROUP BY root_id
              )
            """
        ),
        {
            "now": now,
            "message": "Duplicate active scan task canceled during schema migration",
        },
    )


def run_migrations():
    """
    轻量迁移机制。

    SQLModel.create_all 只会创建不存在的表，不会修改已有表。
    这里用于补充后续版本新增字段 / 维护表。
    """
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    applied_at TEXT NOT NULL
                );
                """
            )
        )

        if not _migration_applied(conn, 1):
            # baseline：当前 MVP 初始结构。
            _mark_migration_applied(conn, 1, "baseline")

        if not _migration_applied(conn, 2):
            # 保证旧库也拥有 P0/P1/P2 字段。
            # 大多数新库会由 SQLModel 自动创建，这里只处理旧库升级。
            audio_columns = _table_columns(conn, "audio_items") if conn.execute(
                text(
                    """
                    SELECT name FROM sqlite_master
                    WHERE type='table' AND name='audio_items'
                    """
                )
            ).fetchone() else set()

            if audio_columns:
                if "cover_path" not in audio_columns:
                    _add_column_if_missing(conn, "audio_items", "cover_path", "cover_path TEXT")
                if "cover_source" not in audio_columns:
                    _add_column_if_missing(conn, "audio_items", "cover_source", "cover_source TEXT")
                if "file_hash" not in audio_columns:
                    _add_column_if_missing(conn, "audio_items", "file_hash", "file_hash TEXT")

            _mark_migration_applied(conn, 2, "ensure_audio_item_columns")

        if not _migration_applied(conn, 3):
            create_fts_tables()
            _mark_migration_applied(conn, 3, "ensure_fts5_search_index")

        if not _migration_applied(conn, 4):
            # 用于扫描时通过 hash 识别文件移动。
            # 旧库中 file_hash 可能为空，扫描会逐步回填。
            conn.execute(
                text(
                    """
                    CREATE INDEX IF NOT EXISTS ix_audio_items_file_hash
                    ON audio_items(file_hash)
                    WHERE file_hash IS NOT NULL;
                    """
                )
            )

            _mark_migration_applied(conn, 4, "index_audio_items_file_hash")

        if not _migration_applied(conn, 5):
            # 防止同一个音频同一类型任务在 pending/running/cancel_requested
            # 状态下重复存在。这里提供数据库级并发保护。
            if _table_exists(conn, "ai_tasks"):
                _dedupe_active_ai_tasks(conn)

                conn.execute(
                    text(
                        """
                        CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_tasks_active
                        ON ai_tasks(audio_id, task_type)
                        WHERE status IN ('pending', 'running', 'cancel_requested');
                        """
                    )
                )

            # 防止同一个 library root 同时存在多个 pending/running/cancel_requested 扫描任务。
            if _table_exists(conn, "scan_tasks"):
                _dedupe_active_scan_tasks(conn)

                conn.execute(
                    text(
                        """
                        CREATE UNIQUE INDEX IF NOT EXISTS ux_scan_tasks_active_root
                        ON scan_tasks(root_id)
                        WHERE status IN ('pending', 'running', 'cancel_requested');
                        """
                    )
                )

            _mark_migration_applied(
                conn, 5, "unique_active_ai_and_scan_tasks"
            )

        if not _migration_applied(conn, 6):
            # v6:
            # - scan task cancel_requested 也应视为 active，避免取消中的扫描与新扫描并发。
            # - 为常用 AudioItem 查询字段补充索引，改善分页、筛选和排序性能。
            if _table_exists(conn, "scan_tasks"):
                _dedupe_active_scan_tasks(conn)

                conn.execute(text("DROP INDEX IF EXISTS ux_scan_tasks_active_root"))

                conn.execute(
                    text(
                        """
                        CREATE UNIQUE INDEX IF NOT EXISTS ux_scan_tasks_active_root
                        ON scan_tasks(root_id)
                        WHERE status IN ('pending', 'running', 'cancel_requested');
                        """
                    )
                )

            if _table_exists(conn, "audio_items"):
                audio_item_indexes = [
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
                ]

                for ddl in audio_item_indexes:
                    conn.execute(text(ddl))

            _mark_migration_applied(
                conn, 6, "scan_cancel_requested_and_audio_query_indexes"
            )

        if not _migration_applied(conn, 7):
            if _table_exists(conn, "ai_tasks"):
                _add_column_if_missing(conn, "ai_tasks", "error_code", "error_code TEXT")
                _add_column_if_missing(conn, "ai_tasks", "error_params", "error_params TEXT")

            if _table_exists(conn, "scan_tasks"):
                _add_column_if_missing(conn, "scan_tasks", "error_code", "error_code TEXT")
                _add_column_if_missing(conn, "scan_tasks", "error_params", "error_params TEXT")

            _mark_migration_applied(conn, 7, "structured_task_errors")
