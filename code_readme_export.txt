
================================================================================
文件: backend/app/ai_client.py
================================================================================
import json
import httpx
from typing import Optional


async def call_openai_compatible_chat(
    endpoint: str,
    model_name: str,
    messages: list[dict],
    api_key: Optional[str] = None,
    timeout: int = 60,
    max_tokens: Optional[int] = 800,
    temperature: Optional[float] = 0.2,
) -> dict:
    url = endpoint.rstrip("/") + "/chat/completions"

    headers = {
        "Content-Type": "application/json",
    }

    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    payload = {
        "model": model_name,
        "messages": messages,
    }

    if temperature is not None:
        payload["temperature"] = temperature

    if max_tokens is not None:
        payload["max_tokens"] = max_tokens

    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(url, headers=headers, json=payload)
        resp.raise_for_status()
        return resp.json()


def get_ai_message_content(response: dict) -> str:
    try:
        return response["choices"][0]["message"]["content"]
    except Exception as e:
        raise ValueError(f"Invalid OpenAI-compatible response schema: {e}")


def parse_ai_json_content(content: str) -> dict:
    try:
        return json.loads(content)
    except Exception:
        start = content.find("{")
        end = content.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(content[start : end + 1])
            except Exception:
                pass

        raise ValueError("LLM response is not valid JSON")


def parse_ai_json_response(response: dict) -> dict:
    content = get_ai_message_content(response)
    return parse_ai_json_content(content)


================================================================================
文件: backend/app/db.py
================================================================================
from pathlib import Path
from datetime import datetime
from sqlmodel import SQLModel, Session, create_engine
from sqlalchemy import text, event

APP_DATA_DIR = Path.home() / ".local_audio_library"
APP_DATA_DIR.mkdir(parents=True, exist_ok=True)

COVERS_DIR = APP_DATA_DIR / "covers"
COVERS_DIR.mkdir(parents=True, exist_ok=True)

LOGS_DIR = APP_DATA_DIR / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)

EXPORTS_DIR = APP_DATA_DIR / "exports"
EXPORTS_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = APP_DATA_DIR / "database.sqlite"
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(
    DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False},
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


def get_session():
    with Session(engine) as session:
        yield session


def create_db_and_tables():
    SQLModel.metadata.create_all(engine)
    create_fts_tables()
    run_migrations()


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
            "applied_at": datetime.utcnow().isoformat(),
        },
    )


def _table_columns(conn, table_name: str) -> set[str]:
    rows = conn.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
    return {row[1] for row in rows}


def _add_column_if_missing(conn, table_name: str, column_name: str, ddl: str):
    columns = _table_columns(conn, table_name)
    if column_name not in columns:
        conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {ddl}"))


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


================================================================================
文件: backend/app/logger.py
================================================================================
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

from .db import LOGS_DIR

LOG_FILE = LOGS_DIR / "app.log"


def setup_logging():
    LOGS_DIR.mkdir(parents=True, exist_ok=True)

    root = logging.getLogger()
    root.setLevel(logging.INFO)

    exists = any(
        isinstance(handler, RotatingFileHandler)
        and getattr(handler, "baseFilename", None) == str(LOG_FILE)
        for handler in root.handlers
    )

    if exists:
        return

    formatter = logging.Formatter(
        fmt="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    )

    file_handler = RotatingFileHandler(
        LOG_FILE,
        maxBytes=2 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    file_handler.setLevel(logging.INFO)

    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(formatter)
    stream_handler.setLevel(logging.INFO)

    root.addHandler(file_handler)
    root.addHandler(stream_handler)


def get_logger(name: str):
    return logging.getLogger(name)


def read_log_tail(lines: int = 300) -> str:
    path = Path(LOG_FILE)
    if not path.exists():
        return ""

    lines = max(1, min(lines, 2000))

    with path.open("r", encoding="utf-8", errors="ignore") as f:
        content = f.readlines()

    return "".join(content[-lines:])


================================================================================
文件: backend/app/main.py
================================================================================
import csv
import io
import json
import mimetypes
import os
import ipaddress
from datetime import datetime
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from fastapi import (
    FastAPI,
    Depends,
    HTTPException,
    BackgroundTasks,
    UploadFile,
    File,
    Query,
    Request,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, PlainTextResponse, JSONResponse
from sqlmodel import Session, select
from sqlalchemy import func, or_, and_, text

from .db import create_db_and_tables, get_session, COVERS_DIR
from .logger import setup_logging, get_logger, read_log_tail, LOG_FILE
from .models import (
    LibraryRoot,
    AudioItem,
    Tag,
    AudioTag,
    Playlist,
    PlaylistItem,
    Transcript,
    TranscriptSegment,
    AITask,
    Setting,
    ScanTask,
    now_iso,
)
from .schemas import (
    LibraryRootCreate,
    LibraryRootUpdate,
    AudioUpdate,
    PlaybackPositionUpdate,
    RelocateAudioRequest,
    TagsAddRequest,
    TagUpdate,
    PlaylistCreate,
    PlaylistItemAdd,
    PlaylistItemsReorder,
    TranscriptCreate,
    SettingUpdate,
    LLMConfig,
    BatchAudioRequest,
)
from .scanner import (
    scan_library_root,
    scan_library_root_task,
    SUPPORTED_EXTS,
    read_audio_metadata,
    extract_embedded_cover,
)
from .search import rebuild_audio_search_index, search_audio_ids
from .tasks import create_task, start_worker_once
from .ai_client import call_openai_compatible_chat, get_ai_message_content


setup_logging()
logger = get_logger(__name__)

app = FastAPI(title="Local Audio Library API", version="0.4.0")

ALLOW_ALL_CORS = os.getenv("LOCAL_AUDIO_LIBRARY_ALLOW_ALL_CORS", "").lower() in {
    "1",
    "true",
    "yes",
}

LOCAL_ORIGIN_REGEX = (
    r"^(https?://(127\.0\.0\.1|localhost)(:\d+)?"
    r"|https?://tauri\.localhost"
    r"|tauri://localhost)$"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if ALLOW_ALL_CORS else [],
    allow_origin_regex=None if ALLOW_ALL_CORS else LOCAL_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

AUDIO_MIME_TYPES = {
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".flac": "audio/flac",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
}

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
LOCAL_CLIENT_HEADER_NAME = "X-Local-Audio-Client"
LOCAL_CLIENT_HEADER_VALUE = "local-audio-library"

BUSY_AUDIO_TASK_STATUSES = {"pending", "running", "cancel_requested"}


def _is_allowed_request_origin(origin: str) -> bool:
    if ALLOW_ALL_CORS:
        return True

    try:
        parsed = urlparse(origin)
        scheme = (parsed.scheme or "").lower()
        host = (parsed.hostname or "").lower()

        if scheme == "tauri" and host == "localhost":
            return True

        if scheme not in {"http", "https"}:
            return False

        if host in {"localhost", "127.0.0.1", "::1"}:
            return True

        if host.endswith(".localhost"):
            return True

        try:
            ip = ipaddress.ip_address(host)
            return bool(ip.is_loopback)
        except Exception:
            return False

    except Exception:
        return False


@app.middleware("http")
async def local_request_guard(request: Request, call_next):
    """
    本地 API CSRF 防护。

    CORS 只能阻止跨站读取响应，不能阻止恶意网页用 form/no-cors 触发无 body POST。
    所有 unsafe 请求必须携带自定义 header；普通跨站 form 无法发送该 header。
    """
    if request.method.upper() != "OPTIONS":
        origin = request.headers.get("origin")
        if origin and not _is_allowed_request_origin(origin):
            return JSONResponse(
                status_code=403,
                content={"detail": "Forbidden origin"},
            )

        if request.method.upper() in UNSAFE_METHODS:
            client_header = request.headers.get(LOCAL_CLIENT_HEADER_NAME)
            if client_header != LOCAL_CLIENT_HEADER_VALUE:
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Missing local client header"},
                )

    return await call_next(request)


@app.on_event("startup")
async def on_startup():
    create_db_and_tables()
    start_worker_once()
    logger.info("Local Audio Library backend started")


@app.get("/health")
def health():
    return {"status": "ok"}


def _is_local_endpoint(endpoint: str) -> bool:
    try:
        parsed = urlparse(endpoint)
        host = parsed.hostname
        if not host:
            return False

        host = host.lower()

        if host in {"localhost", "127.0.0.1", "::1"}:
            return True

        if host.endswith(".localhost"):
            return True

        try:
            ip = ipaddress.ip_address(host)
            return bool(ip.is_loopback)
        except Exception:
            return False

    except Exception:
        return False


def _llm_privacy_warning(endpoint: str) -> Optional[str]:
    if not endpoint:
        return None

    if _is_local_endpoint(endpoint):
        return None

    return (
        "当前 LLM endpoint 不是 localhost / 127.0.0.1。"
        "AI 分析会把音频 metadata 和 transcript 发送到该地址。"
        "请确认这是你信任的本地或内网模型服务。"
    )


def _apply_enabled_roots_filter(
    stmt,
    session: Session,
    include_disabled_roots: bool = False,
):
    if include_disabled_roots:
        return stmt

    enabled_root_ids = session.exec(
        select(LibraryRoot.id).where(LibraryRoot.is_enabled == True)
    ).all()

    if not enabled_root_ids:
        return stmt.where(AudioItem.library_root_id == None)

    return stmt.where(
        or_(
            AudioItem.library_root_id == None,
            AudioItem.library_root_id.in_(enabled_root_ids),
        )
    )


def _find_library_root_id_for_path(session: Session, file_path: Path) -> Optional[int]:
    """
    根据文件路径匹配当前已有 library root。

    使用最长前缀匹配，避免嵌套 root 时归到较外层目录。
    若不属于任何 root，返回 None，表示手动定位到 root 外部。
    """
    resolved_file = file_path.expanduser().resolve()
    roots = session.exec(select(LibraryRoot)).all()

    best_root_id: Optional[int] = None
    best_len = -1

    for root in roots:
        if root.id is None:
            continue

        try:
            root_path = Path(root.path).expanduser().resolve()
            resolved_file.relative_to(root_path)

            root_len = len(str(root_path))
            if root_len > best_len:
                best_root_id = root.id
                best_len = root_len
        except Exception:
            continue

    return best_root_id


def _parse_task_output_payload(value: Optional[str]) -> dict:
    if not value:
        return {}

    try:
        parsed = json.loads(value)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass

    return {}


def _safe_download_name(name: str) -> str:
    return name.replace("/", "_").replace("\\", "_").replace('"', "_")


def _attachment_headers(filename: str) -> dict:
    filename = _safe_download_name(filename)
    return {"Content-Disposition": f'attachment; filename="{filename}"'}


def _srt_time(seconds: float) -> str:
    total_ms = max(0, int(round(seconds * 1000)))
    ms = total_ms % 1000
    total = total_ms // 1000
    s = total % 60
    m = (total // 60) % 60
    h = total // 3600
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _cover_media_type(path: Path) -> str:
    guessed = mimetypes.guess_type(str(path))[0]
    return guessed or "image/jpeg"


def _tags_for_audio(session: Session, audio_id: int) -> list[Tag]:
    return session.exec(
        select(Tag)
        .join(AudioTag, AudioTag.tag_id == Tag.id)
        .where(AudioTag.audio_id == audio_id)
        .order_by(Tag.name)
    ).all()


def _query_tokens(q: Optional[str]) -> list[str]:
    if not q:
        return []

    tokens = [x.strip().lower() for x in q.split() if x.strip()]
    if tokens:
        return tokens

    q = q.strip().lower()
    return [q] if q else []


def _text_matches_tokens(text_value: Optional[str], tokens: list[str]) -> bool:
    if not text_value or not tokens:
        return False

    lower = text_value.lower()
    return any(token in lower for token in tokens)


def _shorten_hit_text(text_value: str, tokens: list[str], max_len: int = 220) -> str:
    text_value = text_value.strip()
    if len(text_value) <= max_len:
        return text_value

    lower = text_value.lower()
    first_pos = -1

    for token in tokens:
        pos = lower.find(token)
        if pos >= 0 and (first_pos < 0 or pos < first_pos):
            first_pos = pos

    if first_pos < 0:
        return text_value[:max_len].rstrip() + "..."

    start = max(0, first_pos - 80)
    end = min(len(text_value), start + max_len)

    snippet = text_value[start:end].strip()

    if start > 0:
        snippet = "..." + snippet

    if end < len(text_value):
        snippet = snippet + "..."

    return snippet


def _add_search_hit(
    hits: list[dict],
    field: str,
    label: str,
    text_value: Optional[str],
    tokens: list[str],
    start_seconds: Optional[float] = None,
    end_seconds: Optional[float] = None,
    limit: int = 6,
):
    if len(hits) >= limit:
        return

    if not text_value:
        return

    if not _text_matches_tokens(text_value, tokens):
        return

    hit = {
        "field": field,
        "label": label,
        "text": _shorten_hit_text(text_value, tokens),
    }

    if start_seconds is not None:
        hit["start_seconds"] = start_seconds

    if end_seconds is not None:
        hit["end_seconds"] = end_seconds

    hits.append(hit)


def _search_hits_for_audio(
    session: Session,
    audio: AudioItem,
    q: Optional[str],
    tags: Optional[list[Tag]] = None,
) -> list[dict]:
    tokens = _query_tokens(q)
    if not tokens or audio.id is None:
        return []

    hits: list[dict] = []

    _add_search_hit(
        hits,
        "title",
        "标题",
        audio.title_user or audio.title_original or audio.file_name,
        tokens,
    )
    _add_search_hit(
        hits,
        "author",
        "作者",
        audio.author_user or audio.author_original,
        tokens,
    )
    _add_search_hit(
        hits,
        "description",
        "描述",
        audio.description_user or audio.description_ai or audio.description_original,
        tokens,
    )

    tag_rows = tags if tags is not None else _tags_for_audio(session, audio.id)
    tag_text = " ".join(tag.name for tag in tag_rows)
    _add_search_hit(hits, "tags", "标签", tag_text, tokens)

    transcript = session.exec(
        select(Transcript).where(Transcript.audio_id == audio.id)
    ).first()

    if not transcript:
        return hits[:6]

    segments = session.exec(
        select(TranscriptSegment)
        .where(TranscriptSegment.transcript_id == transcript.id)
        .order_by(TranscriptSegment.segment_index)
    ).all()

    segment_hit_count = 0

    for seg in segments:
        if segment_hit_count >= 3:
            break

        before_count = len(hits)
        _add_search_hit(
            hits,
            "transcript",
            "Transcript",
            seg.text,
            tokens,
            start_seconds=seg.start_seconds,
            end_seconds=seg.end_seconds,
        )

        if len(hits) > before_count:
            segment_hit_count += 1

    if segment_hit_count == 0:
        _add_search_hit(
            hits,
            "transcript",
            "Transcript",
            transcript.full_text,
            tokens,
        )

    return hits[:6]


def _audio_with_tags_dict(
    session: Session,
    audio: AudioItem,
    search_query: Optional[str] = None,
) -> dict:
    if audio.id is None:
        return {
            **audio.model_dump(),
            "tags": [],
            "search_hits": [],
        }

    tags = _tags_for_audio(session, audio.id)

    return {
        **audio.model_dump(),
        "tags": [tag.model_dump() for tag in tags],
        "search_hits": _search_hits_for_audio(session, audio, search_query, tags=tags)
        if search_query
        else [],
    }


def _audio_to_export_dict(session: Session, audio: AudioItem) -> dict:
    tags = _tags_for_audio(session, audio.id)

    return {
        **audio.model_dump(),
        "tags": [t.model_dump() for t in tags],
    }


# Library Root

@app.post("/library-roots")
def create_library_root(payload: LibraryRootCreate, session: Session = Depends(get_session)):
    path = str(Path(payload.path).expanduser().resolve())

    if not Path(path).exists() or not Path(path).is_dir():
        raise HTTPException(status_code=400, detail="Invalid directory")

    exists = session.exec(select(LibraryRoot).where(LibraryRoot.path == path)).first()
    if exists:
        raise HTTPException(status_code=409, detail="Library root already exists")

    root = LibraryRoot(path=path)
    session.add(root)
    session.commit()
    session.refresh(root)

    logger.info("Library root created: %s", path)
    return root


@app.get("/library-roots")
def list_library_roots(session: Session = Depends(get_session)):
    return session.exec(select(LibraryRoot).order_by(LibraryRoot.created_at)).all()


@app.patch("/library-roots/{root_id}")
def update_library_root(
    root_id: int,
    payload: LibraryRootUpdate,
    session: Session = Depends(get_session),
):
    root = session.get(LibraryRoot, root_id)
    if not root:
        raise HTTPException(status_code=404, detail="Library root not found")

    if payload.is_enabled is not None:
        root.is_enabled = payload.is_enabled

    root.updated_at = now_iso()
    session.add(root)
    session.commit()
    session.refresh(root)

    logger.info("Library root updated id=%s enabled=%s", root.id, root.is_enabled)
    return root


@app.post("/library-roots/{root_id}/scan")
def scan_root(
    root_id: int,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
):
    root = session.get(LibraryRoot, root_id)
    if not root:
        raise HTTPException(status_code=404, detail="Library root not found")

    task = ScanTask(root_id=root_id, status="pending")
    session.add(task)
    session.commit()
    session.refresh(task)

    background_tasks.add_task(scan_library_root_task, root_id, task.id)

    logger.info("Scan task created id=%s root=%s", task.id, root.path)
    return task


@app.post("/library-roots/{root_id}/scan-sync")
def scan_root_sync(root_id: int, session: Session = Depends(get_session)):
    try:
        return scan_library_root(session, root_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/scan-tasks")
def list_scan_tasks(
    root_id: Optional[int] = None,
    limit: int = Query(default=50, ge=1, le=200),
    session: Session = Depends(get_session),
):
    stmt = select(ScanTask)

    if root_id is not None:
        stmt = stmt.where(ScanTask.root_id == root_id)

    stmt = stmt.order_by(ScanTask.created_at.desc()).limit(limit)
    return session.exec(stmt).all()


@app.get("/scan-tasks/{task_id}")
def get_scan_task(task_id: int, session: Session = Depends(get_session)):
    task = session.get(ScanTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Scan task not found")

    return task


@app.post("/scan-tasks/{task_id}/cancel")
def cancel_scan_task(task_id: int, session: Session = Depends(get_session)):
    task = session.get(ScanTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Scan task not found")

    if task.status in ["done", "failed", "canceled"]:
        raise HTTPException(status_code=400, detail="Scan task cannot be canceled")

    task.status = "canceled"
    task.finished_at = now_iso()
    task.updated_at = now_iso()
    session.add(task)
    session.commit()
    session.refresh(task)

    logger.info("Scan task canceled id=%s", task.id)
    return task


# Audio

@app.get("/audio-items")
def list_audio_items(
    q: Optional[str] = None,
    tag: Optional[str] = None,
    has_transcript: Optional[bool] = None,
    favorite: Optional[bool] = None,
    missing: Optional[bool] = None,
    missing_description: Optional[bool] = None,
    include_disabled_roots: bool = False,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
):
    stmt = select(AudioItem)

    stmt = _apply_enabled_roots_filter(
        stmt,
        session,
        include_disabled_roots=include_disabled_roots,
    )
    if stmt is None:
        return []

    if q:
        ids = search_audio_ids(session, q)
        if not ids:
            return []
        stmt = stmt.where(AudioItem.id.in_(ids))

    if favorite is not None:
        stmt = stmt.where(AudioItem.is_favorite == favorite)

    if missing is not None:
        stmt = stmt.where(AudioItem.is_missing == missing)

    if has_transcript is not None:
        if has_transcript:
            stmt = stmt.where(AudioItem.transcript_status == "done")
        else:
            stmt = stmt.where(AudioItem.transcript_status != "done")

    if missing_description is not None:
        if missing_description:
            stmt = stmt.where(
                and_(
                    or_(AudioItem.description_user == None, AudioItem.description_user == ""),
                    or_(AudioItem.description_ai == None, AudioItem.description_ai == ""),
                    or_(AudioItem.description_original == None, AudioItem.description_original == ""),
                )
            )
        else:
            stmt = stmt.where(
                or_(
                    and_(AudioItem.description_user != None, AudioItem.description_user != ""),
                    and_(AudioItem.description_ai != None, AudioItem.description_ai != ""),
                    and_(AudioItem.description_original != None, AudioItem.description_original != ""),
                )
            )

    if tag:
        tag_row = session.exec(select(Tag).where(Tag.name == tag)).first()
        if not tag_row:
            return []

        audio_ids = session.exec(
            select(AudioTag.audio_id).where(AudioTag.tag_id == tag_row.id)
        ).all()

        if not audio_ids:
            return []

        stmt = stmt.where(AudioItem.id.in_(audio_ids))

    stmt = stmt.order_by(AudioItem.updated_at.desc()).offset(offset).limit(limit)
    rows = session.exec(stmt).all()

    return [_audio_with_tags_dict(session, item, search_query=q) for item in rows]


@app.post("/audio-items/batch/transcribe")
def batch_transcribe(
    payload: BatchAudioRequest,
    session: Session = Depends(get_session),
):
    created = []
    skipped = []
    errors = []

    for audio_id in payload.audio_ids:
        audio = session.get(AudioItem, audio_id)
        if not audio:
            errors.append({"audio_id": audio_id, "error": "Audio not found"})
            continue

        if audio.transcript_status in BUSY_AUDIO_TASK_STATUSES:
            skipped.append(audio_id)
            continue

        audio.transcript_status = "pending"
        audio.updated_at = now_iso()
        session.add(audio)
        session.commit()

        task = create_task(session, audio_id, "transcribe")
        created.append(task)

    logger.info("Batch transcribe created=%s skipped=%s", len(created), len(skipped))

    return {
        "created": len(created),
        "skipped": len(skipped),
        "errors": errors,
        "tasks": created,
    }


@app.post("/audio-items/batch/analyze")
def batch_analyze(
    payload: BatchAudioRequest,
    session: Session = Depends(get_session),
):
    endpoint = session.get(Setting, "llm.endpoint")
    model_name = session.get(Setting, "llm.model_name")

    if not endpoint or not endpoint.value or not model_name or not model_name.value:
        raise HTTPException(status_code=400, detail="LLM endpoint or model_name is not configured")

    warning = _llm_privacy_warning(endpoint.value)
    if warning:
        logger.warning("Batch analyze uses non-local LLM endpoint: %s", endpoint.value)

    created = []
    skipped = []
    errors = []

    for audio_id in payload.audio_ids:
        audio = session.get(AudioItem, audio_id)
        if not audio:
            errors.append({"audio_id": audio_id, "error": "Audio not found"})
            continue

        if audio.ai_status in BUSY_AUDIO_TASK_STATUSES:
            skipped.append(audio_id)
            continue

        audio.ai_status = "pending"
        audio.updated_at = now_iso()
        session.add(audio)
        session.commit()

        task = create_task(session, audio_id, "analyze")
        created.append(task)

    logger.info("Batch analyze created=%s skipped=%s", len(created), len(skipped))

    return {
        "created": len(created),
        "skipped": len(skipped),
        "privacy_warning": warning,
        "errors": errors,
        "tasks": created,
    }


@app.get("/audio-items/{audio_id}")
def get_audio_item(audio_id: int, session: Session = Depends(get_session)):
    item = session.get(AudioItem, audio_id)
    if not item:
        raise HTTPException(status_code=404, detail="Audio item not found")

    tags = _tags_for_audio(session, audio_id)

    return {
        "audio": item,
        "tags": tags,
    }


@app.patch("/audio-items/{audio_id}")
def update_audio_item(
    audio_id: int,
    payload: AudioUpdate,
    session: Session = Depends(get_session),
):
    item = session.get(AudioItem, audio_id)
    if not item:
        raise HTTPException(status_code=404, detail="Audio item not found")

    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(item, key, value)

    item.updated_at = now_iso()
    session.add(item)
    session.commit()
    session.refresh(item)

    rebuild_audio_search_index(session, item.id)
    return item


@app.delete("/audio-items/{audio_id}")
def delete_audio_item(
    audio_id: int,
    delete_file: bool = False,
    session: Session = Depends(get_session),
):
    item = session.get(AudioItem, audio_id)
    if not item:
        raise HTTPException(status_code=404, detail="Audio item not found")

    if delete_file:
        path = Path(item.file_path)
        if path.exists():
            try:
                path.unlink()
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Failed to delete file: {e}")

    for link in session.exec(select(AudioTag).where(AudioTag.audio_id == audio_id)).all():
        session.delete(link)

    for pi in session.exec(select(PlaylistItem).where(PlaylistItem.audio_id == audio_id)).all():
        session.delete(pi)

    for task in session.exec(select(AITask).where(AITask.audio_id == audio_id)).all():
        session.delete(task)

    transcript = session.exec(
        select(Transcript).where(Transcript.audio_id == audio_id)
    ).first()

    if transcript:
        for seg in session.exec(
            select(TranscriptSegment).where(
                TranscriptSegment.transcript_id == transcript.id
            )
        ).all():
            session.delete(seg)

        session.delete(transcript)

    if item.cover_path:
        try:
            cover_path = Path(item.cover_path)
            if cover_path.exists() and cover_path.parent == COVERS_DIR:
                cover_path.unlink()
        except Exception:
            pass

    session.execute(
        text("DELETE FROM search_index WHERE audio_id = :audio_id"),
        {"audio_id": audio_id},
    )

    session.delete(item)
    session.commit()

    logger.info("Audio item deleted id=%s delete_file=%s", audio_id, delete_file)
    return {"ok": True}


@app.post("/audio-items/{audio_id}/relocate")
def relocate_audio_item(
    audio_id: int,
    payload: RelocateAudioRequest,
    session: Session = Depends(get_session),
):
    item = session.get(AudioItem, audio_id)
    if not item:
        raise HTTPException(status_code=404, detail="Audio item not found")

    new_path = Path(payload.file_path).expanduser().resolve()

    if not new_path.exists() or not new_path.is_file():
        raise HTTPException(status_code=400, detail="Invalid audio file path")

    if new_path.suffix.lower() not in SUPPORTED_EXTS:
        raise HTTPException(status_code=400, detail="Unsupported audio format")

    exists = session.exec(
        select(AudioItem).where(
            AudioItem.file_path == str(new_path),
            AudioItem.id != audio_id,
        )
    ).first()

    if exists:
        raise HTTPException(status_code=409, detail="Another audio item already uses this file path")

    stat = new_path.stat()
    meta = read_audio_metadata(new_path)

    item.file_path = str(new_path)
    item.file_name = new_path.name
    item.file_ext = new_path.suffix.lower()
    item.file_size = stat.st_size
    item.file_mtime = datetime.utcfromtimestamp(stat.st_mtime).isoformat()
    item.library_root_id = _find_library_root_id_for_path(session, new_path)
    item.is_missing = False

    for key, value in meta.items():
        setattr(item, key, value)

    if item.cover_source != "user":
        cover = extract_embedded_cover(new_path, item.id)
        if cover:
            item.cover_path = cover["cover_path"]
            item.cover_source = cover["cover_source"]

    item.updated_at = now_iso()
    session.add(item)
    session.commit()
    session.refresh(item)

    rebuild_audio_search_index(session, item.id)
    logger.info("Audio item relocated id=%s path=%s", audio_id, new_path)

    return item


@app.post("/audio-items/{audio_id}/playback-position")
def update_playback_position(
    audio_id: int,
    payload: PlaybackPositionUpdate,
    session: Session = Depends(get_session),
):
    item = session.get(AudioItem, audio_id)
    if not item:
        raise HTTPException(status_code=404, detail="Audio item not found")

    item.last_position_seconds = payload.last_position_seconds
    item.last_played_at = now_iso()
    item.updated_at = now_iso()
    session.add(item)
    session.commit()
    return {"ok": True}


@app.post("/audio-items/{audio_id}/play-count")
def increment_play_count(audio_id: int, session: Session = Depends(get_session)):
    item = session.get(AudioItem, audio_id)
    if not item:
        raise HTTPException(status_code=404, detail="Audio item not found")

    item.play_count += 1
    item.last_played_at = now_iso()
    item.updated_at = now_iso()
    session.add(item)
    session.commit()
    return {"ok": True}


@app.get("/audio-items/{audio_id}/file")
def get_audio_file(audio_id: int, session: Session = Depends(get_session)):
    item = session.get(AudioItem, audio_id)
    if not item:
        raise HTTPException(status_code=404, detail="Audio item not found")

    path = Path(item.file_path)
    if not path.exists():
        item.is_missing = True
        session.add(item)
        session.commit()
        raise HTTPException(status_code=404, detail="Audio file missing")

    media_type = AUDIO_MIME_TYPES.get(path.suffix.lower(), "application/octet-stream")
    return FileResponse(str(path), media_type=media_type, filename=item.file_name)


@app.get("/audio-items/{audio_id}/cover")
def get_audio_cover(audio_id: int, session: Session = Depends(get_session)):
    item = session.get(AudioItem, audio_id)
    if not item:
        raise HTTPException(status_code=404, detail="Audio item not found")

    if not item.cover_path:
        raise HTTPException(status_code=404, detail="Cover not found")

    path = Path(item.cover_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Cover file missing")

    return FileResponse(str(path), media_type=_cover_media_type(path))


@app.post("/audio-items/{audio_id}/cover")
async def upload_audio_cover(
    audio_id: int,
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
):
    item = session.get(AudioItem, audio_id)
    if not item:
        raise HTTPException(status_code=404, detail="Audio item not found")

    original_name = file.filename or ""
    ext = Path(original_name).suffix.lower()

    if ext not in IMAGE_EXTS:
        content_type = file.content_type or ""
        if content_type == "image/png":
            ext = ".png"
        elif content_type in ["image/jpeg", "image/jpg"]:
            ext = ".jpg"
        elif content_type == "image/webp":
            ext = ".webp"
        else:
            raise HTTPException(status_code=400, detail="Unsupported image format")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty cover file")

    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Cover file is too large")

    COVERS_DIR.mkdir(parents=True, exist_ok=True)

    for old in COVERS_DIR.glob(f"audio_{audio_id}.*"):
        try:
            old.unlink()
        except Exception:
            pass

    out = COVERS_DIR / f"audio_{audio_id}{ext}"
    out.write_bytes(data)

    item.cover_path = str(out)
    item.cover_source = "user"
    item.updated_at = now_iso()

    session.add(item)
    session.commit()
    session.refresh(item)

    logger.info("Cover uploaded audio_id=%s path=%s", audio_id, out)
    return item


@app.delete("/audio-items/{audio_id}/cover")
def delete_audio_cover(audio_id: int, session: Session = Depends(get_session)):
    item = session.get(AudioItem, audio_id)
    if not item:
        raise HTTPException(status_code=404, detail="Audio item not found")

    if item.cover_path:
        try:
            path = Path(item.cover_path)
            if path.exists() and path.parent == COVERS_DIR:
                path.unlink()
        except Exception:
            pass

    item.cover_path = None
    item.cover_source = None
    item.updated_at = now_iso()

    session.add(item)
    session.commit()
    session.refresh(item)

    logger.info("Cover deleted audio_id=%s", audio_id)
    return item


@app.get("/audio-items/{audio_id}/ai-suggestions")
def get_audio_ai_suggestions(audio_id: int, session: Session = Depends(get_session)):
    audio = session.get(AudioItem, audio_id)
    if not audio:
        raise HTTPException(status_code=404, detail="Audio item not found")

    tasks = session.exec(
        select(AITask)
        .where(AITask.audio_id == audio_id)
        .where(AITask.task_type == "analyze")
        .where(AITask.output_payload != None)
        .order_by(AITask.created_at.desc())
        .limit(20)
    ).all()

    for task in tasks:
        payload = _parse_task_output_payload(task.output_payload)

        tags = payload.get("tags", [])
        if not isinstance(tags, list):
            tags = []

        tags = [str(x).strip() for x in tags if str(x).strip()]
        description = payload.get("description") or audio.description_ai
        language = payload.get("language") or audio.language

        if description or tags:
            return {
                "task_id": task.id,
                "description": description,
                "tags": tags,
                "language": language,
                "raw_content": payload.get("raw_content"),
            }

    return {
        "task_id": None,
        "description": audio.description_ai,
        "tags": [],
        "language": audio.language,
        "raw_content": None,
    }


# Tags

@app.get("/tags")
def list_tags(session: Session = Depends(get_session)):
    return session.exec(select(Tag).order_by(Tag.name)).all()


@app.patch("/tags/{tag_id}")
def update_tag(
    tag_id: int,
    payload: TagUpdate,
    session: Session = Depends(get_session),
):
    tag = session.get(Tag, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    name = payload.name.strip() if payload.name is not None else None
    if not name:
        raise HTTPException(status_code=400, detail="Tag name is required")

    exists = session.exec(
        select(Tag).where(Tag.name == name, Tag.id != tag_id)
    ).first()

    if exists:
        raise HTTPException(status_code=409, detail="Tag name already exists")

    audio_ids = session.exec(
        select(AudioTag.audio_id).where(AudioTag.tag_id == tag_id)
    ).all()

    tag.name = name
    session.add(tag)
    session.commit()
    session.refresh(tag)

    for audio_id in audio_ids:
        rebuild_audio_search_index(session, audio_id)

    logger.info("Tag renamed id=%s name=%s", tag_id, name)
    return tag


@app.delete("/tags/{tag_id}")
def delete_tag(
    tag_id: int,
    force: bool = False,
    session: Session = Depends(get_session),
):
    tag = session.get(Tag, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    links = session.exec(
        select(AudioTag).where(AudioTag.tag_id == tag_id)
    ).all()

    if links and not force:
        raise HTTPException(status_code=400, detail="Tag is still used by audio items")

    affected_audio_ids = [link.audio_id for link in links]

    for link in links:
        session.delete(link)

    session.delete(tag)
    session.commit()

    for audio_id in affected_audio_ids:
        rebuild_audio_search_index(session, audio_id)

    logger.info("Tag deleted id=%s force=%s", tag_id, force)
    return {
        "ok": True,
        "affected_audio_items": len(affected_audio_ids),
    }


@app.post("/audio-items/{audio_id}/tags")
def add_tags_to_audio(
    audio_id: int,
    payload: TagsAddRequest,
    session: Session = Depends(get_session),
):
    item = session.get(AudioItem, audio_id)
    if not item:
        raise HTTPException(status_code=404, detail="Audio item not found")

    result = []

    for name in payload.tags:
        name = name.strip()
        if not name:
            continue

        tag = session.exec(select(Tag).where(Tag.name == name)).first()
        if not tag:
            tag = Tag(name=name, source=payload.source)
            session.add(tag)
            session.commit()
            session.refresh(tag)

        exists = session.exec(
            select(AudioTag).where(
                AudioTag.audio_id == audio_id,
                AudioTag.tag_id == tag.id,
            )
        ).first()

        if not exists:
            link = AudioTag(audio_id=audio_id, tag_id=tag.id)
            session.add(link)

        result.append(tag)

    item.updated_at = now_iso()
    session.add(item)
    session.commit()
    rebuild_audio_search_index(session, audio_id)
    return result


@app.delete("/audio-items/{audio_id}/tags/{tag_id}")
def remove_audio_tag(audio_id: int, tag_id: int, session: Session = Depends(get_session)):
    link = session.get(AudioTag, (audio_id, tag_id))
    if not link:
        raise HTTPException(status_code=404, detail="Audio tag relation not found")

    session.delete(link)

    item = session.get(AudioItem, audio_id)
    if item:
        item.updated_at = now_iso()
        session.add(item)

    session.commit()
    rebuild_audio_search_index(session, audio_id)
    return {"ok": True}


# Playlists

@app.post("/playlists")
def create_playlist(payload: PlaylistCreate, session: Session = Depends(get_session)):
    playlist = Playlist(name=payload.name, description=payload.description)
    session.add(playlist)
    session.commit()
    session.refresh(playlist)
    return playlist


@app.get("/playlists")
def list_playlists(session: Session = Depends(get_session)):
    return session.exec(select(Playlist).order_by(Playlist.created_at)).all()


@app.get("/playlists/{playlist_id}")
def get_playlist(playlist_id: int, session: Session = Depends(get_session)):
    playlist = session.get(Playlist, playlist_id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")

    items = session.exec(
        select(PlaylistItem, AudioItem)
        .join(AudioItem, PlaylistItem.audio_id == AudioItem.id)
        .where(PlaylistItem.playlist_id == playlist_id)
        .order_by(PlaylistItem.order_index)
    ).all()

    return {
        "playlist": playlist,
        "items": [
            {
                "playlist_item": pi,
                "audio": _audio_with_tags_dict(session, audio),
            }
            for pi, audio in items
        ],
    }


@app.post("/playlists/{playlist_id}/items")
def add_audio_to_playlist(
    playlist_id: int,
    payload: PlaylistItemAdd,
    session: Session = Depends(get_session),
):
    playlist = session.get(Playlist, playlist_id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")

    audio = session.get(AudioItem, payload.audio_id)
    if not audio:
        raise HTTPException(status_code=404, detail="Audio not found")

    max_order = session.exec(
        select(func.max(PlaylistItem.order_index)).where(
            PlaylistItem.playlist_id == playlist_id
        )
    ).one()

    next_order = 0 if max_order is None else max_order + 1

    item = PlaylistItem(
        playlist_id=playlist_id,
        audio_id=payload.audio_id,
        order_index=next_order,
    )
    session.add(item)

    playlist.updated_at = now_iso()
    session.add(playlist)

    session.commit()
    session.refresh(item)
    return item


@app.patch("/playlists/{playlist_id}/items/reorder")
def reorder_playlist_items(
    playlist_id: int,
    payload: PlaylistItemsReorder,
    session: Session = Depends(get_session),
):
    playlist = session.get(Playlist, playlist_id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")

    items = session.exec(
        select(PlaylistItem).where(PlaylistItem.playlist_id == playlist_id)
    ).all()

    current_by_id = {item.id: item for item in items}
    requested_ids = payload.item_ids

    if len(requested_ids) != len(set(requested_ids)):
        raise HTTPException(status_code=400, detail="Duplicate playlist item ids")

    if set(requested_ids) != set(current_by_id.keys()):
        raise HTTPException(
            status_code=400,
            detail="item_ids must exactly match current playlist items",
        )

    for order_index, item_id in enumerate(requested_ids):
        row = current_by_id[item_id]
        row.order_index = order_index
        session.add(row)

    playlist.updated_at = now_iso()
    session.add(playlist)

    session.commit()

    logger.info("Playlist reordered id=%s count=%s", playlist_id, len(requested_ids))
    return {
        "ok": True,
        "count": len(requested_ids),
    }


@app.delete("/playlists/{playlist_id}/items/{item_id}")
def remove_playlist_item(
    playlist_id: int,
    item_id: int,
    session: Session = Depends(get_session),
):
    item = session.get(PlaylistItem, item_id)
    if not item or item.playlist_id != playlist_id:
        raise HTTPException(status_code=404, detail="Playlist item not found")

    playlist = session.get(Playlist, playlist_id)

    session.delete(item)

    if playlist:
        playlist.updated_at = now_iso()
        session.add(playlist)

    session.commit()
    return {"ok": True}


@app.get("/playlists/{playlist_id}/export")
def export_playlist(
    playlist_id: int,
    format: str = "json",
    session: Session = Depends(get_session),
):
    playlist = session.get(Playlist, playlist_id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")

    rows = session.exec(
        select(PlaylistItem, AudioItem)
        .join(AudioItem, PlaylistItem.audio_id == AudioItem.id)
        .where(PlaylistItem.playlist_id == playlist_id)
        .order_by(PlaylistItem.order_index)
    ).all()

    if format == "m3u":
        lines = ["#EXTM3U"]
        for _, audio in rows:
            duration = int(audio.duration_seconds or -1)
            title = audio.title_user or audio.title_original or audio.file_name
            lines.append(f"#EXTINF:{duration},{title}")
            lines.append(audio.file_path)

        return PlainTextResponse(
            "\n".join(lines),
            media_type="audio/x-mpegurl",
            headers=_attachment_headers(f"{playlist.name}.m3u"),
        )

    data = {
        "playlist": playlist.model_dump(),
        "items": [
            {
                "playlist_item": pi.model_dump(),
                "audio": audio.model_dump(),
            }
            for pi, audio in rows
        ],
    }

    return Response(
        json.dumps(data, ensure_ascii=False, indent=2),
        media_type="application/json",
        headers=_attachment_headers(f"{playlist.name}.json"),
    )


# Transcript

@app.post("/audio-items/{audio_id}/transcribe")
def enqueue_transcribe(audio_id: int, session: Session = Depends(get_session)):
    audio = session.get(AudioItem, audio_id)
    if not audio:
        raise HTTPException(status_code=404, detail="Audio not found")

    if audio.transcript_status in BUSY_AUDIO_TASK_STATUSES:
        raise HTTPException(
            status_code=409,
            detail="Transcribe task is already pending, running or canceling",
        )

    audio.transcript_status = "pending"
    audio.updated_at = now_iso()
    session.add(audio)
    session.commit()

    task = create_task(session, audio_id, "transcribe")
    return task


@app.get("/audio-items/{audio_id}/transcript")
def get_transcript(audio_id: int, session: Session = Depends(get_session)):
    transcript = session.exec(
        select(Transcript).where(Transcript.audio_id == audio_id)
    ).first()

    if not transcript:
        raise HTTPException(status_code=404, detail="Transcript not found")

    segments = session.exec(
        select(TranscriptSegment)
        .where(TranscriptSegment.transcript_id == transcript.id)
        .order_by(TranscriptSegment.segment_index)
    ).all()

    return {
        "transcript": transcript,
        "segments": segments,
    }


@app.get("/audio-items/{audio_id}/transcript/export")
def export_transcript(
    audio_id: int,
    format: str = "txt",
    session: Session = Depends(get_session),
):
    audio = session.get(AudioItem, audio_id)
    if not audio:
        raise HTTPException(status_code=404, detail="Audio not found")

    transcript = session.exec(
        select(Transcript).where(Transcript.audio_id == audio_id)
    ).first()

    if not transcript:
        raise HTTPException(status_code=404, detail="Transcript not found")

    segments = session.exec(
        select(TranscriptSegment)
        .where(TranscriptSegment.transcript_id == transcript.id)
        .order_by(TranscriptSegment.segment_index)
    ).all()

    base_name = audio.title_user or audio.title_original or audio.file_name

    if format == "json":
        data = {
            "audio": audio.model_dump(),
            "transcript": transcript.model_dump(),
            "segments": [seg.model_dump() for seg in segments],
        }

        return Response(
            json.dumps(data, ensure_ascii=False, indent=2),
            media_type="application/json",
            headers=_attachment_headers(f"{base_name}.transcript.json"),
        )

    if format == "srt":
        blocks = []
        for idx, seg in enumerate(segments, start=1):
            blocks.append(
                f"{idx}\n"
                f"{_srt_time(seg.start_seconds)} --> {_srt_time(seg.end_seconds)}\n"
                f"{seg.text}\n"
            )

        return PlainTextResponse(
            "\n".join(blocks),
            media_type="application/x-subrip",
            headers=_attachment_headers(f"{base_name}.srt"),
        )

    return PlainTextResponse(
        transcript.full_text,
        media_type="text/plain; charset=utf-8",
        headers=_attachment_headers(f"{base_name}.txt"),
    )


@app.post("/audio-items/{audio_id}/transcript")
def save_transcript(
    audio_id: int,
    payload: TranscriptCreate,
    session: Session = Depends(get_session),
):
    audio = session.get(AudioItem, audio_id)
    if not audio:
        raise HTTPException(status_code=404, detail="Audio not found")

    existing = session.exec(
        select(Transcript).where(Transcript.audio_id == audio_id)
    ).first()

    if existing:
        old_segments = session.exec(
            select(TranscriptSegment).where(
                TranscriptSegment.transcript_id == existing.id
            )
        ).all()

        for seg in old_segments:
            session.delete(seg)

        session.delete(existing)
        session.flush()

    transcript = Transcript(
        audio_id=audio_id,
        language=payload.language,
        full_text=payload.full_text,
        model_name=payload.model_name,
        status="done",
        generated_at=now_iso(),
        updated_at=now_iso(),
    )
    session.add(transcript)
    session.flush()

    if transcript.id is None:
        raise HTTPException(status_code=500, detail="Failed to create transcript")

    for seg in payload.segments:
        session.add(
            TranscriptSegment(
                transcript_id=transcript.id,
                segment_index=seg.segment_index,
                start_seconds=seg.start_seconds,
                end_seconds=seg.end_seconds,
                text=seg.text,
            )
        )

    audio.transcript_status = "done"
    audio.updated_at = now_iso()
    session.add(audio)
    session.commit()
    session.refresh(transcript)

    rebuild_audio_search_index(session, audio_id)

    return transcript


# AI

@app.post("/audio-items/{audio_id}/analyze")
def enqueue_analyze(audio_id: int, session: Session = Depends(get_session)):
    audio = session.get(AudioItem, audio_id)
    if not audio:
        raise HTTPException(status_code=404, detail="Audio not found")

    if audio.ai_status in BUSY_AUDIO_TASK_STATUSES:
        raise HTTPException(
            status_code=409,
            detail="Analyze task is already pending, running or canceling",
        )

    endpoint = session.get(Setting, "llm.endpoint")
    model_name = session.get(Setting, "llm.model_name")

    if not endpoint or not endpoint.value or not model_name or not model_name.value:
        raise HTTPException(status_code=400, detail="LLM endpoint or model_name is not configured")

    warning = _llm_privacy_warning(endpoint.value)
    if warning:
        logger.warning("Analyze uses non-local LLM endpoint: %s", endpoint.value)

    audio.ai_status = "pending"
    audio.updated_at = now_iso()
    session.add(audio)
    session.commit()

    task = create_task(session, audio_id, "analyze")
    return {
        **task.model_dump(),
        "privacy_warning": warning,
    }


@app.post("/ai/test-llm")
async def test_llm_config(payload: LLMConfig):
    if not payload.endpoint or not payload.model_name:
        raise HTTPException(status_code=400, detail="endpoint and model_name are required")

    warning = _llm_privacy_warning(payload.endpoint)

    try:
        response = await call_openai_compatible_chat(
            endpoint=payload.endpoint,
            model_name=payload.model_name,
            api_key=payload.api_key or None,
            timeout=payload.timeout,
            max_tokens=payload.max_tokens or 64,
            temperature=payload.temperature if payload.temperature is not None else 0,
            messages=[
                {
                    "role": "system",
                    "content": "You are a connection test assistant. Reply briefly.",
                },
                {
                    "role": "user",
                    "content": "Return exactly: ok",
                },
            ],
        )

        content = get_ai_message_content(response)

        return {
            "ok": True,
            "content": content,
            "is_local_endpoint": warning is None,
            "privacy_warning": warning,
        }

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/ai-tasks")
def list_ai_tasks(session: Session = Depends(get_session)):
    return session.exec(select(AITask).order_by(AITask.created_at.desc()).limit(100)).all()


@app.get("/ai-tasks/{task_id}")
def get_ai_task(task_id: int, session: Session = Depends(get_session)):
    task = session.get(AITask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@app.post("/ai-tasks/{task_id}/retry")
def retry_ai_task(task_id: int, session: Session = Depends(get_session)):
    task = session.get(AITask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.status not in ["failed", "canceled"]:
        raise HTTPException(status_code=400, detail="Only failed/canceled task can be retried")

    task.status = "pending"
    task.retry_count += 1
    task.error_message = None
    task.output_payload = None
    task.started_at = None
    task.finished_at = None
    task.updated_at = now_iso()
    session.add(task)

    audio = session.get(AudioItem, task.audio_id)
    if audio:
        if task.task_type == "transcribe":
            audio.transcript_status = "pending"
        if task.task_type == "analyze":
            audio.ai_status = "pending"

        audio.updated_at = now_iso()
        session.add(audio)

    session.commit()
    session.refresh(task)
    return task


@app.post("/ai-tasks/{task_id}/cancel")
def cancel_ai_task(task_id: int, session: Session = Depends(get_session)):
    task = session.get(AITask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.status in ["done", "failed", "canceled"]:
        raise HTTPException(status_code=400, detail="Task cannot be canceled")

    if task.status == "cancel_requested":
        return task

    task.updated_at = now_iso()

    if task.status == "running":
        task.status = "cancel_requested"
        audio_status = "cancel_requested"
    else:
        task.status = "canceled"
        task.finished_at = now_iso()
        audio_status = "canceled"

    session.add(task)

    audio = session.get(AudioItem, task.audio_id)
    if audio:
        if task.task_type == "transcribe":
            audio.transcript_status = audio_status
        if task.task_type == "analyze":
            audio.ai_status = audio_status

        audio.updated_at = now_iso()
        session.add(audio)

    session.commit()
    session.refresh(task)
    return task


# Settings

@app.get("/settings")
def list_settings(session: Session = Depends(get_session)):
    return session.exec(select(Setting)).all()


@app.put("/settings")
def upsert_setting(payload: SettingUpdate, session: Session = Depends(get_session)):
    row = session.get(Setting, payload.key)

    if row:
        row.value = payload.value
        row.updated_at = now_iso()
    else:
        row = Setting(key=payload.key, value=payload.value)

    session.add(row)
    session.commit()
    session.refresh(row)
    return row


# Search / Export / Maintenance / Logs

@app.get("/search")
def search(
    q: str,
    include_disabled_roots: bool = False,
    session: Session = Depends(get_session),
):
    ids = search_audio_ids(session, q)
    if not ids:
        return []

    stmt = select(AudioItem).where(AudioItem.id.in_(ids))
    stmt = _apply_enabled_roots_filter(
        stmt,
        session,
        include_disabled_roots=include_disabled_roots,
    )

    if stmt is None:
        return []

    rows = session.exec(stmt).all()
    row_by_id = {row.id: _audio_with_tags_dict(session, row, search_query=q) for row in rows}

    return [row_by_id[i] for i in ids if i in row_by_id]


@app.get("/export/metadata")
def export_metadata(
    format: str = "json",
    session: Session = Depends(get_session),
):
    items = session.exec(select(AudioItem).order_by(AudioItem.updated_at.desc())).all()

    if format == "csv":
        buf = io.StringIO()
        writer = csv.writer(buf)

        writer.writerow(
            [
                "id",
                "title",
                "author",
                "album",
                "file_path",
                "duration_seconds",
                "language",
                "tags",
                "transcript_status",
                "ai_status",
                "is_favorite",
                "is_missing",
            ]
        )

        for audio in items:
            tags = _tags_for_audio(session, audio.id)

            writer.writerow(
                [
                    audio.id,
                    audio.title_user or audio.title_original or audio.file_name,
                    audio.author_user or audio.author_original or "",
                    audio.album_user or audio.album_original or "",
                    audio.file_path,
                    audio.duration_seconds or "",
                    audio.language or "",
                    ",".join(t.name for t in tags),
                    audio.transcript_status,
                    audio.ai_status,
                    audio.is_favorite,
                    audio.is_missing,
                ]
            )

        return PlainTextResponse(
            buf.getvalue(),
            media_type="text/csv; charset=utf-8",
            headers=_attachment_headers("audio_library_metadata.csv"),
        )

    data = [_audio_to_export_dict(session, audio) for audio in items]

    return Response(
        json.dumps(data, ensure_ascii=False, indent=2),
        media_type="application/json",
        headers=_attachment_headers("audio_library_metadata.json"),
    )


@app.post("/maintenance/rebuild-search-index")
def rebuild_all_search_index(session: Session = Depends(get_session)):
    items = session.exec(select(AudioItem)).all()
    count = 0

    for item in items:
        rebuild_audio_search_index(session, item.id)
        count += 1

    logger.info("Search index rebuilt count=%s", count)
    return {"ok": True, "count": count}


@app.post("/maintenance/cleanup-tags")
def cleanup_orphan_tags(session: Session = Depends(get_session)):
    tags = session.exec(select(Tag)).all()
    deleted = 0

    for tag in tags:
        if tag.id is None:
            continue

        link = session.exec(
            select(AudioTag).where(AudioTag.tag_id == tag.id)
        ).first()

        if not link:
            session.delete(tag)
            deleted += 1

    session.commit()

    logger.info("Orphan tags cleaned count=%s", deleted)
    return {
        "ok": True,
        "deleted": deleted,
    }


@app.get("/logs/app")
def get_app_logs(lines: int = Query(default=300, ge=1, le=2000)):
    return {
        "file": str(LOG_FILE),
        "content": read_log_tail(lines),
    }


@app.get("/logs/app/file")
def get_app_log_file():
    if not LOG_FILE.exists():
        raise HTTPException(status_code=404, detail="Log file not found")

    return FileResponse(str(LOG_FILE), media_type="text/plain", filename="app.log")


================================================================================
文件: backend/app/models.py
================================================================================
from typing import Optional
from sqlmodel import SQLModel, Field
from datetime import datetime


def now_iso() -> str:
    return datetime.utcnow().isoformat()


class LibraryRoot(SQLModel, table=True):
    __tablename__ = "library_roots"

    id: Optional[int] = Field(default=None, primary_key=True)
    path: str = Field(unique=True, index=True)
    is_enabled: bool = True
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class AudioItem(SQLModel, table=True):
    __tablename__ = "audio_items"

    id: Optional[int] = Field(default=None, primary_key=True)

    file_path: str = Field(unique=True, index=True)
    file_name: str
    file_ext: Optional[str] = None
    file_size: Optional[int] = None
    file_mtime: Optional[str] = None
    file_hash: Optional[str] = None

    library_root_id: Optional[int] = Field(default=None, foreign_key="library_roots.id")

    title_original: Optional[str] = None
    title_user: Optional[str] = None

    author_original: Optional[str] = None
    author_user: Optional[str] = None

    album_original: Optional[str] = None
    album_user: Optional[str] = None

    description_original: Optional[str] = None
    description_user: Optional[str] = None
    description_ai: Optional[str] = None

    cover_path: Optional[str] = None
    cover_source: Optional[str] = None

    duration_seconds: Optional[float] = None
    bitrate: Optional[int] = None
    sample_rate: Optional[int] = None
    channels: Optional[int] = None

    language: Optional[str] = None

    transcript_status: str = "none"
    ai_status: str = "none"

    play_count: int = 0
    last_played_at: Optional[str] = None
    last_position_seconds: float = 0

    is_favorite: bool = False
    is_missing: bool = False

    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class Tag(SQLModel, table=True):
    __tablename__ = "tags"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(unique=True, index=True)
    source: str = "user"
    created_at: str = Field(default_factory=now_iso)


class AudioTag(SQLModel, table=True):
    __tablename__ = "audio_tags"

    audio_id: int = Field(foreign_key="audio_items.id", primary_key=True)
    tag_id: int = Field(foreign_key="tags.id", primary_key=True)
    created_at: str = Field(default_factory=now_iso)


class Playlist(SQLModel, table=True):
    __tablename__ = "playlists"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    description: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class PlaylistItem(SQLModel, table=True):
    __tablename__ = "playlist_items"

    id: Optional[int] = Field(default=None, primary_key=True)
    playlist_id: int = Field(foreign_key="playlists.id", index=True)
    audio_id: int = Field(foreign_key="audio_items.id", index=True)
    order_index: int
    created_at: str = Field(default_factory=now_iso)


class Transcript(SQLModel, table=True):
    __tablename__ = "transcripts"

    id: Optional[int] = Field(default=None, primary_key=True)
    audio_id: int = Field(foreign_key="audio_items.id", unique=True, index=True)
    language: Optional[str] = None
    full_text: str
    model_name: Optional[str] = None
    status: str = "done"
    generated_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class TranscriptSegment(SQLModel, table=True):
    __tablename__ = "transcript_segments"

    id: Optional[int] = Field(default=None, primary_key=True)
    transcript_id: int = Field(foreign_key="transcripts.id", index=True)
    segment_index: int
    start_seconds: float
    end_seconds: float
    text: str


class AITask(SQLModel, table=True):
    __tablename__ = "ai_tasks"

    id: Optional[int] = Field(default=None, primary_key=True)
    audio_id: int = Field(foreign_key="audio_items.id", index=True)
    task_type: str
    status: str = "pending"
    input_payload: Optional[str] = None
    output_payload: Optional[str] = None
    error_message: Optional[str] = None
    retry_count: int = 0
    created_at: str = Field(default_factory=now_iso)
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    updated_at: str = Field(default_factory=now_iso)


class Setting(SQLModel, table=True):
    __tablename__ = "settings"

    key: str = Field(primary_key=True)
    value: str
    updated_at: str = Field(default_factory=now_iso)


class ScanTask(SQLModel, table=True):
    __tablename__ = "scan_tasks"

    id: Optional[int] = Field(default=None, primary_key=True)
    root_id: int = Field(foreign_key="library_roots.id", index=True)

    status: str = "pending"

    total_files: int = 0
    processed_files: int = 0

    imported: int = 0
    updated: int = 0
    missing: int = 0

    error_message: Optional[str] = None

    created_at: str = Field(default_factory=now_iso)
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    updated_at: str = Field(default_factory=now_iso)


================================================================================
文件: backend/app/scanner.py
================================================================================
import base64
from pathlib import Path
from typing import Optional
from datetime import datetime

from sqlmodel import Session, select
from mutagen import File as MutagenFile

from .db import COVERS_DIR, engine
from .models import AudioItem, LibraryRoot, ScanTask, now_iso
from .search import rebuild_audio_search_index
from .logger import get_logger

logger = get_logger(__name__)

SUPPORTED_EXTS = {".mp3", ".m4a", ".flac", ".wav", ".ogg"}


def _tag_first(tags, keys: list[str]) -> Optional[str]:
    if not tags:
        return None

    for key in keys:
        try:
            value = tags.get(key)
        except Exception:
            value = None

        if value:
            if isinstance(value, list):
                return str(value[0])
            return str(value)

    return None


def read_audio_metadata(path: Path) -> dict:
    metadata = {
        "title_original": None,
        "author_original": None,
        "album_original": None,
        "description_original": None,
        "duration_seconds": None,
        "bitrate": None,
        "sample_rate": None,
        "channels": None,
    }

    try:
        audio = MutagenFile(str(path))
        if audio is None:
            return metadata

        info = getattr(audio, "info", None)
        if info:
            metadata["duration_seconds"] = getattr(info, "length", None)
            metadata["bitrate"] = getattr(info, "bitrate", None)
            metadata["sample_rate"] = getattr(info, "sample_rate", None)
            metadata["channels"] = getattr(info, "channels", None)

        tags = getattr(audio, "tags", None)
        if tags:
            metadata["title_original"] = _tag_first(tags, ["TIT2", "\xa9nam", "TITLE", "title"])
            metadata["author_original"] = _tag_first(tags, ["TPE1", "\xa9ART", "ARTIST", "artist"])
            metadata["album_original"] = _tag_first(tags, ["TALB", "\xa9alb", "ALBUM", "album"])
            metadata["description_original"] = _tag_first(
                tags,
                ["COMM::eng", "COMM", "\xa9cmt", "DESCRIPTION", "COMMENT", "comment"],
            )

    except Exception as e:
        logger.warning("Failed to read metadata for %s: %s", path, e)

    return metadata


def _cover_ext_from_mime(mime: Optional[str]) -> str:
    if not mime:
        return ".jpg"

    mime = mime.lower()
    if "png" in mime:
        return ".png"
    if "webp" in mime:
        return ".webp"
    if "jpeg" in mime or "jpg" in mime:
        return ".jpg"

    return ".jpg"


def _save_cover_bytes(audio_id: int, data: bytes, mime: Optional[str]) -> Optional[str]:
    if not data:
        return None

    COVERS_DIR.mkdir(parents=True, exist_ok=True)

    for old in COVERS_DIR.glob(f"audio_{audio_id}.*"):
        try:
            old.unlink()
        except Exception:
            pass

    ext = _cover_ext_from_mime(mime)
    out = COVERS_DIR / f"audio_{audio_id}{ext}"
    out.write_bytes(data)
    return str(out)


def extract_embedded_cover(path: Path, audio_id: int) -> Optional[dict]:
    """
    尽量从常见格式中提取内嵌封面：
    - MP3 ID3 APIC
    - M4A covr
    - FLAC pictures
    - OGG/Vorbis METADATA_BLOCK_PICTURE
    """
    try:
        audio = MutagenFile(str(path))
        if audio is None:
            return None

        data = None
        mime = None

        tags = getattr(audio, "tags", None)

        if tags:
            try:
                for key in tags.keys():
                    if str(key).startswith("APIC"):
                        apic = tags[key]
                        data = getattr(apic, "data", None)
                        mime = getattr(apic, "mime", None)
                        break
            except Exception:
                pass

        if data is None and tags:
            try:
                covr = tags.get("covr")
                if covr:
                    cover = covr[0]
                    data = bytes(cover)

                    try:
                        from mutagen.mp4 import MP4Cover

                        if getattr(cover, "imageformat", None) == MP4Cover.FORMAT_PNG:
                            mime = "image/png"
                        else:
                            mime = "image/jpeg"
                    except Exception:
                        mime = "image/jpeg"
            except Exception:
                pass

        if data is None:
            try:
                pictures = getattr(audio, "pictures", None)
                if pictures:
                    pic = pictures[0]
                    data = pic.data
                    mime = pic.mime
            except Exception:
                pass

        if data is None and tags:
            try:
                from mutagen.flac import Picture

                value = tags.get("metadata_block_picture") or tags.get("METADATA_BLOCK_PICTURE")
                if value:
                    raw = value[0] if isinstance(value, list) else value
                    pic = Picture(base64.b64decode(raw))
                    data = pic.data
                    mime = pic.mime
            except Exception:
                pass

        if not data:
            return None

        cover_path = _save_cover_bytes(audio_id, data, mime)
        if not cover_path:
            return None

        return {
            "cover_path": cover_path,
            "cover_source": "embedded",
        }

    except Exception as e:
        logger.warning("Failed to extract cover for %s: %s", path, e)
        return None


def _update_scan_task(session: Session, task_id: Optional[int], **kwargs):
    if not task_id:
        return

    task = session.get(ScanTask, task_id)
    if not task:
        return

    for key, value in kwargs.items():
        setattr(task, key, value)

    task.updated_at = now_iso()
    session.add(task)
    session.commit()


def _is_scan_canceled(session: Session, task_id: Optional[int]) -> bool:
    if not task_id:
        return False

    session.expire_all()
    task = session.get(ScanTask, task_id)
    return bool(task and task.status == "canceled")


def _ensure_cover(session: Session, item: AudioItem, file_path: Path):
    if item.cover_source == "user" and item.cover_path and Path(item.cover_path).exists():
        return

    if item.cover_source == "embedded" and item.cover_path and Path(item.cover_path).exists():
        return

    cover = extract_embedded_cover(file_path, item.id)
    if cover:
        item.cover_path = cover["cover_path"]
        item.cover_source = cover["cover_source"]
        item.updated_at = now_iso()
        session.add(item)
        session.commit()


def scan_library_root(session: Session, root_id: int, scan_task_id: Optional[int] = None) -> dict:
    root = session.get(LibraryRoot, root_id)
    if not root:
        raise ValueError("Library root not found")

    root_path = Path(root.path).expanduser().resolve()
    if not root_path.exists() or not root_path.is_dir():
        raise ValueError("Invalid library root path")

    if _is_scan_canceled(session, scan_task_id):
        return {
            "imported": 0,
            "updated": 0,
            "missing": 0,
        }

    candidates = [
        p
        for p in root_path.rglob("*")
        if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS
    ]

    imported = 0
    updated = 0
    missing = 0
    processed = 0
    found_paths = set()
    canceled = False

    _update_scan_task(
        session,
        scan_task_id,
        status="running",
        started_at=now_iso(),
        total_files=len(candidates),
        processed_files=0,
        imported=0,
        updated=0,
        missing=0,
        error_message=None,
    )

    logger.info("Scanning root %s, files=%s", root.path, len(candidates))

    for file_path in candidates:
        if _is_scan_canceled(session, scan_task_id):
            canceled = True
            _update_scan_task(
                session,
                scan_task_id,
                status="canceled",
                finished_at=now_iso(),
            )
            break

        resolved = str(file_path.resolve())
        found_paths.add(resolved)

        existing = session.exec(
            select(AudioItem).where(AudioItem.file_path == resolved)
        ).first()

        stat = file_path.stat()
        mtime = datetime.utcfromtimestamp(stat.st_mtime).isoformat()

        if existing:
            existing.file_size = stat.st_size
            existing.file_mtime = mtime
            existing.is_missing = False
            existing.library_root_id = root.id
            existing.updated_at = now_iso()

            meta = read_audio_metadata(file_path)
            for key, value in meta.items():
                setattr(existing, key, value)

            session.add(existing)
            session.commit()

            _ensure_cover(session, existing, file_path)
            rebuild_audio_search_index(session, existing.id)

            updated += 1

        else:
            meta = read_audio_metadata(file_path)

            item = AudioItem(
                file_path=resolved,
                file_name=file_path.name,
                file_ext=file_path.suffix.lower(),
                file_size=stat.st_size,
                file_mtime=mtime,
                library_root_id=root.id,
                **meta,
            )
            session.add(item)
            session.commit()
            session.refresh(item)

            _ensure_cover(session, item, file_path)
            rebuild_audio_search_index(session, item.id)

            imported += 1

        processed += 1

        _update_scan_task(
            session,
            scan_task_id,
            processed_files=processed,
            imported=imported,
            updated=updated,
            missing=missing,
        )

    if canceled or _is_scan_canceled(session, scan_task_id):
        _update_scan_task(
            session,
            scan_task_id,
            status="canceled",
            processed_files=processed,
            imported=imported,
            updated=updated,
            missing=missing,
            finished_at=now_iso(),
        )

        logger.info(
            "Scan canceled root=%s imported=%s updated=%s missing=%s",
            root.path,
            imported,
            updated,
            missing,
        )

        return {
            "imported": imported,
            "updated": updated,
            "missing": missing,
        }

    items = session.exec(
        select(AudioItem).where(AudioItem.library_root_id == root.id)
    ).all()

    for item in items:
        if item.file_path not in found_paths:
            item.is_missing = True
            item.updated_at = now_iso()
            session.add(item)
            missing += 1

    session.commit()

    _update_scan_task(
        session,
        scan_task_id,
        status="done",
        processed_files=processed,
        imported=imported,
        updated=updated,
        missing=missing,
        finished_at=now_iso(),
    )

    logger.info(
        "Scan done root=%s imported=%s updated=%s missing=%s",
        root.path,
        imported,
        updated,
        missing,
    )

    return {
        "imported": imported,
        "updated": updated,
        "missing": missing,
    }


def scan_library_root_task(root_id: int, scan_task_id: int):
    with Session(engine) as session:
        try:
            scan_library_root(session, root_id, scan_task_id=scan_task_id)

        except Exception as e:
            logger.exception("Scan task failed root_id=%s task_id=%s", root_id, scan_task_id)

            task = session.get(ScanTask, scan_task_id)
            if task:
                task.status = "failed"
                task.error_message = str(e)
                task.finished_at = now_iso()
                task.updated_at = now_iso()
                session.add(task)
                session.commit()


================================================================================
文件: backend/app/schemas.py
================================================================================
from typing import Optional, List, Any
from pydantic import BaseModel, Field


class LibraryRootCreate(BaseModel):
    path: str


class LibraryRootUpdate(BaseModel):
    is_enabled: Optional[bool] = None


class AudioUpdate(BaseModel):
    title_user: Optional[str] = None
    author_user: Optional[str] = None
    album_user: Optional[str] = None
    description_user: Optional[str] = None
    language: Optional[str] = None
    is_favorite: Optional[bool] = None


class PlaybackPositionUpdate(BaseModel):
    last_position_seconds: float


class RelocateAudioRequest(BaseModel):
    file_path: str


class TagsAddRequest(BaseModel):
    tags: List[str]
    source: str = "user"


class TagUpdate(BaseModel):
    name: Optional[str] = None


class PlaylistCreate(BaseModel):
    name: str
    description: Optional[str] = None


class PlaylistItemAdd(BaseModel):
    audio_id: int


class PlaylistItemsReorder(BaseModel):
    item_ids: List[int]


class TranscriptSegmentCreate(BaseModel):
    segment_index: int
    start_seconds: float
    end_seconds: float
    text: str


class TranscriptCreate(BaseModel):
    language: Optional[str] = None
    full_text: str
    model_name: Optional[str] = None
    segments: List[TranscriptSegmentCreate] = Field(default_factory=list)


class SettingUpdate(BaseModel):
    key: str
    value: str


class LLMConfig(BaseModel):
    endpoint: str
    model_name: str
    api_key: Optional[str] = None
    timeout: int = 60
    max_tokens: Optional[int] = 800
    temperature: Optional[float] = 0.2


class BatchAudioRequest(BaseModel):
    audio_ids: List[int]


class ApiResponse(BaseModel):
    data: Any = None
    error: Optional[dict] = None


================================================================================
文件: backend/app/search.py
================================================================================
from sqlmodel import Session, select
from sqlalchemy import text
from .models import AudioItem, Tag, AudioTag, Transcript


def get_display_title(audio: AudioItem) -> str:
    return audio.title_user or audio.title_original or audio.file_name


def get_display_author(audio: AudioItem) -> str:
    return audio.author_user or audio.author_original or ""


def get_display_description(audio: AudioItem) -> str:
    return audio.description_user or audio.description_ai or audio.description_original or ""


def rebuild_audio_search_index(session: Session, audio_id: int):
    audio = session.get(AudioItem, audio_id)
    if not audio:
        return

    tag_rows = session.exec(
        select(Tag)
        .join(AudioTag, AudioTag.tag_id == Tag.id)
        .where(AudioTag.audio_id == audio_id)
    ).all()
    tag_text = " ".join([t.name for t in tag_rows])

    transcript = session.exec(
        select(Transcript).where(Transcript.audio_id == audio_id)
    ).first()
    transcript_text = transcript.full_text if transcript else ""

    session.execute(
        text("DELETE FROM search_index WHERE audio_id = :audio_id"),
        {"audio_id": audio_id},
    )

    session.execute(
        text(
            """
            INSERT INTO search_index(audio_id, title, author, description, tags, transcript)
            VALUES (:audio_id, :title, :author, :description, :tags, :transcript)
            """
        ),
        {
            "audio_id": audio_id,
            "title": get_display_title(audio),
            "author": get_display_author(audio),
            "description": get_display_description(audio),
            "tags": tag_text,
            "transcript": transcript_text,
        },
    )
    session.commit()


def _escape_fts5_phrase(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def _build_safe_fts5_query(q: str) -> str:
    """
    将用户输入转换为相对安全的 FTS5 MATCH 查询。

    - 普通空格分词：foo bar -> "foo" AND "bar"
    - 中文或无空格文本：线性代数 -> "线性代数"
    - 引号、冒号、括号、减号等特殊字符被包进 phrase，避免 MATCH 语法错误
    """
    tokens = [x.strip() for x in q.strip().split() if x.strip()]
    if not tokens:
        return ""

    return " AND ".join(_escape_fts5_phrase(token) for token in tokens)


def _like_search_audio_ids(session: Session, q: str, limit: int = 200) -> list[int]:
    pattern = f"%{q}%"

    rows = session.execute(
        text(
            """
            SELECT DISTINCT audio_id
            FROM search_index
            WHERE title LIKE :pattern
               OR author LIKE :pattern
               OR description LIKE :pattern
               OR tags LIKE :pattern
               OR transcript LIKE :pattern
            LIMIT :limit
            """
        ),
        {
            "pattern": pattern,
            "limit": limit,
        },
    ).fetchall()

    return [int(row[0]) for row in rows]


def search_audio_ids(session: Session, q: str) -> list[int]:
    q = q.strip()
    if not q:
        return []

    result: list[int] = []
    seen: set[int] = set()

    fts_query = _build_safe_fts5_query(q)

    if fts_query:
        try:
            rows = session.execute(
                text(
                    """
                    SELECT audio_id
                    FROM search_index
                    WHERE search_index MATCH :q
                    LIMIT 200
                    """
                ),
                {"q": fts_query},
            ).fetchall()

            for row in rows:
                audio_id = int(row[0])
                if audio_id not in seen:
                    seen.add(audio_id)
                    result.append(audio_id)

        except Exception:
            # FTS5 可能因为 tokenizer / 特殊输入出现异常。
            # 下面仍会使用 LIKE 作为兜底。
            pass

    # 即使 FTS 有结果，也额外使用 LIKE 补全。
    # 这样能改善中文、部分词、未分词文本、文件名片段的搜索体验。
    try:
        for audio_id in _like_search_audio_ids(session, q, limit=200):
            if audio_id not in seen:
                seen.add(audio_id)
                result.append(audio_id)
    except Exception:
        pass

    return result[:200]


================================================================================
文件: backend/app/tasks.py
================================================================================
import json
import asyncio
from sqlmodel import Session, select
from sqlalchemy import text

from .db import engine
from .models import AITask, AudioItem, Transcript, TranscriptSegment, Setting
from .models import now_iso
from .transcriber import transcribe_audio
from .search import rebuild_audio_search_index
from .ai_client import (
    call_openai_compatible_chat,
    get_ai_message_content,
    parse_ai_json_content,
)


_task_runner_started = False

CANCEL_REQUEST_STATUSES = {"canceled", "cancel_requested"}


class TaskCanceled(Exception):
    pass


def create_task(
    session: Session,
    audio_id: int,
    task_type: str,
    input_payload: dict | None = None,
) -> AITask:
    task = AITask(
        audio_id=audio_id,
        task_type=task_type,
        status="pending",
        input_payload=json.dumps(input_payload or {}, ensure_ascii=False),
        updated_at=now_iso(),
    )
    session.add(task)
    session.commit()
    session.refresh(task)
    return task


def get_setting(session: Session, key: str, default: str | None = None) -> str | None:
    row = session.get(Setting, key)
    return row.value if row else default


def get_setting_int(session: Session, key: str, default: int) -> int:
    value = get_setting(session, key)
    if value is None or value == "":
        return default

    try:
        return int(value)
    except Exception:
        return default


def get_setting_float(session: Session, key: str, default: float) -> float:
    value = get_setting(session, key)
    if value is None or value == "":
        return default

    try:
        return float(value)
    except Exception:
        return default


def is_task_canceled(session: Session, task_id: int) -> bool:
    session.expire_all()
    task = session.get(AITask, task_id)
    return bool(task and task.status in CANCEL_REQUEST_STATUSES)


def set_audio_task_status(
    session: Session,
    audio_id: int,
    task_type: str,
    status: str,
):
    audio = session.get(AudioItem, audio_id)
    if not audio:
        return

    if task_type == "transcribe":
        audio.transcript_status = status

    if task_type == "analyze":
        audio.ai_status = status

    audio.updated_at = now_iso()
    session.add(audio)
    session.commit()


def finalize_canceled_task(session: Session, task_id: int):
    session.expire_all()
    task = session.get(AITask, task_id)
    if not task:
        return

    task.status = "canceled"
    task.finished_at = task.finished_at or now_iso()
    task.updated_at = now_iso()
    session.add(task)
    session.commit()

    set_audio_task_status(session, task.audio_id, task.task_type, "canceled")


def claim_next_pending_task(session: Session) -> AITask | None:
    task_id = session.exec(
        select(AITask.id)
        .where(AITask.status == "pending")
        .order_by(AITask.created_at)
    ).first()

    if task_id is None:
        return None

    now = now_iso()

    result = session.execute(
        text(
            """
            UPDATE ai_tasks
            SET status = 'running',
                started_at = :now,
                updated_at = :now
            WHERE id = :task_id
              AND status = 'pending'
            """
        ),
        {
            "task_id": task_id,
            "now": now,
        },
    )
    session.commit()

    if result.rowcount != 1:
        return None

    return session.get(AITask, task_id)


async def worker_loop():
    while True:
        await asyncio.sleep(1)

        with Session(engine) as session:
            task = claim_next_pending_task(session)

            if not task:
                continue

            if task.id is None:
                continue

            task_id = task.id

            try:
                if task.task_type == "transcribe":
                    await handle_transcribe_task(session, task)
                elif task.task_type == "analyze":
                    await handle_analyze_task(session, task)
                else:
                    raise ValueError(f"Unknown task type: {task.task_type}")

                session.expire_all()
                fresh = session.get(AITask, task_id)

                if not fresh:
                    continue

                if fresh.status in CANCEL_REQUEST_STATUSES:
                    finalize_canceled_task(session, task_id)
                    continue

                fresh.status = "done"
                fresh.finished_at = now_iso()
                fresh.updated_at = now_iso()
                session.add(fresh)
                session.commit()

            except TaskCanceled:
                session.rollback()
                finalize_canceled_task(session, task_id)

            except Exception as e:
                session.rollback()
                session.expire_all()
                fresh = session.get(AITask, task_id)

                if fresh and fresh.status in CANCEL_REQUEST_STATUSES:
                    finalize_canceled_task(session, task_id)
                    continue

                if not fresh:
                    continue

                fresh.status = "failed"
                fresh.error_message = str(e)
                fresh.finished_at = now_iso()
                fresh.updated_at = now_iso()
                session.add(fresh)

                audio = session.get(AudioItem, fresh.audio_id)
                if audio:
                    if fresh.task_type == "transcribe":
                        audio.transcript_status = "failed"
                    if fresh.task_type == "analyze":
                        audio.ai_status = "failed"

                    audio.updated_at = now_iso()
                    session.add(audio)

                session.commit()


async def handle_transcribe_task(session: Session, task: AITask):
    if task.id is None:
        raise ValueError("Task id is missing")

    task_id = task.id
    audio_id = task.audio_id

    audio = session.get(AudioItem, audio_id)
    if not audio:
        raise ValueError("Audio not found")

    if is_task_canceled(session, task_id):
        raise TaskCanceled()

    audio = session.get(AudioItem, audio_id)
    audio.transcript_status = "running"
    audio.updated_at = now_iso()
    session.add(audio)
    session.commit()

    model_name = get_setting(session, "asr.model_name", "small") or "small"
    device = get_setting(session, "asr.device", "cpu") or "cpu"
    compute_type = get_setting(session, "asr.compute_type", "int8") or "int8"
    beam_size = get_setting_int(session, "asr.beam_size", 5)

    result = await asyncio.to_thread(
        transcribe_audio,
        audio.file_path,
        model_name,
        device,
        compute_type,
        beam_size,
    )

    if is_task_canceled(session, task_id):
        set_audio_task_status(session, audio_id, "transcribe", "canceled")
        raise TaskCanceled()

    old = session.exec(
        select(Transcript).where(Transcript.audio_id == audio_id)
    ).first()

    if old:
        old_segments = session.exec(
            select(TranscriptSegment).where(
                TranscriptSegment.transcript_id == old.id
            )
        ).all()

        for seg in old_segments:
            session.delete(seg)

        session.delete(old)
        session.flush()

    transcript = Transcript(
        audio_id=audio_id,
        language=result.get("language"),
        full_text=result["full_text"],
        model_name=result.get("model_name"),
        status="done",
        generated_at=now_iso(),
        updated_at=now_iso(),
    )
    session.add(transcript)
    session.flush()

    if transcript.id is None:
        raise ValueError("Failed to create transcript")

    for seg in result.get("segments", []):
        row = TranscriptSegment(
            transcript_id=transcript.id,
            segment_index=seg["segment_index"],
            start_seconds=seg["start_seconds"],
            end_seconds=seg["end_seconds"],
            text=seg["text"],
        )
        session.add(row)

    audio = session.get(AudioItem, audio_id)
    if not audio:
        raise ValueError("Audio not found")

    audio.transcript_status = "done"
    audio.updated_at = now_iso()
    session.add(audio)
    session.commit()

    rebuild_audio_search_index(session, audio_id)


async def handle_analyze_task(session: Session, task: AITask):
    if task.id is None:
        raise ValueError("Task id is missing")

    task_id = task.id
    audio_id = task.audio_id

    audio = session.get(AudioItem, audio_id)
    if not audio:
        raise ValueError("Audio not found")

    if is_task_canceled(session, task_id):
        raise TaskCanceled()

    audio = session.get(AudioItem, audio_id)
    audio.ai_status = "running"
    audio.updated_at = now_iso()
    session.add(audio)
    session.commit()

    endpoint = get_setting(session, "llm.endpoint")
    model_name = get_setting(session, "llm.model_name")
    api_key = get_setting(session, "llm.api_key", "")

    timeout = get_setting_int(session, "llm.timeout", 60)
    max_tokens = get_setting_int(session, "llm.max_tokens", 800)
    temperature = get_setting_float(session, "llm.temperature", 0.2)

    if not endpoint or not model_name:
        raise ValueError("LLM endpoint or model_name is not configured")

    transcript = session.exec(
        select(Transcript).where(Transcript.audio_id == audio_id)
    ).first()

    transcript_text = transcript.full_text if transcript else ""
    transcript_text = transcript_text[:12000]

    prompt = f"""
请根据以下本地音频信息生成结构化 JSON。

要求：
- 只输出 JSON，不要输出 Markdown
- description 为 80 到 200 字
- tags 为 5 到 8 个
- tags 应具体、可检索
- 避免低价值标签，例如：音频、内容、对话、讲话
- 不要编造 transcript 中不存在的具体事实
- 如果 transcript 为空，只能根据已有 metadata 做保守描述

音频信息：
title: {audio.title_user or audio.title_original or audio.file_name}
author: {audio.author_user or audio.author_original or ""}
album: {audio.album_user or audio.album_original or ""}
existing_description: {audio.description_user or audio.description_original or ""}
duration_seconds: {audio.duration_seconds}
language: {audio.language or ""}

transcript:
{transcript_text}

输出格式：
{{
  "description": "string",
  "tags": ["string"],
  "language": "zh"
}}
"""

    response = await call_openai_compatible_chat(
        endpoint=endpoint,
        model_name=model_name,
        api_key=api_key or None,
        timeout=timeout,
        max_tokens=max_tokens,
        temperature=temperature,
        messages=[
            {"role": "system", "content": "你是一个本地音频知识库整理助手。你必须只输出合法 JSON。"},
            {"role": "user", "content": prompt},
        ],
    )

    content = get_ai_message_content(response)

    task_row = session.get(AITask, task_id)
    if task_row:
        task_row.output_payload = json.dumps(
            {
                "raw_content": content,
            },
            ensure_ascii=False,
        )
        task_row.updated_at = now_iso()
        session.add(task_row)
        session.commit()

    if is_task_canceled(session, task_id):
        set_audio_task_status(session, audio_id, "analyze", "canceled")
        raise TaskCanceled()

    try:
        parsed = parse_ai_json_content(content)
    except Exception as e:
        raise ValueError(f"LLM response is not valid JSON: {e}")

    description = parsed.get("description")
    tags = parsed.get("tags", [])
    language = parsed.get("language")

    if language is not None and not isinstance(language, str):
        language = None

    if not description or not isinstance(description, str):
        raise ValueError("Invalid AI JSON schema: description is required")

    if not isinstance(tags, list):
        raise ValueError("Invalid AI JSON schema: tags must be an array")

    normalized_tags = []
    for name in tags[:8]:
        name = str(name).strip()
        if name and name not in normalized_tags:
            normalized_tags.append(name)

    audio = session.get(AudioItem, audio_id)
    if not audio:
        raise ValueError("Audio not found")

    audio.description_ai = description.strip()
    audio.language = audio.language or language
    audio.ai_status = "done"
    audio.updated_at = now_iso()
    session.add(audio)

    task_row = session.get(AITask, task_id)
    if task_row:
        task_row.output_payload = json.dumps(
            {
                "description": description.strip(),
                "tags": normalized_tags,
                "language": language,
                "raw_content": content,
            },
            ensure_ascii=False,
        )
        task_row.updated_at = now_iso()
        session.add(task_row)

    session.commit()

    rebuild_audio_search_index(session, audio_id)


def start_worker_once():
    global _task_runner_started

    if _task_runner_started:
        return

    _task_runner_started = True
    asyncio.create_task(worker_loop())


================================================================================
文件: backend/app/transcriber.py
================================================================================
from pathlib import Path
from typing import Any


_MODEL_CACHE: dict[tuple[str, str, str], Any] = {}


def _get_whisper_model(model_name: str, device: str, compute_type: str):
    try:
        from faster_whisper import WhisperModel
    except Exception as e:
        raise RuntimeError(
            "faster-whisper is not installed. "
            "Please install it with: pip install faster-whisper"
        ) from e

    key = (model_name, device, compute_type)

    if key not in _MODEL_CACHE:
        _MODEL_CACHE[key] = WhisperModel(
            model_name,
            device=device,
            compute_type=compute_type,
        )

    return _MODEL_CACHE[key]


def transcribe_audio(
    file_path: str,
    model_name: str = "small",
    device: str = "cpu",
    compute_type: str = "int8",
    beam_size: int = 5,
) -> dict:
    path = Path(file_path)

    if not path.exists() or not path.is_file():
        raise FileNotFoundError(f"Audio file not found: {file_path}")

    model = _get_whisper_model(model_name, device, compute_type)

    segments_iter, info = model.transcribe(
        str(path),
        beam_size=beam_size,
    )

    segments = []
    full_text_parts = []

    for idx, seg in enumerate(segments_iter):
        text = (seg.text or "").strip()
        if text:
            full_text_parts.append(text)

        segments.append(
            {
                "segment_index": idx,
                "start_seconds": float(seg.start),
                "end_seconds": float(seg.end),
                "text": text,
            }
        )

    full_text = "\n".join(full_text_parts).strip()

    return {
        "language": getattr(info, "language", None),
        "model_name": model_name,
        "full_text": full_text,
        "segments": segments,
    }


def transcribe_audio_stub(file_path: str) -> dict:
    """
    保留给开发测试使用。默认工作流不再调用 stub。
    """
    p = Path(file_path)

    return {
        "language": "unknown",
        "model_name": "stub",
        "full_text": f"这是 {p.name} 的占位 transcript。请安装 faster-whisper 后替换真实转写逻辑。",
        "segments": [
            {
                "segment_index": 0,
                "start_seconds": 0,
                "end_seconds": 5,
                "text": f"这是 {p.name} 的占位 transcript。",
            }
        ],
    }


================================================================================
文件: backend/build_backend.py
================================================================================
import platform
import subprocess
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent
FRONTEND_TAURI = PROJECT_ROOT / "frontend" / "src-tauri"
BINARIES_DIR = FRONTEND_TAURI / "binaries"

BINARIES_DIR.mkdir(parents=True, exist_ok=True)


def tauri_target_triple() -> str:
    system = platform.system().lower()
    machine = platform.machine().lower()

    if system == "windows":
        return "x86_64-pc-windows-msvc"

    if system == "darwin":
        if machine in ["arm64", "aarch64"]:
            return "aarch64-apple-darwin"
        return "x86_64-apple-darwin"

    if system == "linux":
        return "x86_64-unknown-linux-gnu"

    raise RuntimeError(f"Unsupported platform: {system} {machine}")


def exe_suffix() -> str:
    return ".exe" if platform.system().lower() == "windows" else ""


def main():
    name = "local-audio-backend"
    target = tauri_target_triple()

    dist_dir = ROOT / "dist"
    build_dir = ROOT / "build"

    subprocess.check_call(
        [
            "pyinstaller",
            "--noconfirm",
            "--clean",
            "--onefile",
            "--name",
            name,
            "run.py",
        ],
        cwd=ROOT,
    )

    built = dist_dir / f"{name}{exe_suffix()}"
    if not built.exists():
        raise RuntimeError(f"PyInstaller output not found: {built}")

    # Tauri sidecar 命名规则：
    # externalBin 写 binaries/local-audio-backend
    # 实际文件名需要追加 -target-triple
    out_name = f"{name}-{target}{exe_suffix()}"
    out_path = BINARIES_DIR / out_name

    shutil.copy2(built, out_path)

    print(f"Backend sidecar generated: {out_path}")


if __name__ == "__main__":
    main()


================================================================================
文件: backend/run.py
================================================================================
import multiprocessing
import uvicorn


def main():
    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=8765,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()


================================================================================
文件: export_code_readme.sh
================================================================================
#!/usr/bin/env bash
set -euo pipefail

# 输出文件名，可通过第一个参数指定
OUT="${1:-code_readme_export.txt}"
OUT_ABS="$(realpath -m "$OUT")"

# 清空/创建输出文件
: > "$OUT_ABS"

find . \
  \( -type d \( \
    -name ".git" -o \
    -name "node_modules" -o \
    -name "venv" -o \
    -name ".venv" -o \
    -name "__pycache__" -o \
    -name "dist" -o \
    -name "build" -o \
    -name "gen" -o \
    -name "target" \
  \) -prune \) -o \
  -type f \
  \( \
    -iname "README" -o \
    -iname "README.*" -o \
    -iname "Dockerfile" -o \
    -iname "Makefile" -o \
    -iname "CMakeLists.txt" -o \
    -iregex '.*\.\(c\|h\|cpp\|hpp\|cc\|hh\|cxx\|java\|py\|sh\|bash\|zsh\|fish\|js\|mjs\|cjs\|jsx\|ts\|tsx\|go\|rs\|php\|rb\|swift\|kt\|kts\|scala\|cs\|m\|mm\|r\|lua\|pl\|pm\|sql\|html\|htm\|css\|scss\|sass\|vue\|svelte\|json\|yaml\|yml\|toml\|xml\|ini\|conf\|gradle\|cmake\|make\|mk\)$' \
  \) \
  -print0 | sort -z | while IFS= read -r -d '' file; do

    file_abs="$(realpath -m "$file")"

    # 避免把输出文件自己也导进去
    if [[ "$file_abs" == "$OUT_ABS" ]]; then
      continue
    fi

    # 跳过二进制文件
    mime="$(file -b --mime-type "$file" || true)"
    if [[ "$mime" != text/* \
       && "$mime" != application/json \
       && "$mime" != application/xml \
       && "$mime" != application/javascript \
       && "$mime" != application/x-javascript ]]; then
      continue
    fi

    rel="${file#./}"

    {
      printf '\n'
      printf '================================================================================\n'
      printf '文件: %s\n' "$rel"
      printf '================================================================================\n'
      cat "$file"
      printf '\n'
    } >> "$OUT_ABS"
  done

echo "已导出到: $OUT_ABS"


================================================================================
文件: frontend/index.html
================================================================================
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>Local Audio Library</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>


================================================================================
文件: frontend/package.json
================================================================================
{
  "name": "local-audio-library-frontend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1 --port 5173",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build"
  },
  "dependencies": {
    "@tauri-apps/api": "latest",
    "@vitejs/plugin-react": "latest",
    "vite": "latest",
    "typescript": "latest",
    "react": "latest",
    "react-dom": "latest"
  },
  "devDependencies": {
    "@tauri-apps/cli": "latest"
  }
}

================================================================================
文件: frontend/package-lock.json
================================================================================
{
  "name": "local-audio-library-frontend",
  "version": "0.1.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "local-audio-library-frontend",
      "version": "0.1.0",
      "dependencies": {
        "@tauri-apps/api": "latest",
        "@vitejs/plugin-react": "latest",
        "react": "latest",
        "react-dom": "latest",
        "typescript": "latest",
        "vite": "latest"
      },
      "devDependencies": {
        "@tauri-apps/cli": "latest"
      }
    },
    "node_modules/@emnapi/core": {
      "version": "1.11.1",
      "resolved": "https://registry.npmjs.org/@emnapi/core/-/core-1.11.1.tgz",
      "integrity": "sha512-RSvbQmHzdKzNsLYa/wHrbc3KN4sYLKAdPZxqiM2HATqv/SBk2/ENSHpvXGaLOMcsAyz0poEGqkmmKYG3OWiJEQ==",
      "license": "MIT",
      "optional": true,
      "dependencies": {
        "@emnapi/wasi-threads": "1.2.2",
        "tslib": "^2.4.0"
      }
    },
    "node_modules/@emnapi/runtime": {
      "version": "1.11.1",
      "resolved": "https://registry.npmjs.org/@emnapi/runtime/-/runtime-1.11.1.tgz",
      "integrity": "sha512-vgj7R3y3Wgx24IQaGPA/R6YFXLHVMOZ0uVEyIQPaWs+rd1AzfEMXlAC22FYwO1XkKR6NPsq7mUandH8oIRdZFw==",
      "license": "MIT",
      "optional": true,
      "dependencies": {
        "tslib": "^2.4.0"
      }
    },
    "node_modules/@emnapi/wasi-threads": {
      "version": "1.2.2",
      "resolved": "https://registry.npmjs.org/@emnapi/wasi-threads/-/wasi-threads-1.2.2.tgz",
      "integrity": "sha512-c95qOXkHdydNKhscBTebqEC1CVAZpyqOfVfBzQ1qgzyl3gfeldUjIggDbIZgDKsHLgnsM+igH7TJ/eAasaVuMA==",
      "license": "MIT",
      "optional": true,
      "dependencies": {
        "tslib": "^2.4.0"
      }
    },
    "node_modules/@napi-rs/wasm-runtime": {
      "version": "1.1.6",
      "resolved": "https://registry.npmjs.org/@napi-rs/wasm-runtime/-/wasm-runtime-1.1.6.tgz",
      "integrity": "sha512-ZLv/JdUfkvOy9eCnnBaGfiO+XimbjebAeO+MRQqD/B+FR1tnRN0tpKSJHRbE8sFfS6aqsXZ67TQjfwfsxULVbg==",
      "license": "MIT",
      "optional": true,
      "dependencies": {
        "@tybys/wasm-util": "^0.10.3"
      },
      "funding": {
        "type": "github",
        "url": "https://github.com/sponsors/Brooooooklyn"
      },
      "peerDependencies": {
        "@emnapi/core": "^1.7.1",
        "@emnapi/runtime": "^1.7.1"
      }
    },
    "node_modules/@oxc-project/types": {
      "version": "0.138.0",
      "resolved": "https://registry.npmjs.org/@oxc-project/types/-/types-0.138.0.tgz",
      "integrity": "sha512-1a7ZKmrRTCoN1XMZ4L0PyyqrMnrNlLyPuOkdSX2MZg7IiIGRUyurNhAm73ptDOraoBcIordsIGKNPKUzy3ZmfA==",
      "license": "MIT",
      "funding": {
        "url": "https://github.com/sponsors/Boshen"
      }
    },
    "node_modules/@rolldown/binding-android-arm64": {
      "version": "1.1.4",
      "resolved": "https://registry.npmjs.org/@rolldown/binding-android-arm64/-/binding-android-arm64-1.1.4.tgz",
      "integrity": "sha512-EZLpf/8y7GXkkra90ML47kzik/GMP3EMcE9bPyHmRfxLC6z9+aW5A8poCsoxjrT5GfEcNAAvWwUHjvP1pUQkfw==",
      "cpu": [
        "arm64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "android"
      ],
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      }
    },
    "node_modules/@rolldown/binding-darwin-arm64": {
      "version": "1.1.4",
      "resolved": "https://registry.npmjs.org/@rolldown/binding-darwin-arm64/-/binding-darwin-arm64-1.1.4.tgz",
      "integrity": "sha512-aUi+HBvmYb7j8krl1+qJgkG8C17fO79gk3c+jPw4S8glRFc1DTija9S3EyaTSQUm5GJXYKDAsugBEhFHH2vYiQ==",
      "cpu": [
        "arm64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      }
    },
    "node_modules/@rolldown/binding-darwin-x64": {
      "version": "1.1.4",
      "resolved": "https://registry.npmjs.org/@rolldown/binding-darwin-x64/-/binding-darwin-x64-1.1.4.tgz",
      "integrity": "sha512-F7hHC3gwY11+vByKPRWqwGbeXWVgKmL+pTGCinaEhdihzBV2aQ0fvZOch9cXYUOKuKKq429HeYXOqQLc7wFCEg==",
      "cpu": [
        "x64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      }
    },
    "node_modules/@rolldown/binding-freebsd-x64": {
      "version": "1.1.4",
      "resolved": "https://registry.npmjs.org/@rolldown/binding-freebsd-x64/-/binding-freebsd-x64-1.1.4.tgz",
      "integrity": "sha512-sI5yw+7s92SK6odiEhD5lKCBlWcpjHS5qyqpVQbZAJ0fIzEUXrmbl3DH2ybR3PZogulNJF+COLtmA8hUfvkCCQ==",
      "cpu": [
        "x64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "freebsd"
      ],
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      }
    },
    "node_modules/@rolldown/binding-linux-arm-gnueabihf": {
      "version": "1.1.4",
      "resolved": "https://registry.npmjs.org/@rolldown/binding-linux-arm-gnueabihf/-/binding-linux-arm-gnueabihf-1.1.4.tgz",
      "integrity": "sha512-mCi0OKgEieFircrtVYmQAFGszRtMnZ6fpZAXrxanXAu7lqZcsK1E1RAaZNG0uKAnxox3B1f4EyQNnoyMfN1vAA==",
      "cpu": [
        "arm"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      }
    },
    "node_modules/@rolldown/binding-linux-arm64-gnu": {
      "version": "1.1.4",
      "resolved": "https://registry.npmjs.org/@rolldown/binding-linux-arm64-gnu/-/binding-linux-arm64-gnu-1.1.4.tgz",
      "integrity": "sha512-B9Ial3Kv5sh0SHnB1g/QWcUQCEvCF6QKGAl4zXypYj65mVI+B4AhFBwPtSN7pDrJeIx8Z7zdy4ntx+wQABom7w==",
      "cpu": [
        "arm64"
      ],
      "libc": [
        "glibc"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      }
    },
    "node_modules/@rolldown/binding-linux-arm64-musl": {
      "version": "1.1.4",
      "resolved": "https://registry.npmjs.org/@rolldown/binding-linux-arm64-musl/-/binding-linux-arm64-musl-1.1.4.tgz",
      "integrity": "sha512-lZVym0PuHE1KZ22gmFTC15lAkrg9iTszR617oYRB/iPY1A56ywoJzVKOJBKaot5RiikCObmur6pogpse3gRcng==",
      "cpu": [
        "arm64"
      ],
      "libc": [
        "musl"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      }
    },
    "node_modules/@rolldown/binding-linux-ppc64-gnu": {
      "version": "1.1.4",
      "resolved": "https://registry.npmjs.org/@rolldown/binding-linux-ppc64-gnu/-/binding-linux-ppc64-gnu-1.1.4.tgz",
      "integrity": "sha512-t2DNiLJWNTbnEHyUzTumldML6ET4/g16467LZoDDJ3tSxGvguL5/NyC2lCsNKuyRycg9XeDQF5SSv+TNOhQEXg==",
      "cpu": [
        "ppc64"
      ],
      "libc": [
        "glibc"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      }
    },
    "node_modules/@rolldown/binding-linux-s390x-gnu": {
      "version": "1.1.4",
      "resolved": "https://registry.npmjs.org/@rolldown/binding-linux-s390x-gnu/-/binding-linux-s390x-gnu-1.1.4.tgz",
      "integrity": "sha512-0WIRnL1Uw4BvTZRLQt+PVgo6ZKTJadlC2btP+/EOXv2f/DWbY0rEgl+y834mIVwP1FkTlWVTrGGJXf12lru7EQ==",
      "cpu": [
        "s390x"
      ],
      "libc": [
        "glibc"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      }
    },
    "node_modules/@rolldown/binding-linux-x64-gnu": {
      "version": "1.1.4",
      "resolved": "https://registry.npmjs.org/@rolldown/binding-linux-x64-gnu/-/binding-linux-x64-gnu-1.1.4.tgz",
      "integrity": "sha512-JWtGshGfX+oENAKonoNkqEJX+7hC8yfhi9GUyPX1VX4mdh1y5r+ZiJLR5XzAB0aoP6s/PcILsGjKq8O0mm24bw==",
      "cpu": [
        "x64"
      ],
      "libc": [
        "glibc"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      }
    },
    "node_modules/@rolldown/binding-linux-x64-musl": {
      "version": "1.1.4",
      "resolved": "https://registry.npmjs.org/@rolldown/binding-linux-x64-musl/-/binding-linux-x64-musl-1.1.4.tgz",
      "integrity": "sha512-rT6yQcxUuXs4CnbofqwHRRV0iem349rLMYpTjkgQGLjrY4ado/eDzwPZPTCgTOlF6Nkp8NEv70yLMTn6qkWxsQ==",
      "cpu": [
        "x64"
      ],
      "libc": [
        "musl"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      }
    },
    "node_modules/@rolldown/binding-openharmony-arm64": {
      "version": "1.1.4",
      "resolved": "https://registry.npmjs.org/@rolldown/binding-openharmony-arm64/-/binding-openharmony-arm64-1.1.4.tgz",
      "integrity": "sha512-KXMGoboq5cyaCQjDA4GLuRiOwBQ0EyFnJoVViLeZ45/3rFItRODEr+NdsBcVpll40hhNArlm/speWGRvj08LzA==",
      "cpu": [
        "arm64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "openharmony"
      ],
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      }
    },
    "node_modules/@rolldown/binding-wasm32-wasi": {
      "version": "1.1.4",
      "resolved": "https://registry.npmjs.org/@rolldown/binding-wasm32-wasi/-/binding-wasm32-wasi-1.1.4.tgz",
      "integrity": "sha512-5K83rb36oJiY7BCyE9zLZtGcPV4g5wvq+xwdO0XPIwDVZI8cyB/AUjkNXGb92/rnmezEkjMOpgY61rtwjQtFwg==",
      "cpu": [
        "wasm32"
      ],
      "license": "MIT",
      "optional": true,
      "dependencies": {
        "@emnapi/core": "1.11.1",
        "@emnapi/runtime": "1.11.1",
        "@napi-rs/wasm-runtime": "^1.1.6"
      },
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      }
    },
    "node_modules/@rolldown/binding-win32-arm64-msvc": {
      "version": "1.1.4",
      "resolved": "https://registry.npmjs.org/@rolldown/binding-win32-arm64-msvc/-/binding-win32-arm64-msvc-1.1.4.tgz",
      "integrity": "sha512-PnWBtw3TV5KOg69HQQDR0mnQuyCmSGR2pAB4DC1rPF808fgKeTUMj2EOEyKATpgiuxuR5APQmiDO7PDgEjTFSA==",
      "cpu": [
        "arm64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      }
    },
    "node_modules/@rolldown/binding-win32-x64-msvc": {
      "version": "1.1.4",
      "resolved": "https://registry.npmjs.org/@rolldown/binding-win32-x64-msvc/-/binding-win32-x64-msvc-1.1.4.tgz",
      "integrity": "sha512-M1lpniBePobTfsa7Ks9a199e1akxsXn+GYBUKsEzv3YFzOm1HJAMNwKI3qr0Zq+mxwx9gOZoTdP1yXRYsZUocQ==",
      "cpu": [
        "x64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      }
    },
    "node_modules/@rolldown/pluginutils": {
      "version": "1.0.1",
      "resolved": "https://registry.npmjs.org/@rolldown/pluginutils/-/pluginutils-1.0.1.tgz",
      "integrity": "sha512-2j9bGt5Jh8hj+vPtgzPtl72j0yRxHAyumoo6TNfAjsLB04UtpSvPbPcDcBMxz7n+9CYB0c1GxQFxYRg2jimqGw==",
      "license": "MIT"
    },
    "node_modules/@tauri-apps/api": {
      "version": "2.11.1",
      "resolved": "https://registry.npmjs.org/@tauri-apps/api/-/api-2.11.1.tgz",
      "integrity": "sha512-M2FPuYND2m+wh5hfW9ZpSdxMPdEJovPBWwoHJmwUpysTYNHaOkVFN419m/K0LIgjb/7KU2vBgsUepJWugQCvAA==",
      "license": "Apache-2.0 OR MIT",
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/tauri"
      }
    },
    "node_modules/@tauri-apps/cli": {
      "version": "2.11.4",
      "resolved": "https://registry.npmjs.org/@tauri-apps/cli/-/cli-2.11.4.tgz",
      "integrity": "sha512-R8xGtMpwyetawSqm9kYOuMmEqkhUbvcUy8n0aNXIxollKBLESUu5f4Fx+64hgASYm1H+jSWq6jCW6zqTnH6hqQ==",
      "dev": true,
      "license": "Apache-2.0 OR MIT",
      "bin": {
        "tauri": "tauri.js"
      },
      "engines": {
        "node": ">= 10"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/tauri"
      },
      "optionalDependencies": {
        "@tauri-apps/cli-darwin-arm64": "2.11.4",
        "@tauri-apps/cli-darwin-x64": "2.11.4",
        "@tauri-apps/cli-linux-arm-gnueabihf": "2.11.4",
        "@tauri-apps/cli-linux-arm64-gnu": "2.11.4",
        "@tauri-apps/cli-linux-arm64-musl": "2.11.4",
        "@tauri-apps/cli-linux-riscv64-gnu": "2.11.4",
        "@tauri-apps/cli-linux-x64-gnu": "2.11.4",
        "@tauri-apps/cli-linux-x64-musl": "2.11.4",
        "@tauri-apps/cli-win32-arm64-msvc": "2.11.4",
        "@tauri-apps/cli-win32-ia32-msvc": "2.11.4",
        "@tauri-apps/cli-win32-x64-msvc": "2.11.4"
      }
    },
    "node_modules/@tauri-apps/cli-darwin-arm64": {
      "version": "2.11.4",
      "resolved": "https://registry.npmjs.org/@tauri-apps/cli-darwin-arm64/-/cli-darwin-arm64-2.11.4.tgz",
      "integrity": "sha512-1ryOF3ZhpZ/nemHV5zVwBQBz9jDGKmKPvWPADOhc83ig0P4bMc2iER4NbC6r9sjeIZ6RVQ4g3RZIYvezhcl4TQ==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "Apache-2.0 OR MIT",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": ">= 10"
      }
    },
    "node_modules/@tauri-apps/cli-darwin-x64": {
      "version": "2.11.4",
      "resolved": "https://registry.npmjs.org/@tauri-apps/cli-darwin-x64/-/cli-darwin-x64-2.11.4.tgz",
      "integrity": "sha512-uFsGQAAfuyz1k/yGLmkWfkBlgKAqZfxqlHmLWx81QU27RJWfmbNHCIq8T8w1e+VClleIuZUjpHWfoE4E3DLo3A==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "Apache-2.0 OR MIT",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": ">= 10"
      }
    },
    "node_modules/@tauri-apps/cli-linux-arm-gnueabihf": {
      "version": "2.11.4",
      "resolved": "https://registry.npmjs.org/@tauri-apps/cli-linux-arm-gnueabihf/-/cli-linux-arm-gnueabihf-2.11.4.tgz",
      "integrity": "sha512-IaHZn5CdBL21oUmjiVOS1ctw6Ip1O0pjp70FwOWmYz1myWe0SY96ZIj2FYf7pT0m8bI2h/hrs5ZbEXXh44/MkQ==",
      "cpu": [
        "arm"
      ],
      "dev": true,
      "license": "Apache-2.0 OR MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 10"
      }
    },
    "node_modules/@tauri-apps/cli-linux-arm64-gnu": {
      "version": "2.11.4",
      "resolved": "https://registry.npmjs.org/@tauri-apps/cli-linux-arm64-gnu/-/cli-linux-arm64-gnu-2.11.4.tgz",
      "integrity": "sha512-N41/ukTRVe6XSuUTESuFdGeOW2i7k62tK+6gHK5Kd5/q5RPvvi19GaWAVPPb9u95HSGmTChSolBfzynUsssFaA==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "Apache-2.0 OR MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 10"
      }
    },
    "node_modules/@tauri-apps/cli-linux-arm64-musl": {
      "version": "2.11.4",
      "resolved": "https://registry.npmjs.org/@tauri-apps/cli-linux-arm64-musl/-/cli-linux-arm64-musl-2.11.4.tgz",
      "integrity": "sha512-v277UnT/fB64xAfSroL5N3Km3tLmvATWqJJw/wRI+g6o+HkeD0slyE7gOhNs1MbjE41R7bQOTxMVoL3aomUJmw==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "libc": [
        "musl"
      ],
      "license": "Apache-2.0 OR MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 10"
      }
    },
    "node_modules/@tauri-apps/cli-linux-riscv64-gnu": {
      "version": "2.11.4",
      "resolved": "https://registry.npmjs.org/@tauri-apps/cli-linux-riscv64-gnu/-/cli-linux-riscv64-gnu-2.11.4.tgz",
      "integrity": "sha512-qqgNkQ2u1yZHxjhxsZaxUtRDW8dIqIYm33rx/mzwQv0SfY9x1B+iraj8vWeFiXjjSVVhEMepXSOts1TqPzvXNQ==",
      "cpu": [
        "riscv64"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "Apache-2.0 OR MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 10"
      }
    },
    "node_modules/@tauri-apps/cli-linux-x64-gnu": {
      "version": "2.11.4",
      "resolved": "https://registry.npmjs.org/@tauri-apps/cli-linux-x64-gnu/-/cli-linux-x64-gnu-2.11.4.tgz",
      "integrity": "sha512-2VRNWl84FOH0m2giiDkO2h0QXlcMJeX+zJDpI5kDIQAx6s+geF3v48F4DXfJez4GS/FdoDGnPnw1C2iYGbQ7bQ==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "Apache-2.0 OR MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 10"
      }
    },
    "node_modules/@tauri-apps/cli-linux-x64-musl": {
      "version": "2.11.4",
      "resolved": "https://registry.npmjs.org/@tauri-apps/cli-linux-x64-musl/-/cli-linux-x64-musl-2.11.4.tgz",
      "integrity": "sha512-o9GyhYor/nc7xarmwDE3ka2szuW3uuZzXjHWh64Q8YX5AtSgxdQkFWzrY4O8KiGtVNvFBI14H3Q49Qj5TOIP/A==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "libc": [
        "musl"
      ],
      "license": "Apache-2.0 OR MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 10"
      }
    },
    "node_modules/@tauri-apps/cli-win32-arm64-msvc": {
      "version": "2.11.4",
      "resolved": "https://registry.npmjs.org/@tauri-apps/cli-win32-arm64-msvc/-/cli-win32-arm64-msvc-2.11.4.tgz",
      "integrity": "sha512-ld5Ehb598m0VkYyylRPNeCFsBe/km0jxis6KgMpl3IGY6I/i1RwQXO05I1AsXUXO2WC6AvB/Lw4qTf/asiuEiQ==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "Apache-2.0 OR MIT",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": ">= 10"
      }
    },
    "node_modules/@tauri-apps/cli-win32-ia32-msvc": {
      "version": "2.11.4",
      "resolved": "https://registry.npmjs.org/@tauri-apps/cli-win32-ia32-msvc/-/cli-win32-ia32-msvc-2.11.4.tgz",
      "integrity": "sha512-12Hxi0XX/H5VFxO/bGgHkFWhml9VMgEOu9CidjeCeTNQ1l6fpUlbiGgSP7CLI3PFtW9/FfbeHieZ+kyWK5H7CA==",
      "cpu": [
        "ia32"
      ],
      "dev": true,
      "license": "Apache-2.0 OR MIT",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": ">= 10"
      }
    },
    "node_modules/@tauri-apps/cli-win32-x64-msvc": {
      "version": "2.11.4",
      "resolved": "https://registry.npmjs.org/@tauri-apps/cli-win32-x64-msvc/-/cli-win32-x64-msvc-2.11.4.tgz",
      "integrity": "sha512-+vDiqBIU5dMISg/wNvX3sF+ZHfgJGJ5T0AcO+EHNXV9GGAG+P5fzodlDXD3QdKCRgZxMoCm5PPvj3BqLNjBthw==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "Apache-2.0 OR MIT",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": ">= 10"
      }
    },
    "node_modules/@tybys/wasm-util": {
      "version": "0.10.3",
      "resolved": "https://registry.npmjs.org/@tybys/wasm-util/-/wasm-util-0.10.3.tgz",
      "integrity": "sha512-F3fo1MYrRJYL3zER0OUOmkutjr1Vp23m7OsSgp7nq4SP6OqX6C/56XFIPAl5bt3zaBRjmW7SGz3u/6LwFpYcOg==",
      "license": "MIT",
      "optional": true,
      "dependencies": {
        "tslib": "^2.4.0"
      }
    },
    "node_modules/@vitejs/plugin-react": {
      "version": "6.0.3",
      "resolved": "https://registry.npmjs.org/@vitejs/plugin-react/-/plugin-react-6.0.3.tgz",
      "integrity": "sha512-vmFvco5/QuC2f9Oj+wTk0+9XeDFkHxSamwZKYc7MxYwKICfvUvlMhqKI0VuICPltGqh1neqBKDvO4kes1ya8vg==",
      "license": "MIT",
      "dependencies": {
        "@rolldown/pluginutils": "^1.0.1"
      },
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      },
      "peerDependencies": {
        "@rolldown/plugin-babel": "^0.1.7 || ^0.2.0",
        "babel-plugin-react-compiler": "^1.0.0",
        "vite": "^8.0.0"
      },
      "peerDependenciesMeta": {
        "@rolldown/plugin-babel": {
          "optional": true
        },
        "babel-plugin-react-compiler": {
          "optional": true
        }
      }
    },
    "node_modules/detect-libc": {
      "version": "2.1.2",
      "resolved": "https://registry.npmjs.org/detect-libc/-/detect-libc-2.1.2.tgz",
      "integrity": "sha512-Btj2BOOO83o3WyH59e8MgXsxEQVcarkUOpEYrubB0urwnN10yQ364rsiByU11nZlqWYZm05i/of7io4mzihBtQ==",
      "license": "Apache-2.0",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/fdir": {
      "version": "6.5.0",
      "resolved": "https://registry.npmjs.org/fdir/-/fdir-6.5.0.tgz",
      "integrity": "sha512-tIbYtZbucOs0BRGqPJkshJUYdL+SDH7dVM8gjy+ERp3WAUjLEFJE+02kanyHtwjWOnwrKYBiwAmM0p4kLJAnXg==",
      "license": "MIT",
      "engines": {
        "node": ">=12.0.0"
      },
      "peerDependencies": {
        "picomatch": "^3 || ^4"
      },
      "peerDependenciesMeta": {
        "picomatch": {
          "optional": true
        }
      }
    },
    "node_modules/fsevents": {
      "version": "2.3.3",
      "resolved": "https://registry.npmjs.org/fsevents/-/fsevents-2.3.3.tgz",
      "integrity": "sha512-5xoDfX+fL7faATnagmWPpbFtwh/R77WmMMqqHGS65C3vvB0YHrgF+B1YmZ3441tMj5n63k0212XNoJwzlhffQw==",
      "hasInstallScript": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": "^8.16.0 || ^10.6.0 || >=11.0.0"
      }
    },
    "node_modules/lightningcss": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss/-/lightningcss-1.32.0.tgz",
      "integrity": "sha512-NXYBzinNrblfraPGyrbPoD19C1h9lfI/1mzgWYvXUTe414Gz/X1FD2XBZSZM7rRTrMA8JL3OtAaGifrIKhQ5yQ==",
      "license": "MPL-2.0",
      "dependencies": {
        "detect-libc": "^2.0.3"
      },
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      },
      "optionalDependencies": {
        "lightningcss-android-arm64": "1.32.0",
        "lightningcss-darwin-arm64": "1.32.0",
        "lightningcss-darwin-x64": "1.32.0",
        "lightningcss-freebsd-x64": "1.32.0",
        "lightningcss-linux-arm-gnueabihf": "1.32.0",
        "lightningcss-linux-arm64-gnu": "1.32.0",
        "lightningcss-linux-arm64-musl": "1.32.0",
        "lightningcss-linux-x64-gnu": "1.32.0",
        "lightningcss-linux-x64-musl": "1.32.0",
        "lightningcss-win32-arm64-msvc": "1.32.0",
        "lightningcss-win32-x64-msvc": "1.32.0"
      }
    },
    "node_modules/lightningcss-android-arm64": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss-android-arm64/-/lightningcss-android-arm64-1.32.0.tgz",
      "integrity": "sha512-YK7/ClTt4kAK0vo6w3X+Pnm0D2cf2vPHbhOXdoNti1Ga0al1P4TBZhwjATvjNwLEBCnKvjJc2jQgHXH0NEwlAg==",
      "cpu": [
        "arm64"
      ],
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "android"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-darwin-arm64": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss-darwin-arm64/-/lightningcss-darwin-arm64-1.32.0.tgz",
      "integrity": "sha512-RzeG9Ju5bag2Bv1/lwlVJvBE3q6TtXskdZLLCyfg5pt+HLz9BqlICO7LZM7VHNTTn/5PRhHFBSjk5lc4cmscPQ==",
      "cpu": [
        "arm64"
      ],
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-darwin-x64": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss-darwin-x64/-/lightningcss-darwin-x64-1.32.0.tgz",
      "integrity": "sha512-U+QsBp2m/s2wqpUYT/6wnlagdZbtZdndSmut/NJqlCcMLTWp5muCrID+K5UJ6jqD2BFshejCYXniPDbNh73V8w==",
      "cpu": [
        "x64"
      ],
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-freebsd-x64": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss-freebsd-x64/-/lightningcss-freebsd-x64-1.32.0.tgz",
      "integrity": "sha512-JCTigedEksZk3tHTTthnMdVfGf61Fky8Ji2E4YjUTEQX14xiy/lTzXnu1vwiZe3bYe0q+SpsSH/CTeDXK6WHig==",
      "cpu": [
        "x64"
      ],
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "freebsd"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-linux-arm-gnueabihf": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss-linux-arm-gnueabihf/-/lightningcss-linux-arm-gnueabihf-1.32.0.tgz",
      "integrity": "sha512-x6rnnpRa2GL0zQOkt6rts3YDPzduLpWvwAF6EMhXFVZXD4tPrBkEFqzGowzCsIWsPjqSK+tyNEODUBXeeVHSkw==",
      "cpu": [
        "arm"
      ],
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-linux-arm64-gnu": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss-linux-arm64-gnu/-/lightningcss-linux-arm64-gnu-1.32.0.tgz",
      "integrity": "sha512-0nnMyoyOLRJXfbMOilaSRcLH3Jw5z9HDNGfT/gwCPgaDjnx0i8w7vBzFLFR1f6CMLKF8gVbebmkUN3fa/kQJpQ==",
      "cpu": [
        "arm64"
      ],
      "libc": [
        "glibc"
      ],
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-linux-arm64-musl": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss-linux-arm64-musl/-/lightningcss-linux-arm64-musl-1.32.0.tgz",
      "integrity": "sha512-UpQkoenr4UJEzgVIYpI80lDFvRmPVg6oqboNHfoH4CQIfNA+HOrZ7Mo7KZP02dC6LjghPQJeBsvXhJod/wnIBg==",
      "cpu": [
        "arm64"
      ],
      "libc": [
        "musl"
      ],
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-linux-x64-gnu": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss-linux-x64-gnu/-/lightningcss-linux-x64-gnu-1.32.0.tgz",
      "integrity": "sha512-V7Qr52IhZmdKPVr+Vtw8o+WLsQJYCTd8loIfpDaMRWGUZfBOYEJeyJIkqGIDMZPwPx24pUMfwSxxI8phr/MbOA==",
      "cpu": [
        "x64"
      ],
      "libc": [
        "glibc"
      ],
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-linux-x64-musl": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss-linux-x64-musl/-/lightningcss-linux-x64-musl-1.32.0.tgz",
      "integrity": "sha512-bYcLp+Vb0awsiXg/80uCRezCYHNg1/l3mt0gzHnWV9XP1W5sKa5/TCdGWaR/zBM2PeF/HbsQv/j2URNOiVuxWg==",
      "cpu": [
        "x64"
      ],
      "libc": [
        "musl"
      ],
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-win32-arm64-msvc": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss-win32-arm64-msvc/-/lightningcss-win32-arm64-msvc-1.32.0.tgz",
      "integrity": "sha512-8SbC8BR40pS6baCM8sbtYDSwEVQd4JlFTOlaD3gWGHfThTcABnNDBda6eTZeqbofalIJhFx0qKzgHJmcPTnGdw==",
      "cpu": [
        "arm64"
      ],
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-win32-x64-msvc": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss-win32-x64-msvc/-/lightningcss-win32-x64-msvc-1.32.0.tgz",
      "integrity": "sha512-Amq9B/SoZYdDi1kFrojnoqPLxYhQ4Wo5XiL8EVJrVsB8ARoC1PWW6VGtT0WKCemjy8aC+louJnjS7U18x3b06Q==",
      "cpu": [
        "x64"
      ],
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/nanoid": {
      "version": "3.3.15",
      "resolved": "https://registry.npmjs.org/nanoid/-/nanoid-3.3.15.tgz",
      "integrity": "sha512-y7Wygv/7mEOvxTuEQDB8StXdMRBWf1kR/tlhAzBRUFkB2jfcLOAxO/SHmOO2zgz1pVgK29/kyupn059/bCHdjA==",
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/ai"
        }
      ],
      "license": "MIT",
      "bin": {
        "nanoid": "bin/nanoid.cjs"
      },
      "engines": {
        "node": "^10 || ^12 || ^13.7 || ^14 || >=15.0.1"
      }
    },
    "node_modules/picocolors": {
      "version": "1.1.1",
      "resolved": "https://registry.npmjs.org/picocolors/-/picocolors-1.1.1.tgz",
      "integrity": "sha512-xceH2snhtb5M9liqDsmEw56le376mTZkEX/jEb/RxNFyegNul7eNslCXP9FDj/Lcu0X8KEyMceP2ntpaHrDEVA==",
      "license": "ISC"
    },
    "node_modules/picomatch": {
      "version": "4.0.4",
      "resolved": "https://registry.npmjs.org/picomatch/-/picomatch-4.0.4.tgz",
      "integrity": "sha512-QP88BAKvMam/3NxH6vj2o21R6MjxZUAd6nlwAS/pnGvN9IVLocLHxGYIzFhg6fUQ+5th6P4dv4eW9jX3DSIj7A==",
      "license": "MIT",
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/sponsors/jonschlinkert"
      }
    },
    "node_modules/postcss": {
      "version": "8.5.16",
      "resolved": "https://registry.npmjs.org/postcss/-/postcss-8.5.16.tgz",
      "integrity": "sha512-vuwillviilfKZsg0VGj5R/YwwcHx4SLsIOI/7K6mQkWx+l5cUHTjj5g0AasTBcyXsbfTgrwsUNmVUb5xVwyPwg==",
      "funding": [
        {
          "type": "opencollective",
          "url": "https://opencollective.com/postcss/"
        },
        {
          "type": "tidelift",
          "url": "https://tidelift.com/funding/github/npm/postcss"
        },
        {
          "type": "github",
          "url": "https://github.com/sponsors/ai"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "nanoid": "^3.3.12",
        "picocolors": "^1.1.1",
        "source-map-js": "^1.2.1"
      },
      "engines": {
        "node": "^10 || ^12 || >=14"
      }
    },
    "node_modules/react": {
      "version": "19.2.7",
      "resolved": "https://registry.npmjs.org/react/-/react-19.2.7.tgz",
      "integrity": "sha512-HNe9WslTbXmFK8o8cmwgAeJFSBvt1bPdHCVKtaaV+WlAN36mpT4hcRpwbf3fY56ar2oIXzsBpOAiIRHAdY0OlQ==",
      "license": "MIT",
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/react-dom": {
      "version": "19.2.7",
      "resolved": "https://registry.npmjs.org/react-dom/-/react-dom-19.2.7.tgz",
      "integrity": "sha512-t0BRVXvbiE/o20Hfw669rLbMCDWtYZLvmJigy2f0MxsXF+71pxhR3xOkspmsO8h3ZlNzyibAmtCa3l4lYKk6gQ==",
      "license": "MIT",
      "dependencies": {
        "scheduler": "^0.27.0"
      },
      "peerDependencies": {
        "react": "^19.2.7"
      }
    },
    "node_modules/rolldown": {
      "version": "1.1.4",
      "resolved": "https://registry.npmjs.org/rolldown/-/rolldown-1.1.4.tgz",
      "integrity": "sha512-IjZYiLxZwpnhwhdBH2ugdTGVSdhCQUmLxLoqyjiL0JxYjyRst+5a0P3xfrTxJ5F638j4Mvvw5FAX5XE6eHpXbA==",
      "license": "MIT",
      "dependencies": {
        "@oxc-project/types": "=0.138.0",
        "@rolldown/pluginutils": "^1.0.0"
      },
      "bin": {
        "rolldown": "bin/cli.mjs"
      },
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      },
      "optionalDependencies": {
        "@rolldown/binding-android-arm64": "1.1.4",
        "@rolldown/binding-darwin-arm64": "1.1.4",
        "@rolldown/binding-darwin-x64": "1.1.4",
        "@rolldown/binding-freebsd-x64": "1.1.4",
        "@rolldown/binding-linux-arm-gnueabihf": "1.1.4",
        "@rolldown/binding-linux-arm64-gnu": "1.1.4",
        "@rolldown/binding-linux-arm64-musl": "1.1.4",
        "@rolldown/binding-linux-ppc64-gnu": "1.1.4",
        "@rolldown/binding-linux-s390x-gnu": "1.1.4",
        "@rolldown/binding-linux-x64-gnu": "1.1.4",
        "@rolldown/binding-linux-x64-musl": "1.1.4",
        "@rolldown/binding-openharmony-arm64": "1.1.4",
        "@rolldown/binding-wasm32-wasi": "1.1.4",
        "@rolldown/binding-win32-arm64-msvc": "1.1.4",
        "@rolldown/binding-win32-x64-msvc": "1.1.4"
      }
    },
    "node_modules/scheduler": {
      "version": "0.27.0",
      "resolved": "https://registry.npmjs.org/scheduler/-/scheduler-0.27.0.tgz",
      "integrity": "sha512-eNv+WrVbKu1f3vbYJT/xtiF5syA5HPIMtf9IgY/nKg0sWqzAUEvqY/xm7OcZc/qafLx/iO9FgOmeSAp4v5ti/Q==",
      "license": "MIT"
    },
    "node_modules/source-map-js": {
      "version": "1.2.1",
      "resolved": "https://registry.npmjs.org/source-map-js/-/source-map-js-1.2.1.tgz",
      "integrity": "sha512-UXWMKhLOwVKb728IUtQPXxfYU+usdybtUrK/8uGE8CQMvrhOpwvzDBwj0QhSL7MQc7vIsISBG8VQ8+IDQxpfQA==",
      "license": "BSD-3-Clause",
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/tinyglobby": {
      "version": "0.2.17",
      "resolved": "https://registry.npmjs.org/tinyglobby/-/tinyglobby-0.2.17.tgz",
      "integrity": "sha512-wXR/dYpcqKmfWpEdZjiKJOwCNFndD0DMnrW/cYjVGttEkBfVgcLFHoNrlj47mjOVic9yyNu65alsgF4NQyTa2g==",
      "license": "MIT",
      "dependencies": {
        "fdir": "^6.5.0",
        "picomatch": "^4.0.4"
      },
      "engines": {
        "node": ">=12.0.0"
      },
      "funding": {
        "url": "https://github.com/sponsors/SuperchupuDev"
      }
    },
    "node_modules/tslib": {
      "version": "2.8.1",
      "resolved": "https://registry.npmjs.org/tslib/-/tslib-2.8.1.tgz",
      "integrity": "sha512-oJFu94HQb+KVduSUQL7wnpmqnfmLsOA/nAh6b6EH0wCEoK0/mPeXU6c3wKDV83MkOuHPRHtSXKKU99IBazS/2w==",
      "license": "0BSD",
      "optional": true
    },
    "node_modules/typescript": {
      "version": "6.0.3",
      "resolved": "https://registry.npmjs.org/typescript/-/typescript-6.0.3.tgz",
      "integrity": "sha512-y2TvuxSZPDyQakkFRPZHKFm+KKVqIisdg9/CZwm9ftvKXLP8NRWj38/ODjNbr43SsoXqNuAisEf1GdCxqWcdBw==",
      "license": "Apache-2.0",
      "bin": {
        "tsc": "bin/tsc",
        "tsserver": "bin/tsserver"
      },
      "engines": {
        "node": ">=14.17"
      }
    },
    "node_modules/vite": {
      "version": "8.1.3",
      "resolved": "https://registry.npmjs.org/vite/-/vite-8.1.3.tgz",
      "integrity": "sha512-Ds+gBRbj0lwRO2Y5hwnUBdxSwlAve9LeRyU4sNnAr0ewW0gWF0n5bgXgUzbgZ49MV9BVUAQUFYVcDUcilUExMA==",
      "license": "MIT",
      "dependencies": {
        "lightningcss": "^1.32.0",
        "picomatch": "^4.0.4",
        "postcss": "^8.5.16",
        "rolldown": "~1.1.3",
        "tinyglobby": "^0.2.17"
      },
      "bin": {
        "vite": "bin/vite.js"
      },
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      },
      "funding": {
        "url": "https://github.com/vitejs/vite?sponsor=1"
      },
      "optionalDependencies": {
        "fsevents": "~2.3.3"
      },
      "peerDependencies": {
        "@types/node": "^20.19.0 || >=22.12.0",
        "@vitejs/devtools": "^0.3.0",
        "esbuild": "^0.27.0 || ^0.28.0",
        "jiti": ">=1.21.0",
        "less": "^4.0.0",
        "sass": "^1.70.0",
        "sass-embedded": "^1.70.0",
        "stylus": ">=0.54.8",
        "sugarss": "^5.0.0",
        "terser": "^5.16.0",
        "tsx": "^4.8.1",
        "yaml": "^2.4.2"
      },
      "peerDependenciesMeta": {
        "@types/node": {
          "optional": true
        },
        "@vitejs/devtools": {
          "optional": true
        },
        "esbuild": {
          "optional": true
        },
        "jiti": {
          "optional": true
        },
        "less": {
          "optional": true
        },
        "sass": {
          "optional": true
        },
        "sass-embedded": {
          "optional": true
        },
        "stylus": {
          "optional": true
        },
        "sugarss": {
          "optional": true
        },
        "terser": {
          "optional": true
        },
        "tsx": {
          "optional": true
        },
        "yaml": {
          "optional": true
        }
      }
    }
  }
}


================================================================================
文件: frontend/src/api.ts
================================================================================
import type {
  AISuggestions,
  AITask,
  AudioDetail,
  AudioItem,
  BatchTaskResult,
  LibraryRoot,
  LLMConfigPayload,
  LLMTestResult,
  Playlist,
  PlaylistDetail,
  ScanTask,
  Tag,
  Transcript
} from "./types";

export const API_BASE = "http://127.0.0.1:8765";

export const LOCAL_AUDIO_CLIENT_HEADER = "X-Local-Audio-Client";
export const LOCAL_AUDIO_CLIENT_ID = "local-audio-library";

export class ApiError extends Error {
  status: number;
  detail?: unknown;
  raw?: string;

  constructor(message: string, status: number, detail?: unknown, raw?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.raw = raw;
  }
}

function readableErrorFromJson(value: any): string {
  if (!value) return "";

  if (typeof value.detail === "string") {
    return value.detail;
  }

  if (Array.isArray(value.detail)) {
    return value.detail
      .map((item) => {
        if (typeof item?.msg === "string") return item.msg;
        return JSON.stringify(item);
      })
      .join("; ");
  }

  if (value.detail !== undefined) {
    try {
      return JSON.stringify(value.detail, null, 2);
    } catch {
      return String(value.detail);
    }
  }

  if (typeof value.message === "string") {
    return value.message;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function parseErrorResponse(resp: Response): Promise<ApiError> {
  const text = await resp.text();

  if (!text) {
    return new ApiError(`HTTP ${resp.status}`, resp.status);
  }

  try {
    const json = JSON.parse(text);
    const message = readableErrorFromJson(json) || `HTTP ${resp.status}`;
    return new ApiError(message, resp.status, json.detail, text);
  } catch {
    return new ApiError(text, resp.status, undefined, text);
  }
}

async function request<T = any>(path: string, options?: RequestInit): Promise<T> {
  const body = options?.body;
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;

  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string> | undefined)
  };

  headers[LOCAL_AUDIO_CLIENT_HEADER] = LOCAL_AUDIO_CLIENT_ID;

  if (!isFormData && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const resp = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  if (!resp.ok) {
    throw await parseErrorResponse(resp);
  }

  if (resp.status === 204) {
    return undefined as T;
  }

  const text = await resp.text();
  if (!text) {
    return undefined as T;
  }

  return JSON.parse(text);
}

export function isProbablyLocalEndpoint(endpoint: string): boolean {
  try {
    const parsed = new URL(endpoint);
    const host = parsed.hostname.toLowerCase();

    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

export function endpointPrivacyWarning(endpoint: string): string | null {
  if (!endpoint.trim()) return null;

  if (isProbablyLocalEndpoint(endpoint.trim())) {
    return null;
  }

  return "当前 LLM endpoint 不是 localhost / 127.0.0.1。AI 分析会把音频 metadata 和 transcript 发送到该地址。请确认这是你信任的本地或内网模型服务。";
}

export const api = {
  health: () => request<{ status: string }>("/health"),

  listLibraryRoots: () => request<LibraryRoot[]>("/library-roots"),

  createLibraryRoot: (path: string) =>
    request<LibraryRoot>("/library-roots", {
      method: "POST",
      body: JSON.stringify({ path })
    }),

  updateLibraryRoot: (id: number, payload: { is_enabled?: boolean }) =>
    request<LibraryRoot>(`/library-roots/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),

  scanLibraryRoot: (id: number) =>
    request<ScanTask>(`/library-roots/${id}/scan`, {
      method: "POST"
    }),

  listScanTasks: (params?: { root_id?: number; limit?: number }) => {
    const sp = new URLSearchParams();
    if (params?.root_id !== undefined) sp.set("root_id", String(params.root_id));
    if (params?.limit !== undefined) sp.set("limit", String(params.limit));
    const qs = sp.toString();
    return request<ScanTask[]>(`/scan-tasks${qs ? `?${qs}` : ""}`);
  },

  cancelScanTask: (id: number) =>
    request<ScanTask>(`/scan-tasks/${id}/cancel`, {
      method: "POST"
    }),

  listAudioItems: (params?: {
    q?: string;
    tag?: string;
    favorite?: boolean;
    missing?: boolean;
    has_transcript?: boolean;
    missing_description?: boolean;
    include_disabled_roots?: boolean;
    limit?: number;
    offset?: number;
  }) => {
    const sp = new URLSearchParams();

    if (params?.q) sp.set("q", params.q);
    if (params?.tag) sp.set("tag", params.tag);
    if (params?.favorite !== undefined) sp.set("favorite", String(params.favorite));
    if (params?.missing !== undefined) sp.set("missing", String(params.missing));
    if (params?.has_transcript !== undefined) {
      sp.set("has_transcript", String(params.has_transcript));
    }
    if (params?.missing_description !== undefined) {
      sp.set("missing_description", String(params.missing_description));
    }
    if (params?.include_disabled_roots !== undefined) {
      sp.set("include_disabled_roots", String(params.include_disabled_roots));
    }
    if (params?.limit !== undefined) sp.set("limit", String(params.limit));
    if (params?.offset !== undefined) sp.set("offset", String(params.offset));

    const qs = sp.toString();
    return request<AudioItem[]>(`/audio-items${qs ? `?${qs}` : ""}`);
  },

  getAudioDetail: (id: number) => request<AudioDetail>(`/audio-items/${id}`),

  getAiSuggestions: (id: number) =>
    request<AISuggestions>(`/audio-items/${id}/ai-suggestions`),

  updateAudio: (id: number, payload: Partial<AudioItem>) =>
    request<AudioItem>(`/audio-items/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),

  deleteAudio: (id: number, deleteFile = false) =>
    request<{ ok: boolean }>(`/audio-items/${id}?delete_file=${String(deleteFile)}`, {
      method: "DELETE"
    }),

  relocateAudio: (id: number, filePath: string) =>
    request<AudioItem>(`/audio-items/${id}/relocate`, {
      method: "POST",
      body: JSON.stringify({ file_path: filePath })
    }),

  uploadCover: (id: number, file: File) => {
    const fd = new FormData();
    fd.append("file", file);

    return request<AudioItem>(`/audio-items/${id}/cover`, {
      method: "POST",
      body: fd
    });
  },

  deleteCover: (id: number) =>
    request<AudioItem>(`/audio-items/${id}/cover`, {
      method: "DELETE"
    }),

  coverUrl: (id: number, version?: string | number) =>
    `${API_BASE}/audio-items/${id}/cover${version ? `?v=${encodeURIComponent(String(version))}` : ""}`,

  updatePlaybackPosition: (id: number, last_position_seconds: number) =>
    request<{ ok: boolean }>(`/audio-items/${id}/playback-position`, {
      method: "POST",
      body: JSON.stringify({ last_position_seconds })
    }),

  incrementPlayCount: (id: number) =>
    request<{ ok: boolean }>(`/audio-items/${id}/play-count`, {
      method: "POST"
    }),

  listTags: () => request<Tag[]>("/tags"),

  updateTag: (tagId: number, payload: { name: string }) =>
    request<Tag>(`/tags/${tagId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),

  deleteTag: (tagId: number, force = false) =>
    request<{ ok: boolean; affected_audio_items: number }>(
      `/tags/${tagId}?force=${String(force)}`,
      {
        method: "DELETE"
      }
    ),

  addTags: (audioId: number, tags: string[], source: "user" | "ai" | "system" = "user") =>
    request<Tag[]>(`/audio-items/${audioId}/tags`, {
      method: "POST",
      body: JSON.stringify({ tags, source })
    }),

  removeTag: (audioId: number, tagId: number) =>
    request<{ ok: boolean }>(`/audio-items/${audioId}/tags/${tagId}`, {
      method: "DELETE"
    }),

  listPlaylists: () => request<Playlist[]>("/playlists"),

  getPlaylist: (id: number) => request<PlaylistDetail>(`/playlists/${id}`),

  createPlaylist: (name: string, description?: string) =>
    request<Playlist>("/playlists", {
      method: "POST",
      body: JSON.stringify({ name, description })
    }),

  addToPlaylist: (playlistId: number, audioId: number) =>
    request(`/playlists/${playlistId}/items`, {
      method: "POST",
      body: JSON.stringify({ audio_id: audioId })
    }),

  removePlaylistItem: (playlistId: number, playlistItemId: number) =>
    request<{ ok: boolean }>(`/playlists/${playlistId}/items/${playlistItemId}`, {
      method: "DELETE"
    }),

  reorderPlaylistItems: (playlistId: number, itemIds: number[]) =>
    request<{ ok: boolean; count: number }>(`/playlists/${playlistId}/items/reorder`, {
      method: "PATCH",
      body: JSON.stringify({ item_ids: itemIds })
    }),

  playlistExportUrl: (playlistId: number, format: "json" | "m3u") =>
    `${API_BASE}/playlists/${playlistId}/export?format=${encodeURIComponent(format)}`,

  transcribe: (audioId: number) =>
    request<AITask>(`/audio-items/${audioId}/transcribe`, {
      method: "POST"
    }),

  analyze: (audioId: number) =>
    request<AITask>(`/audio-items/${audioId}/analyze`, {
      method: "POST"
    }),

  batchTranscribe: (audioIds: number[]) =>
    request<BatchTaskResult>("/audio-items/batch/transcribe", {
      method: "POST",
      body: JSON.stringify({ audio_ids: audioIds })
    }),

  batchAnalyze: (audioIds: number[]) =>
    request<BatchTaskResult>("/audio-items/batch/analyze", {
      method: "POST",
      body: JSON.stringify({ audio_ids: audioIds })
    }),

  testLlm: (payload: LLMConfigPayload) =>
    request<LLMTestResult>("/ai/test-llm", {
      method: "POST",
      body: JSON.stringify(payload)
    }),

  getTranscript: (audioId: number) => request<Transcript>(`/audio-items/${audioId}/transcript`),

  transcriptExportUrl: (audioId: number, format: "txt" | "json" | "srt") =>
    `${API_BASE}/audio-items/${audioId}/transcript/export?format=${encodeURIComponent(format)}`,

  metadataExportUrl: (format: "json" | "csv") =>
    `${API_BASE}/export/metadata?format=${encodeURIComponent(format)}`,

  listTasks: () => request<AITask[]>("/ai-tasks"),

  retryTask: (taskId: number) =>
    request<AITask>(`/ai-tasks/${taskId}/retry`, {
      method: "POST"
    }),

  cancelTask: (taskId: number) =>
    request<AITask>(`/ai-tasks/${taskId}/cancel`, {
      method: "POST"
    }),

  setSetting: (key: string, value: string) =>
    request("/settings", {
      method: "PUT",
      body: JSON.stringify({ key, value })
    }),

  listSettings: () => request<{ key: string; value: string; updated_at: string }[]>("/settings"),

  rebuildSearchIndex: () =>
    request<{ ok: boolean; count: number }>("/maintenance/rebuild-search-index", {
      method: "POST"
    }),

  cleanupTags: () =>
    request<{ ok: boolean; deleted: number }>("/maintenance/cleanup-tags", {
      method: "POST"
    }),

  getLogs: (lines = 300) => request<{ file: string; content: string }>(`/logs/app?lines=${lines}`),

  logsFileUrl: () => `${API_BASE}/logs/app/file`
};


================================================================================
文件: frontend/src/App.tsx
================================================================================
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { AudioItem, Playlist, Tag } from "./types";
import { displayAuthor, displayDescription, displayTitle } from "./types";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import AudioList from "./components/AudioList";
import DetailPanel from "./components/DetailPanel";
import PlayerBar from "./components/PlayerBar";
import SettingsPanel from "./components/SettingsPanel";

type ViewMode =
  | "library"
  | "favorites"
  | "playlist"
  | "settings"
  | "missingDescription"
  | "transcribed"
  | "missing"
  | "aiFailed";

type TranscriptFilter = "all" | "yes" | "no";
type MissingFilter = "all" | "available" | "missing";
type ToastType = "info" | "success" | "error";

type Toast = {
  id: number;
  message: string;
  type: ToastType;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function transcriptFilterToParam(value: TranscriptFilter): boolean | undefined {
  if (value === "yes") return true;
  if (value === "no") return false;
  return undefined;
}

function missingFilterToParam(value: MissingFilter): boolean | undefined {
  if (value === "missing") return true;
  if (value === "available") return false;
  return undefined;
}

function isBusyStatus(status?: string): boolean {
  return status === "pending" || status === "running" || status === "cancel_requested";
}

function isSmartView(view: ViewMode): boolean {
  return (
    view === "missingDescription" ||
    view === "transcribed" ||
    view === "missing" ||
    view === "aiFailed"
  );
}

function ToastStack({
  toasts,
  onClose
}: {
  toasts: Toast[];
  onClose: (id: number) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.type}`}>
          <div className="toast-content">
            <div className="toast-message">{toast.message}</div>

            <button className="toast-close" onClick={() => onClose(toast.id)}>
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<ViewMode>("library");
  const [audioItems, setAudioItems] = useState<AudioItem[]>([]);
  const [selected, setSelected] = useState<AudioItem | null>(null);

  const [playing, setPlaying] = useState<AudioItem | null>(null);
  const [playbackQueue, setPlaybackQueue] = useState<AudioItem[]>([]);
  const [playingIndex, setPlayingIndex] = useState(-1);

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | undefined>();
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null);

  const [missingDescriptionOnly, setMissingDescriptionOnly] = useState(false);
  const [hasTranscriptFilter, setHasTranscriptFilter] = useState<TranscriptFilter>("all");
  const [missingFilter, setMissingFilter] = useState<MissingFilter>("all");

  const [tags, setTags] = useState<Tag[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistItemsRaw, setPlaylistItemsRaw] = useState<AudioItem[]>([]);
  const [refreshToken, setRefreshToken] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  const loadSeqRef = useRef(0);
  const backendReadyRef = useRef(false);

  async function ensureBackendReady() {
    if (backendReadyRef.current) return;

    let lastError: unknown = null;

    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        await api.health();
        backendReadyRef.current = true;
        return;
      } catch (err) {
        lastError = err;
        await sleep(500);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Backend is not ready");
  }

  function notify(message: string, type: ToastType = "info") {
    const id = Date.now() + Math.random();

    setToasts((rows) => [
      ...rows,
      {
        id,
        message,
        type
      }
    ]);

    window.setTimeout(
      () => {
        setToasts((rows) => rows.filter((toast) => toast.id !== id));
      },
      type === "error" ? 8000 : 3800
    );
  }

  function closeToast(id: number) {
    setToasts((rows) => rows.filter((toast) => toast.id !== id));
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQ(q);
    }, 240);

    return () => window.clearTimeout(timer);
  }, [q]);

  async function loadNavigation() {
    const [tagRows, playlistRows] = await Promise.all([
      api.listTags().catch(() => []),
      api.listPlaylists().catch(() => [])
    ]);

    setTags(tagRows);
    setPlaylists(playlistRows);
  }

  function applyClientFiltersForPlaylist(items: AudioItem[]) {
    let result = [...items];

    const keyword = debouncedQ.trim().toLowerCase();
    if (keyword) {
      result = result.filter((item) => {
        const text = [
          displayTitle(item),
          displayAuthor(item),
          displayDescription(item),
          item.file_name,
          ...(item.tags || []).map((tag) => tag.name)
        ]
          .join(" ")
          .toLowerCase();

        return text.includes(keyword);
      });
    }

    if (missingDescriptionOnly) {
      result = result.filter((item) => !displayDescription(item).trim());
    }

    if (hasTranscriptFilter === "yes") {
      result = result.filter((item) => item.transcript_status === "done");
    }

    if (hasTranscriptFilter === "no") {
      result = result.filter((item) => item.transcript_status !== "done");
    }

    if (missingFilter === "missing") {
      result = result.filter((item) => item.is_missing);
    }

    if (missingFilter === "available") {
      result = result.filter((item) => !item.is_missing);
    }

    return result;
  }

  async function load() {
    const loadSeq = ++loadSeqRef.current;

    if (view !== "settings") {
      setLoading(true);
    }

    setLoadError("");

    try {
      await ensureBackendReady();
      await loadNavigation();

      if (loadSeq !== loadSeqRef.current) return;

      if (view === "settings") {
        setAudioItems([]);
        setPlaylistItemsRaw([]);
        return;
      }

      let items: AudioItem[] = [];

      if (view === "playlist") {
        if (!selectedPlaylistId) {
          setPlaylistItemsRaw([]);
          setAudioItems([]);
          setSelected(null);
          return;
        }

        const detail = await api.getPlaylist(selectedPlaylistId);

        const rawItems: AudioItem[] = detail.items.map((x) => ({
          ...x.audio,
          playlist_item_id: x.playlist_item.id,
          playlist_order_index: x.playlist_item.order_index
        }));

        setPlaylistItemsRaw(rawItems);
        items = applyClientFiltersForPlaylist(rawItems);
      } else {
        setPlaylistItemsRaw([]);

        items = await api.listAudioItems({
          q: debouncedQ || undefined,
          tag: selectedTag,
          favorite: view === "favorites" ? true : undefined,
          missing_description:
            view === "missingDescription" ? true : missingDescriptionOnly || undefined,
          has_transcript:
            view === "transcribed"
              ? true
              : transcriptFilterToParam(hasTranscriptFilter),
          missing:
            view === "missing" ? true : missingFilterToParam(missingFilter),
          limit: 300
        });

        if (view === "aiFailed") {
          items = items.filter((item) => item.ai_status === "failed");
        }
      }

      if (loadSeq !== loadSeqRef.current) return;

      setAudioItems(items);

      setSelected((prev) => {
        if (items.length === 0) return null;

        if (prev) {
          const found = items.find((x) => x.id === prev.id);
          if (found) return found;
        }

        return items[0];
      });
    } catch (err) {
      if (loadSeq !== loadSeqRef.current) return;

      const message = err instanceof Error ? err.message : String(err);
      setLoadError(message);
      throw err;
    } finally {
      if (loadSeq === loadSeqRef.current) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    load().catch((err) => {
      console.error(err);
      notify(err instanceof Error ? err.message : String(err), "error");
    });
  }, [
    view,
    debouncedQ,
    selectedTag,
    selectedPlaylistId,
    missingDescriptionOnly,
    hasTranscriptFilter,
    missingFilter,
    refreshToken
  ]);

  function refresh() {
    setRefreshToken((v) => v + 1);
  }

  function handlePlaybackPositionSaved(audioId: number, position: number) {
    const lastPlayedAt = new Date().toISOString();

    const patch = (item: AudioItem): AudioItem =>
      item.id === audioId
        ? {
            ...item,
            last_position_seconds: position,
            last_played_at: lastPlayedAt
          }
        : item;

    setAudioItems((rows) => rows.map(patch));
    setPlaylistItemsRaw((rows) => rows.map(patch));
    setPlaybackQueue((rows) => rows.map(patch));
    setSelected((prev) => (prev ? patch(prev) : prev));
    setPlaying((prev) => (prev ? patch(prev) : prev));
  }

  function clearFilters() {
    setQ("");
    setSelectedTag(undefined);
    setMissingDescriptionOnly(false);
    setHasTranscriptFilter("all");
    setMissingFilter("all");

    if (isSmartView(view)) {
      setView("library");
    }
  }

  function openSettings() {
    setView("settings");
    setSelectedTag(undefined);
    setSelectedPlaylistId(null);
  }

  async function playQueueIndex(index: number, queue: AudioItem[] = playbackQueue) {
    const item = queue[index];
    if (!item) return;

    setPlaybackQueue(queue);
    setPlayingIndex(index);
    setPlaying(item);
    setSelected(item);

    await api.incrementPlayCount(item.id).catch(console.error);
  }

  async function playAudio(item: AudioItem, queue: AudioItem[] = audioItems) {
    const nextQueue = queue.length > 0 ? queue : [item];
    const index = Math.max(
      0,
      nextQueue.findIndex((x) => x.id === item.id)
    );

    await playQueueIndex(index, nextQueue);
  }

  async function playAudioAt(
    item: AudioItem,
    startSeconds: number,
    queue: AudioItem[] = audioItems
  ) {
    await playAudio(item, queue);

    window.setTimeout(() => {
      const audioEl = document.querySelector("audio");
      if (audioEl) {
        audioEl.currentTime = startSeconds;
        audioEl.play().catch(console.error);
      }
    }, 160);
  }

  function playPrevious() {
    if (playingIndex <= 0) return;
    void playQueueIndex(playingIndex - 1, playbackQueue);
  }

  function playNext() {
    if (playingIndex < 0 || playingIndex >= playbackQueue.length - 1) return;
    void playQueueIndex(playingIndex + 1, playbackQueue);
  }

  async function removeQueueItem(index: number) {
    if (index < 0 || index >= playbackQueue.length) return;

    const nextQueue = playbackQueue.filter((_, i) => i !== index);

    if (index === playingIndex) {
      if (nextQueue.length === 0) {
        setPlaybackQueue([]);
        setPlayingIndex(-1);
        setPlaying(null);
        notify("播放队列已清空", "info");
        return;
      }

      const nextIndex = Math.min(index, nextQueue.length - 1);
      await playQueueIndex(nextIndex, nextQueue);
      notify("已移除当前音频并播放下一条", "info");
      return;
    }

    setPlaybackQueue(nextQueue);

    if (index < playingIndex) {
      setPlayingIndex((v) => v - 1);
    }

    notify("已从播放队列移除", "success");
  }

  function clearQueue() {
    if (playbackQueue.length === 0) return;

    const ok = window.confirm("确认清空播放队列并停止播放？");
    if (!ok) return;

    setPlaybackQueue([]);
    setPlayingIndex(-1);
    setPlaying(null);
    notify("播放队列已清空", "info");
  }

  async function batchTranscribeCurrentList() {
    if (audioItems.length === 0) return;

    const eligible = audioItems.filter(
      (item) => !item.is_missing && !isBusyStatus(item.transcript_status)
    );

    if (eligible.length === 0) {
      notify("当前列表没有可创建转写任务的音频。缺失文件或进行中的任务会被跳过。", "info");
      return;
    }

    const skippedByClient = audioItems.length - eligible.length;

    const ok = window.confirm(
      `将为 ${eligible.length} 个音频创建转写任务${
        skippedByClient ? `，并跳过 ${skippedByClient} 个缺失文件或进行中的音频` : ""
      }。确认继续？`
    );

    if (!ok) return;

    try {
      const result = await api.batchTranscribe(eligible.map((x) => x.id));
      const skippedTotal = skippedByClient + result.skipped;

      notify(`已创建 ${result.created} 个转写任务，跳过 ${skippedTotal} 个。`, "success");
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function batchAnalyzeCurrentList() {
    if (audioItems.length === 0) return;

    const eligible = audioItems.filter((item) => !isBusyStatus(item.ai_status));

    if (eligible.length === 0) {
      notify("当前列表没有可创建 AI 分析任务的音频。进行中的任务会被跳过。", "info");
      return;
    }

    const skippedByClient = audioItems.length - eligible.length;

    const ok = window.confirm(
      `将为 ${eligible.length} 个音频创建 AI 分析任务${
        skippedByClient ? `，并跳过 ${skippedByClient} 个进行中的音频` : ""
      }。确认继续？`
    );

    if (!ok) return;

    try {
      const result = await api.batchAnalyze(eligible.map((x) => x.id));

      if (result.privacy_warning) {
        notify(result.privacy_warning, "error");
      }

      const skippedTotal = skippedByClient + result.skipped;

      notify(`已创建 ${result.created} 个 AI 分析任务，跳过 ${skippedTotal} 个。`, "success");
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function removeFromCurrentPlaylist(item: AudioItem) {
    if (!selectedPlaylistId || !item.playlist_item_id) return;

    const ok = window.confirm(`确认从当前 playlist 移除「${displayTitle(item)}」？`);
    if (!ok) return;

    try {
      await api.removePlaylistItem(selectedPlaylistId, item.playlist_item_id);

      setPlaylistItemsRaw((rows) =>
        rows.filter((x) => x.playlist_item_id !== item.playlist_item_id)
      );

      setAudioItems((rows) =>
        rows.filter((x) => x.playlist_item_id !== item.playlist_item_id)
      );

      if (selected?.id === item.id) {
        setSelected(null);
      }

      notify("已从 playlist 移除", "success");
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function persistPlaylistOrder(nextRaw: AudioItem[]) {
    if (!selectedPlaylistId) return;

    const itemIds = nextRaw
      .map((x) => x.playlist_item_id)
      .filter((id): id is number => typeof id === "number");

    if (itemIds.length !== nextRaw.length) return;

    await api.reorderPlaylistItems(selectedPlaylistId, itemIds);

    const normalized = nextRaw.map((x, index) => ({
      ...x,
      playlist_order_index: index
    }));

    setPlaylistItemsRaw(normalized);
    setAudioItems(applyClientFiltersForPlaylist(normalized));
  }

  async function movePlaylistItem(item: AudioItem, direction: "up" | "down") {
    if (!selectedPlaylistId || !item.playlist_item_id) return;

    const currentIndex = playlistItemsRaw.findIndex(
      (x) => x.playlist_item_id === item.playlist_item_id
    );

    if (currentIndex < 0) return;

    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= playlistItemsRaw.length) return;

    const nextRaw = [...playlistItemsRaw];
    const tmp = nextRaw[currentIndex];
    nextRaw[currentIndex] = nextRaw[targetIndex];
    nextRaw[targetIndex] = tmp;

    try {
      await persistPlaylistOrder(nextRaw);
      notify("Playlist 顺序已更新", "success");
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function movePlaylistItemTo(source: AudioItem, target: AudioItem) {
    if (!selectedPlaylistId || !source.playlist_item_id || !target.playlist_item_id) return;
    if (source.playlist_item_id === target.playlist_item_id) return;

    const sourceIndex = playlistItemsRaw.findIndex(
      (x) => x.playlist_item_id === source.playlist_item_id
    );

    const targetIndex = playlistItemsRaw.findIndex(
      (x) => x.playlist_item_id === target.playlist_item_id
    );

    if (sourceIndex < 0 || targetIndex < 0) return;

    const nextRaw = [...playlistItemsRaw];
    const [moved] = nextRaw.splice(sourceIndex, 1);
    nextRaw.splice(targetIndex, 0, moved);

    try {
      await persistPlaylistOrder(nextRaw);
      notify("Playlist 顺序已更新", "success");
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  }

  function handleAudioDeleted() {
    setSelected(null);
    refresh();
  }

  const activePlaylist = playlists.find((p) => p.id === selectedPlaylistId);

  let listTitle = "资料库";
  let listSubtitle = "浏览、搜索和整理你的本地音频知识库";

  if (view === "favorites") {
    listTitle = "收藏";
    listSubtitle = "你标记为常听或重要的音频";
  }

  if (view === "playlist") {
    listTitle = activePlaylist ? activePlaylist.name : "播放列表";
    listSubtitle = activePlaylist?.description || "管理当前播放列表中的音频顺序";
  }

  if (view === "missingDescription") {
    listTitle = "缺少描述";
    listSubtitle = "需要补充用户描述或 AI 描述的音频";
  }

  if (view === "transcribed") {
    listTitle = "已转写";
    listSubtitle = "已经生成 transcript，可全文搜索和导出的音频";
  }

  if (view === "missing") {
    listTitle = "文件缺失";
    listSubtitle = "数据库中存在，但本地文件路径不可用的音频";
  }

  if (view === "aiFailed") {
    listTitle = "AI 失败";
    listSubtitle = "AI 分析失败或需要重新处理的音频";
  }

  const hasActiveFilter =
    Boolean(q.trim()) ||
    Boolean(selectedTag) ||
    missingDescriptionOnly ||
    hasTranscriptFilter !== "all" ||
    missingFilter !== "all" ||
    isSmartView(view);

  return (
    <div className="app-shell">
      <div className={`main-shell ${view === "settings" ? "settings-mode" : ""}`}>
        <Sidebar
          view={view}
          setView={setView}
          tags={tags}
          selectedTag={selectedTag}
          setSelectedTag={setSelectedTag}
          playlists={playlists}
          selectedPlaylistId={selectedPlaylistId}
          setSelectedPlaylistId={setSelectedPlaylistId}
          refresh={refresh}
        />

        {view === "settings" ? (
          <main className="workspace settings-workspace">
            <SettingsPanel refresh={refresh} notify={notify} />
          </main>
        ) : (
          <>
            <main className="workspace">
              <TopBar
                title={listTitle}
                subtitle={listSubtitle}
                totalCount={audioItems.length}
                q={q}
                setQ={setQ}
                isLoading={loading}
                hasActiveFilter={hasActiveFilter}
                onClearFilters={clearFilters}
                missingDescriptionOnly={missingDescriptionOnly}
                setMissingDescriptionOnly={setMissingDescriptionOnly}
                hasTranscriptFilter={hasTranscriptFilter}
                setHasTranscriptFilter={setHasTranscriptFilter}
                missingFilter={missingFilter}
                setMissingFilter={setMissingFilter}
                onBatchTranscribe={batchTranscribeCurrentList}
                onBatchAnalyze={batchAnalyzeCurrentList}
                onOpenSettings={openSettings}
              />

              <AudioList
                title={listTitle}
                q={q}
                setQ={setQ}
                isLoading={loading}
                loadError={loadError}
                onOpenSettings={openSettings}
                onClearFilters={clearFilters}
                missingDescriptionOnly={missingDescriptionOnly}
                setMissingDescriptionOnly={setMissingDescriptionOnly}
                hasTranscriptFilter={hasTranscriptFilter}
                setHasTranscriptFilter={setHasTranscriptFilter}
                missingFilter={missingFilter}
                setMissingFilter={setMissingFilter}
                items={audioItems}
                selectedId={selected?.id}
                onSelect={setSelected}
                onPlay={(item) => playAudio(item, audioItems)}
                onPlayAt={(item, seconds) => playAudioAt(item, seconds, audioItems)}
                onBatchTranscribe={batchTranscribeCurrentList}
                onBatchAnalyze={batchAnalyzeCurrentList}
                isPlaylistView={view === "playlist"}
                onRemoveFromPlaylist={
                  view === "playlist" ? removeFromCurrentPlaylist : undefined
                }
                onMovePlaylistItem={view === "playlist" ? movePlaylistItem : undefined}
                onMovePlaylistItemTo={
                  view === "playlist" ? movePlaylistItemTo : undefined
                }
              />
            </main>

            <DetailPanel
              audio={selected}
              refresh={refresh}
              onPlay={(item) => playAudio(item, audioItems)}
              playlists={playlists}
              selectedPlaylistId={selectedPlaylistId}
              onDeleted={handleAudioDeleted}
              notify={notify}
            />
          </>
        )}
      </div>

      <PlayerBar
        audio={playing}
        queue={playbackQueue}
        queueIndex={playingIndex}
        canPrevious={playingIndex > 0}
        canNext={playingIndex >= 0 && playingIndex < playbackQueue.length - 1}
        onPrevious={playPrevious}
        onNext={playNext}
        onQueueSelect={(index) => void playQueueIndex(index, playbackQueue)}
        onQueueRemove={(index) => void removeQueueItem(index)}
        onQueueClear={clearQueue}
        onPositionSaved={handlePlaybackPositionSaved}
      />

      <ToastStack toasts={toasts} onClose={closeToast} />
    </div>
  );
}


================================================================================
文件: frontend/src/components/AudioList.tsx
================================================================================
import { useState } from "react";
import { api } from "../api";
import type { AudioItem } from "../types";
import { displayAuthor, displayDescription, displayTitle, formatDuration } from "../types";

type TranscriptFilter = "all" | "yes" | "no";
type MissingFilter = "all" | "available" | "missing";

type Props = {
  title: string;
  q: string;
  setQ: (q: string) => void;
  isLoading?: boolean;
  loadError?: string;
  onOpenSettings: () => void;
  onClearFilters: () => void;
  missingDescriptionOnly: boolean;
  setMissingDescriptionOnly: (v: boolean) => void;
  hasTranscriptFilter: TranscriptFilter;
  setHasTranscriptFilter: (v: TranscriptFilter) => void;
  missingFilter: MissingFilter;
  setMissingFilter: (v: MissingFilter) => void;
  items: AudioItem[];
  selectedId?: number;
  onSelect: (item: AudioItem) => void;
  onPlay: (item: AudioItem) => void;
  onPlayAt: (item: AudioItem, startSeconds: number) => void;
  onBatchTranscribe: () => void;
  onBatchAnalyze: () => void;
  isPlaylistView?: boolean;
  onRemoveFromPlaylist?: (item: AudioItem) => void;
  onMovePlaylistItem?: (item: AudioItem, direction: "up" | "down") => void;
  onMovePlaylistItemTo?: (source: AudioItem, target: AudioItem) => void;
};

const STATUS_TEXT: Record<string, string> = {
  none: "未开始",
  pending: "等待中",
  running: "进行中",
  done: "已完成",
  failed: "失败",
  canceled: "已取消"
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function HighlightText({
  text,
  query
}: {
  text?: string;
  query: string;
}) {
  const value = text || "";
  const tokens = query
    .trim()
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

  if (!value || tokens.length === 0) {
    return <>{value}</>;
  }

  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "gi");
  const parts = value.split(pattern);

  return (
    <>
      {parts.map((part, index) => {
        const matched = tokens.some((token) => part.toLowerCase() === token.toLowerCase());

        if (!matched) {
          return <span key={index}>{part}</span>;
        }

        return <mark key={index}>{part}</mark>;
      })}
    </>
  );
}

function statusClass(value?: string): string {
  return (value || "none").toLowerCase().replace(/[^a-z0-9_-]/g, "") || "none";
}

function StatusPill({
  label,
  value
}: {
  label: string;
  value?: string;
}) {
  const cls = statusClass(value);
  const text = STATUS_TEXT[cls] || value || "未开始";

  return (
    <span className={`status-pill ${cls}`}>
      <span>{label}</span>
      {text}
    </span>
  );
}

function CoverThumb({ item }: { item: AudioItem }) {
  return (
    <div className={`cover-thumb ${item.is_missing ? "missing" : ""}`}>
      <span aria-hidden="true">♪</span>

      {item.cover_path && (
        <img
          src={api.coverUrl(item.id, item.updated_at)}
          alt=""
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      )}
    </div>
  );
}

function RowTags({
  item,
  query
}: {
  item: AudioItem;
  query: string;
}) {
  const tags = item.tags || [];

  if (tags.length === 0) return null;

  return (
    <div className="row-tags">
      {tags.slice(0, 5).map((tag) => (
        <span className="mini-tag" key={tag.id}>
          #<HighlightText text={tag.name} query={query} />
        </span>
      ))}

      {tags.length > 5 && <span className="mini-tag muted-tag">+{tags.length - 5}</span>}
    </div>
  );
}

function SearchHits({
  item,
  query,
  onPlayAt
}: {
  item: AudioItem;
  query: string;
  onPlayAt: (item: AudioItem, startSeconds: number) => void;
}) {
  const hits = item.search_hits || [];

  if (!query.trim() || hits.length === 0) return null;

  return (
    <div className="search-hits">
      {hits.map((hit, index) => (
        <div
          key={`${hit.field}-${index}`}
          className={hit.start_seconds !== undefined ? "search-hit timed" : "search-hit"}
        >
          {hit.start_seconds !== undefined ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPlayAt(item, hit.start_seconds || 0);
              }}
              title="从该 transcript 命中位置播放"
            >
              {formatDuration(hit.start_seconds)}
            </button>
          ) : (
            <strong>{hit.label}</strong>
          )}

          <span>
            {hit.start_seconds !== undefined && <strong>{hit.label}</strong>}
            <HighlightText text={hit.text} query={query} />
          </span>
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  q,
  missingDescriptionOnly,
  hasTranscriptFilter,
  missingFilter,
  onOpenSettings,
  onClearFilters
}: {
  q: string;
  missingDescriptionOnly: boolean;
  hasTranscriptFilter: TranscriptFilter;
  missingFilter: MissingFilter;
  onOpenSettings: () => void;
  onClearFilters: () => void;
}) {
  const hasFilter =
    Boolean(q.trim()) ||
    missingDescriptionOnly ||
    hasTranscriptFilter !== "all" ||
    missingFilter !== "all";

  return (
    <div className="empty-state">
      <div className="empty-illustration">🎧</div>

      <div className="empty-title">
        {hasFilter ? "没有找到匹配的音频" : "还没有导入音频"}
      </div>

      <div className="empty-subtitle">
        {hasFilter
          ? "当前搜索或筛选条件没有命中结果。可以清空筛选后重新浏览。"
          : "添加本地媒体库目录后，系统会自动读取 metadata、封面，并支持转写和 AI 标签整理。"}
      </div>

      <div className="empty-actions">
        {hasFilter ? (
          <button className="primary-button" onClick={onClearFilters}>
            清空筛选
          </button>
        ) : (
          <button className="primary-button" onClick={onOpenSettings}>
            添加媒体库
          </button>
        )}

        <button className="ghost-button" onClick={onOpenSettings}>
          打开设置
        </button>
      </div>

      <div className="empty-support">
        支持 MP3 / M4A / FLAC / WAV / OGG · 可转写 · 可 AI 生成描述和标签
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="list-skeleton" aria-label="正在加载音频列表">
      {Array.from({ length: 7 }).map((_, index) => (
        <div className="skeleton-row" key={index}>
          <span className="skeleton-cover" />
          <span className="skeleton-content">
            <span className="skeleton-line long" />
            <span className="skeleton-line medium" />
            <span className="skeleton-line short" />
          </span>
          <span className="skeleton-action" />
        </div>
      ))}
    </div>
  );
}

export default function AudioList({
  q,
  isLoading = false,
  loadError,
  onOpenSettings,
  onClearFilters,
  missingDescriptionOnly,
  hasTranscriptFilter,
  missingFilter,
  items,
  selectedId,
  onSelect,
  onPlay,
  onPlayAt,
  isPlaylistView,
  onRemoveFromPlaylist,
  onMovePlaylistItem,
  onMovePlaylistItemTo
}: Props) {
  const [draggedPlaylistItemId, setDraggedPlaylistItemId] = useState<number | null>(null);

  function findDraggedItem(): AudioItem | undefined {
    if (!draggedPlaylistItemId) return undefined;
    return items.find((item) => item.playlist_item_id === draggedPlaylistItemId);
  }

  return (
    <section className="audio-list-panel" aria-busy={isLoading}>
      {loadError && (
        <div className="list-error">
          <strong>列表加载失败</strong>
          <span>{loadError}</span>
          <button onClick={onClearFilters}>清空筛选后重试</button>
        </div>
      )}

      {isLoading && items.length > 0 && (
        <div className="list-loading-bar">正在更新结果…</div>
      )}

      {isLoading && items.length === 0 && <ListSkeleton />}

      {!isLoading && !loadError && items.length === 0 && (
        <EmptyState
          q={q}
          missingDescriptionOnly={missingDescriptionOnly}
          hasTranscriptFilter={hasTranscriptFilter}
          missingFilter={missingFilter}
          onOpenSettings={onOpenSettings}
          onClearFilters={onClearFilters}
        />
      )}

      <div className="audio-scroll-list">
        {items.map((item) => {
          const draggable = Boolean(isPlaylistView && item.playlist_item_id);
          const description = displayDescription(item);

          return (
            <div
              key={
                isPlaylistView && item.playlist_item_id
                  ? `${item.id}-${item.playlist_item_id}`
                  : item.id
              }
              className={`audio-row ${selectedId === item.id ? "selected" : ""}`}
              draggable={draggable}
              onDragStart={(e) => {
                if (!draggable || !item.playlist_item_id) return;
                setDraggedPlaylistItemId(item.playlist_item_id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                if (!draggable) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                if (!draggable) return;
                e.preventDefault();

                const source = findDraggedItem();
                if (source) {
                  onMovePlaylistItemTo?.(source, item);
                }

                setDraggedPlaylistItemId(null);
              }}
              onDragEnd={() => setDraggedPlaylistItemId(null)}
              onClick={() => onSelect(item)}
              onDoubleClick={() => onPlay(item)}
              style={{
                opacity:
                  draggedPlaylistItemId && draggedPlaylistItemId === item.playlist_item_id
                    ? 0.62
                    : 1
              }}
            >
              <CoverThumb item={item} />

              <div className="audio-info">
                <div className="title-line">
                  <div className="title">
                    {item.is_favorite ? "★ " : ""}
                    <HighlightText text={displayTitle(item)} query={q} />
                  </div>

                  {item.is_missing ? <span className="badge danger">missing</span> : null}

                  {draggable && (
                    <span className="drag-hint" title="拖拽可调整 playlist 顺序">
                      ⠿
                    </span>
                  )}
                </div>

                <div className="meta-line">
                  <span>
                    <HighlightText text={displayAuthor(item) || "Unknown"} query={q} />
                  </span>
                  <span className="meta-dot">·</span>
                  <span>{formatDuration(item.duration_seconds)}</span>
                  {item.language && (
                    <>
                      <span className="meta-dot">·</span>
                      <span>{item.language}</span>
                    </>
                  )}
                </div>

                {description && (
                  <div className="description-line">
                    <HighlightText text={description} query={q} />
                  </div>
                )}

                <RowTags item={item} query={q} />

                <div className="row-status">
                  <StatusPill label="转写" value={item.transcript_status} />
                  <StatusPill label="AI" value={item.ai_status} />
                </div>

                <SearchHits item={item} query={q} onPlayAt={onPlayAt} />
              </div>

              <div className="row-actions">
                <button
                  className="row-play-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlay(item);
                  }}
                >
                  播放
                </button>

                {isPlaylistView && item.playlist_item_id && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onMovePlaylistItem?.(item, "up");
                      }}
                      title="在当前 playlist 中上移"
                    >
                      ↑
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onMovePlaylistItem?.(item, "down");
                      }}
                      title="在当前 playlist 中下移"
                    >
                      ↓
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveFromPlaylist?.(item);
                      }}
                      title="从当前 playlist 移除"
                    >
                      移除
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}


================================================================================
文件: frontend/src/components/DetailPanel.tsx
================================================================================
import { useEffect, useMemo, useState } from "react";
import { api, endpointPrivacyWarning } from "../api";
import type { AISuggestions, AudioItem, Playlist, Tag, Transcript } from "../types";
import { displayAuthor, displayDescription, displayTitle, formatDuration } from "../types";
import { pickAudioFile } from "../tauri";

type ToastType = "info" | "success" | "error";
type InspectorTab = "overview" | "ai" | "transcript" | "file";

type Props = {
  audio: AudioItem | null;
  refresh: () => void;
  onPlay: (a: AudioItem) => void;
  playlists: Playlist[];
  selectedPlaylistId?: number | null;
  onDeleted: () => void;
  notify?: (message: string, type?: ToastType) => void;
};

export default function DetailPanel({
  audio,
  refresh,
  onPlay,
  playlists,
  selectedPlaylistId,
  onDeleted,
  notify
}: Props) {
  const [activeTab, setActiveTab] = useState<InspectorTab>("overview");

  const [tags, setTags] = useState<Tag[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [selectedExistingTag, setSelectedExistingTag] = useState<number | "">("");
  const [editing, setEditing] = useState<Partial<AudioItem>>({});
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<AISuggestions | null>(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState<number | "">("");
  const [relocatePath, setRelocatePath] = useState("");
  const [coverVersion, setCoverVersion] = useState(Date.now());

  const acceptedTagNames = useMemo(() => {
    return new Set(tags.map((t) => t.name));
  }, [tags]);

  const availableExistingTags = useMemo(() => {
    return allTags.filter((tag) => !acceptedTagNames.has(tag.name));
  }, [allTags, acceptedTagNames]);

  useEffect(() => {
    async function load() {
      setTranscript(null);
      setAiSuggestions(null);
      setRelocatePath("");
      setSelectedExistingTag("");
      setActiveTab("overview");

      if (!audio) return;

      setCoverVersion(Date.now());

      const [detail, tagRows] = await Promise.all([
        api.getAudioDetail(audio.id),
        api.listTags().catch(() => [])
      ]);

      setTags(detail.tags);
      setAllTags(tagRows);

      setEditing({
        title_user: detail.audio.title_user || "",
        author_user: detail.audio.author_user || "",
        album_user: detail.audio.album_user || "",
        description_user: detail.audio.description_user || "",
        language: detail.audio.language || "",
        is_favorite: detail.audio.is_favorite
      });

      api.getTranscript(audio.id).then(setTranscript).catch(() => setTranscript(null));
      api.getAiSuggestions(audio.id).then(setAiSuggestions).catch(() => setAiSuggestions(null));
    }

    load().catch((err) => {
      console.error(err);
      notify?.(err instanceof Error ? err.message : String(err), "error");
    });
  }, [audio?.id]);

  if (!audio) {
    return (
      <aside className="inspector-panel empty-inspector">
        <div className="empty-detail-card">
          <div className="empty-detail-icon">♪</div>

          <span className="eyebrow">Inspector</span>

          <h2>选择一个音频开始整理</h2>

          <p>
            在中间列表中选择音频后，可以查看封面、metadata、播放记录、标签、AI 建议和 transcript。
          </p>

          <div className="detail-empty-steps">
            <div>
              <strong>1</strong>
              <span>添加媒体库目录</span>
            </div>

            <div>
              <strong>2</strong>
              <span>扫描并导入音频</span>
            </div>

            <div>
              <strong>3</strong>
              <span>转写、AI 分析、整理标签</span>
            </div>
          </div>
        </div>
      </aside>
    );
  }

  async function reloadTagsAndSuggestions() {
    const [detail, tagRows] = await Promise.all([
      api.getAudioDetail(audio!.id),
      api.listTags().catch(() => [])
    ]);

    setTags(detail.tags);
    setAllTags(tagRows);

    const suggestions = await api.getAiSuggestions(audio!.id).catch(() => null);
    setAiSuggestions(suggestions);
  }

  async function save() {
    try {
      await api.updateAudio(audio!.id, editing);
      notify?.("Metadata 已保存", "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function addTags() {
    const names = tagInput
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

    if (names.length === 0) return;

    try {
      await api.addTags(audio!.id, names, "user");
      setTagInput("");

      await reloadTagsAndSuggestions();
      notify?.("标签已添加", "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function addExistingTag() {
    if (!selectedExistingTag) return;

    const tag = allTags.find((x) => x.id === Number(selectedExistingTag));
    if (!tag) return;

    try {
      await api.addTags(audio!.id, [tag.name], "user");
      setSelectedExistingTag("");

      await reloadTagsAndSuggestions();
      notify?.("已有标签已添加", "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function removeTag(tagId: number) {
    try {
      await api.removeTag(audio!.id, tagId);

      await reloadTagsAndSuggestions();
      notify?.("标签已移除", "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function transcribe() {
    try {
      await api.transcribe(audio!.id);
      refresh();
      notify?.("已创建转写任务，可在设置中心的任务页查看状态。", "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function analyze() {
    try {
      const settings = await api.listSettings();
      const endpoint = settings.find((s) => s.key === "llm.endpoint")?.value;
      const modelName = settings.find((s) => s.key === "llm.model_name")?.value;

      if (!endpoint || !modelName) {
        notify?.("请先在设置中心配置本地 LLM endpoint 和 model_name。", "error");
        return;
      }

      const warning = endpointPrivacyWarning(endpoint);
      if (warning) {
        const ok = window.confirm(`${warning}\n\n确认继续发起 AI 分析？`);
        if (!ok) return;
      }

      const task = await api.analyze(audio!.id);

      if (task.privacy_warning) {
        notify?.(task.privacy_warning, "error");
      }

      refresh();
      notify?.("已创建 AI 分析任务。完成后会显示 AI 建议描述和标签。", "success");
      setActiveTab("ai");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function addToPlaylist() {
    if (!selectedPlaylist) return;

    try {
      await api.addToPlaylist(Number(selectedPlaylist), audio!.id);
      notify?.("已添加到 playlist", "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function acceptAiDescription() {
    const description = aiSuggestions?.description || audio?.description_ai;
    if (!description) return;

    try {
      await api.updateAudio(audio!.id, {
        description_user: description
      });

      setEditing({ ...editing, description_user: description });
      notify?.("AI 描述已接受为用户描述", "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function acceptAiTag(tagName: string) {
    try {
      await api.addTags(audio!.id, [tagName], "ai");

      await reloadTagsAndSuggestions();
      notify?.(`已接受标签：${tagName}`, "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function acceptAllAiTags() {
    const names =
      aiSuggestions?.tags
        .map((x) => x.trim())
        .filter((x) => x && !acceptedTagNames.has(x)) || [];

    if (names.length === 0) return;

    try {
      await api.addTags(audio!.id, names, "ai");

      await reloadTagsAndSuggestions();
      notify?.(`已接受 ${names.length} 个 AI 标签`, "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  function jumpToSegment(startSeconds: number) {
    onPlay(audio!);

    setTimeout(() => {
      const audioEl = document.querySelector("audio");
      if (audioEl) {
        audioEl.currentTime = startSeconds;
        audioEl.play().catch(console.error);
      }
    }, 120);
  }

  async function uploadCover(file?: File) {
    if (!file) return;

    try {
      await api.uploadCover(audio!.id, file);
      setCoverVersion(Date.now());
      notify?.("封面已上传", "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function deleteCover() {
    const ok = window.confirm("确认删除当前封面？");
    if (!ok) return;

    try {
      await api.deleteCover(audio!.id);
      setCoverVersion(Date.now());
      notify?.("封面已删除", "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function chooseRelocateFile() {
    const selected = await pickAudioFile();
    if (selected) {
      setRelocatePath(selected);
    }
  }

  async function relocate() {
    const path = relocatePath.trim();
    if (!path) return;

    try {
      await api.relocateAudio(audio!.id, path);
      setRelocatePath("");
      notify?.("文件已重新定位", "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function deleteFromDatabase() {
    const ok = window.confirm("确认从应用数据库中移除该条目？不会删除本地音频文件。");
    if (!ok) return;

    try {
      await api.deleteAudio(audio!.id, false);
      notify?.("音频条目已从数据库移除", "success");
      onDeleted();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  function exportTranscript(format: "txt" | "json" | "srt") {
    window.open(api.transcriptExportUrl(audio!.id, format), "_blank");
  }

  function exportPlaylist(format: "json" | "m3u") {
    if (!selectedPlaylistId) return;
    window.open(api.playlistExportUrl(selectedPlaylistId, format), "_blank");
  }

  const hasAiDescription = Boolean(aiSuggestions?.description || audio.description_ai);
  const aiTags = aiSuggestions?.tags || [];

  return (
    <aside className="inspector-panel">
      <div className="inspector-hero">
        <div className="inspector-cover">
          {audio.cover_path ? (
            <img
              src={api.coverUrl(audio.id, coverVersion)}
              alt=""
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : (
            <span>♪</span>
          )}
        </div>

        <div className="inspector-title">
          <h2>{displayTitle(audio)}</h2>
          <p>
            {displayAuthor(audio) || "Unknown"} · {formatDuration(audio.duration_seconds)}
          </p>

          <div className="detail-meta-strip">
            <span>{audio.file_ext || "audio"}</span>
            <span>{audio.is_missing ? "文件缺失" : "文件可用"}</span>
            <span className={`status-pill ${audio.transcript_status}`}>
              转写 {audio.transcript_status}
            </span>
            <span className={`status-pill ${audio.ai_status}`}>AI {audio.ai_status}</span>
          </div>
        </div>

        <div className="inspector-actions">
          <button className="primary-button" onClick={() => onPlay(audio)}>
            播放
          </button>
          <button onClick={transcribe}>转写</button>
          <button onClick={analyze}>AI 分析</button>
          <label className="upload-button">
            封面
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => uploadCover(e.currentTarget.files?.[0])}
            />
          </label>
        </div>
      </div>

      <div className="inspector-tabs">
        <button
          className={activeTab === "overview" ? "active" : ""}
          onClick={() => setActiveTab("overview")}
        >
          概览
        </button>

        <button
          className={activeTab === "ai" ? "active" : ""}
          onClick={() => setActiveTab("ai")}
        >
          AI
        </button>

        <button
          className={activeTab === "transcript" ? "active" : ""}
          onClick={() => setActiveTab("transcript")}
        >
          Transcript
        </button>

        <button
          className={activeTab === "file" ? "active" : ""}
          onClick={() => setActiveTab("file")}
        >
          文件
        </button>
      </div>

      <div className="inspector-body">
        {activeTab === "overview" && (
          <div className="inspector-section-stack">
            <section className="panel-card">
              <h3>Metadata</h3>

              <div className="field-grid">
                <label>
                  用户标题
                  <input
                    value={(editing.title_user as string) || ""}
                    onChange={(e) => setEditing({ ...editing, title_user: e.target.value })}
                  />
                </label>

                <label>
                  作者
                  <input
                    value={(editing.author_user as string) || ""}
                    onChange={(e) => setEditing({ ...editing, author_user: e.target.value })}
                  />
                </label>

                <label>
                  专辑
                  <input
                    value={(editing.album_user as string) || ""}
                    onChange={(e) => setEditing({ ...editing, album_user: e.target.value })}
                  />
                </label>

                <label>
                  语言
                  <input
                    value={(editing.language as string) || ""}
                    onChange={(e) => setEditing({ ...editing, language: e.target.value })}
                  />
                </label>

                <label className="checkbox-row wide">
                  <input
                    type="checkbox"
                    checked={Boolean(editing.is_favorite)}
                    onChange={(e) =>
                      setEditing({ ...editing, is_favorite: e.target.checked })
                    }
                  />
                  收藏
                </label>

                <label className="wide">
                  用户描述
                  <textarea
                    value={(editing.description_user as string) || ""}
                    onChange={(e) =>
                      setEditing({ ...editing, description_user: e.target.value })
                    }
                  />
                </label>
              </div>

              <div className="section-actions">
                <button className="primary-button" onClick={save}>
                  保存 metadata
                </button>
              </div>
            </section>

            <section className="panel-card">
              <h3>Tags</h3>

              <div className="tag-list">
                {tags.map((tag) => (
                  <span className="tag" key={tag.id}>
                    #{tag.name}
                    <button onClick={() => removeTag(tag.id)}>×</button>
                  </span>
                ))}
              </div>

              <div className="inline-form">
                <input
                  value={tagInput}
                  placeholder="新标签，可用逗号分隔"
                  onChange={(e) => setTagInput(e.target.value)}
                />
                <button onClick={addTags}>添加</button>
              </div>

              <div className="inline-form">
                <select
                  value={selectedExistingTag}
                  onChange={(e) =>
                    setSelectedExistingTag(e.target.value ? Number(e.target.value) : "")
                  }
                >
                  <option value="">选择已有标签</option>
                  {availableExistingTags.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      #{tag.name}
                    </option>
                  ))}
                </select>
                <button onClick={addExistingTag} disabled={!selectedExistingTag}>
                  添加已有标签
                </button>
              </div>
            </section>

            <section className="panel-card">
              <h3>Playlist</h3>

              <div className="inline-form">
                <select
                  value={selectedPlaylist}
                  onChange={(e) =>
                    setSelectedPlaylist(e.target.value ? Number(e.target.value) : "")
                  }
                >
                  <option value="">选择 playlist</option>
                  {playlists.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>

                <button onClick={addToPlaylist}>加入</button>
              </div>

              {selectedPlaylistId && (
                <div className="section-actions">
                  <button onClick={() => exportPlaylist("json")}>导出当前 JSON</button>
                  <button onClick={() => exportPlaylist("m3u")}>导出当前 M3U</button>
                </div>
              )}
            </section>

            <section className="panel-card">
              <h3>当前描述</h3>
              <p>{displayDescription(audio) || "暂无描述"}</p>
            </section>
          </div>
        )}

        {activeTab === "ai" && (
          <div className="inspector-section-stack">
            <section className="panel-card ai-card">
              <div className="card-heading-row">
                <h3>AI 建议描述</h3>
                <button onClick={analyze}>重新分析</button>
              </div>

              {hasAiDescription ? (
                <>
                  <p>{aiSuggestions?.description || audio.description_ai}</p>
                  <button className="primary-button" onClick={acceptAiDescription}>
                    接受为用户描述
                  </button>
                </>
              ) : (
                <div className="soft-empty">
                  暂无 AI 建议。点击「AI 分析」后，会根据 metadata 和 transcript 生成描述。
                </div>
              )}
            </section>

            <section className="panel-card">
              <div className="card-heading-row">
                <h3>AI 标签建议</h3>
                {aiTags.length > 0 && (
                  <button onClick={acceptAllAiTags}>接受全部未添加标签</button>
                )}
              </div>

              {aiTags.length === 0 && <div className="soft-empty">暂无 AI 标签建议</div>}

              {aiTags.length > 0 && (
                <div className="tag-list">
                  {aiTags.map((tagName) => {
                    const accepted = acceptedTagNames.has(tagName);

                    return (
                      <span
                        className={accepted ? "tag accepted" : "tag suggestion"}
                        key={tagName}
                      >
                        #{tagName}
                        {accepted ? (
                          <em>已接受</em>
                        ) : (
                          <button onClick={() => acceptAiTag(tagName)}>接受</button>
                        )}
                      </span>
                    );
                  })}
                </div>
              )}
            </section>

            {aiSuggestions?.raw_content && (
              <section className="panel-card">
                <details>
                  <summary>查看原始 AI 输出</summary>
                  <pre className="raw-ai-output">{aiSuggestions.raw_content}</pre>
                </details>
              </section>
            )}
          </div>
        )}

        {activeTab === "transcript" && (
          <div className="inspector-section-stack">
            <section className="panel-card">
              <div className="card-heading-row">
                <h3>Transcript</h3>

                {transcript && (
                  <div className="compact-actions">
                    <button onClick={() => exportTranscript("txt")}>TXT</button>
                    <button onClick={() => exportTranscript("json")}>JSON</button>
                    <button onClick={() => exportTranscript("srt")}>SRT</button>
                  </div>
                )}
              </div>

              {!transcript && (
                <div className="transcript-empty">
                  <p>暂无 transcript。</p>
                  <button className="primary-button" onClick={transcribe}>
                    开始转写
                  </button>
                </div>
              )}

              {transcript && (
                <div className="transcript-timeline">
                  {transcript.segments.length > 0 ? (
                    transcript.segments.map((seg) => (
                      <div key={seg.id} className="segment">
                        <button onClick={() => jumpToSegment(seg.start_seconds)}>
                          {formatDuration(seg.start_seconds)}
                        </button>
                        <span>{seg.text}</span>
                      </div>
                    ))
                  ) : (
                    <p>{transcript.transcript.full_text}</p>
                  )}
                </div>
              )}
            </section>
          </div>
        )}

        {activeTab === "file" && (
          <div className="inspector-section-stack">
            <section className="panel-card file-info-card">
              <h3>文件信息</h3>

              <dl>
                <dt>文件名</dt>
                <dd>{audio.file_name}</dd>

                <dt>路径</dt>
                <dd>{audio.file_path}</dd>

                <dt>格式</dt>
                <dd>{audio.file_ext || "-"}</dd>

                <dt>时长</dt>
                <dd>{formatDuration(audio.duration_seconds)}</dd>

                <dt>大小</dt>
                <dd>{audio.file_size ? `${Math.round(audio.file_size / 1024 / 1024)} MB` : "-"}</dd>

                <dt>修改时间</dt>
                <dd>{audio.file_mtime || "-"}</dd>

                <dt>Bitrate</dt>
                <dd>{audio.bitrate || "-"}</dd>

                <dt>Sample Rate</dt>
                <dd>{audio.sample_rate || "-"}</dd>

                <dt>Channels</dt>
                <dd>{audio.channels || "-"}</dd>

                <dt>播放位置</dt>
                <dd>{formatDuration(audio.last_position_seconds)}</dd>

                <dt>播放次数</dt>
                <dd>{audio.play_count}</dd>

                <dt>上次播放</dt>
                <dd>{audio.last_played_at || "-"}</dd>
              </dl>
            </section>

            <section className="panel-card">
              <h3>重新定位</h3>

              <div className="inline-form">
                <input
                  value={relocatePath}
                  onChange={(e) => setRelocatePath(e.target.value)}
                  placeholder="新的音频文件路径"
                />
                <button onClick={chooseRelocateFile}>选择</button>
              </div>

              <button className="section-button" onClick={relocate}>
                重新定位文件
              </button>
            </section>

            <section className="panel-card danger-zone">
              <h3>危险操作</h3>
              <p>这些操作会影响数据库记录或封面文件，请谨慎使用。</p>

              <div className="section-actions">
                <button onClick={deleteCover} disabled={!audio.cover_path}>
                  删除封面
                </button>

                <button className="danger-button" onClick={deleteFromDatabase}>
                  从数据库移除
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </aside>
  );
}


================================================================================
文件: frontend/src/components/PlayerBar.tsx
================================================================================
import { useEffect, useRef, useState } from "react";
import { API_BASE, api } from "../api";
import type { AudioItem } from "../types";
import { displayAuthor, displayTitle, formatDuration } from "../types";

type Props = {
  audio: AudioItem | null;
  queue: AudioItem[];
  queueIndex: number;
  canPrevious: boolean;
  canNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onQueueSelect: (index: number) => void;
  onQueueRemove: (index: number) => void;
  onQueueClear: () => void;
  onPositionSaved: (audioId: number, position: number) => void;
};

function shouldPromptRestart(audio: AudioItem): boolean {
  const saved = audio.last_position_seconds || 0;
  const total = audio.duration_seconds || 0;

  if (saved <= 0 || total <= 0) return false;
  if (saved >= total) return true;

  const remain = total - saved;
  const threshold = Math.max(10, total * 0.02);

  return remain <= threshold;
}

export default function PlayerBar({
  audio,
  queue,
  queueIndex,
  canPrevious,
  canNext,
  onPrevious,
  onNext,
  onQueueSelect,
  onQueueRemove,
  onQueueClear,
  onPositionSaved
}: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSavedRef = useRef<{ audioId: number; position: number } | null>(null);
  const endedAudioIdRef = useRef<number | null>(null);

  const [rate, setRate] = useState(Number(localStorage.getItem("playbackRate") || "1"));
  const [volume, setVolume] = useState(Number(localStorage.getItem("volume") || "1"));
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);

  async function savePositionFor(audioId: number, position: number) {
    if (!Number.isFinite(position)) return;

    const normalized = Math.max(0, position);
    const last = lastSavedRef.current;

    if (
      last &&
      last.audioId === audioId &&
      Math.abs(last.position - normalized) < 0.5
    ) {
      return;
    }

    lastSavedRef.current = {
      audioId,
      position: normalized
    };

    await api.updatePlaybackPosition(audioId, normalized);
    onPositionSaved(audioId, normalized);
  }

  function saveCurrentPosition(positionOverride?: number) {
    const el = audioRef.current;
    if (!el || !audio) return;

    const position = positionOverride ?? el.currentTime;
    void savePositionFor(audio.id, position).catch(console.error);
  }

  useEffect(() => {
    const el = audioRef.current;
    const currentAudio = audio;

    if (!el) return;

    if (!currentAudio) {
      el.pause();
      el.removeAttribute("src");
      el.load();
      setCurrent(0);
      setDuration(0);
      setIsPlaying(false);
      return;
    }

    endedAudioIdRef.current = null;

    let startSeconds = currentAudio.last_position_seconds || 0;

    if (shouldPromptRestart(currentAudio)) {
      const ok = window.confirm(
        "上次播放位置已接近结尾，是否从头播放？\n\n确定：从头播放\n取消：从上次位置继续"
      );

      if (ok) {
        startSeconds = 0;
        void savePositionFor(currentAudio.id, 0).catch(console.error);
      }
    }

    el.src = `${API_BASE}/audio-items/${currentAudio.id}/file`;
    el.playbackRate = rate;
    el.volume = volume;
    el.currentTime = startSeconds;

    setCurrent(startSeconds);
    setDuration(0);

    el.play()
      .then(() => setIsPlaying(true))
      .catch((err) => {
        console.error(err);
        setIsPlaying(false);
      });

    return () => {
      if (!currentAudio) return;
      if (endedAudioIdRef.current === currentAudio.id) return;

      const latestPosition = Number.isFinite(el.currentTime) ? el.currentTime : startSeconds;
      void savePositionFor(currentAudio.id, latestPosition).catch(console.error);
    };
  }, [audio?.id]);

  useEffect(() => {
    const el = audioRef.current;
    if (el) el.playbackRate = rate;

    localStorage.setItem("playbackRate", String(rate));
  }, [rate]);

  useEffect(() => {
    const el = audioRef.current;
    if (el) el.volume = volume;

    localStorage.setItem("volume", String(volume));
  }, [volume]);

  useEffect(() => {
    const timer = setInterval(() => {
      const el = audioRef.current;
      if (!el || !audio || el.paused) return;

      saveCurrentPosition(el.currentTime);
    }, 5000);

    return () => clearInterval(timer);
  }, [audio?.id]);

  function toggle() {
    const el = audioRef.current;
    if (!el) return;

    if (el.paused) {
      el.play().catch(console.error);
    } else {
      el.pause();
    }
  }

  function seek(value: number) {
    const el = audioRef.current;
    if (!el) return;

    el.currentTime = value;
    setCurrent(value);
  }

  function stopAndReset() {
    const el = audioRef.current;
    if (!el) return;

    el.pause();
    el.currentTime = 0;
    setCurrent(0);

    if (audio) {
      void savePositionFor(audio.id, 0).catch(console.error);
    }
  }

  async function handleEnded() {
    if (audio) {
      endedAudioIdRef.current = audio.id;
      await savePositionFor(audio.id, 0).catch(console.error);
    }

    setCurrent(0);

    if (canNext) {
      onNext();
    }
  }

  function selectQueueItem(index: number) {
    onQueueSelect(index);
    setQueueOpen(false);
  }

  const safeDuration = Number.isFinite(duration) ? duration : 0;
  const progress = safeDuration > 0 ? Math.min(100, (current / safeDuration) * 100) : 0;

  return (
    <footer className="player-dock">
      <audio
        ref={audioRef}
        onPlay={() => setIsPlaying(true)}
        onPause={(e) => {
          setIsPlaying(false);

          if (audio && endedAudioIdRef.current !== audio.id) {
            saveCurrentPosition(e.currentTarget.currentTime);
          }
        }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onEnded={handleEnded}
      />

      <div className="player-now-card">
        <div className="player-cover">
          {audio?.cover_path ? (
            <img
              src={api.coverUrl(audio.id, audio.updated_at)}
              alt=""
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : (
            <span>♪</span>
          )}
        </div>

        <div className="player-now-text">
          <span className="eyebrow">正在播放</span>
          <strong>{audio ? displayTitle(audio) : "选择一个音频开始播放"}</strong>
          <em>{audio ? displayAuthor(audio) || "Unknown" : "播放队列为空"}</em>
        </div>
      </div>

      <div className="player-center">
        <div className="player-controls">
          <button className="icon-button" onClick={onPrevious} disabled={!audio || !canPrevious}>
            ‹
          </button>

          <button className="play-toggle" onClick={toggle} disabled={!audio}>
            {isPlaying ? "暂停" : "播放"}
          </button>

          <button className="icon-button" onClick={onNext} disabled={!audio || !canNext}>
            ›
          </button>

          <button className="stop-button" onClick={stopAndReset} disabled={!audio}>
            停止
          </button>
        </div>

        <div className="player-progress">
          <span>{formatDuration(current)}</span>

          <input
            type="range"
            min={0}
            max={safeDuration || 0}
            value={Math.min(current, safeDuration || current || 0)}
            onChange={(e) => seek(Number(e.target.value))}
            style={{
              background: `linear-gradient(90deg, #38bdf8 0%, #8b5cf6 ${progress}%, rgba(51, 65, 85, 0.9) ${progress}%, rgba(51, 65, 85, 0.9) 100%)`
            }}
          />

          <span>{formatDuration(safeDuration)}</span>
        </div>
      </div>

      <div className="player-options">
        <label>
          <span>速度</span>
          <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
            {[0.75, 1, 1.25, 1.5, 2].map((r) => (
              <option key={r} value={r}>
                {r}x
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>音量</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
        </label>

        <div className="queue-control">
          <button
            className="queue-toggle-button"
            onClick={() => setQueueOpen((v) => !v)}
            disabled={queue.length === 0}
          >
            队列 {queue.length > 0 ? `${queueIndex + 1}/${queue.length}` : ""}
          </button>

          {queueOpen && (
            <div className="queue-popover">
              <div className="queue-popover-header">
                <strong>播放队列</strong>

                <button
                  onClick={() => {
                    onQueueClear();
                    setQueueOpen(false);
                  }}
                  disabled={queue.length === 0}
                >
                  清空
                </button>
              </div>

              {queue.length === 0 && <div className="queue-empty">空队列</div>}

              {queue.length > 0 && (
                <div className="queue-list">
                  {queue.map((item, index) => (
                    <div
                      key={`${item.id}-${index}`}
                      className={`queue-row ${index === queueIndex ? "active" : ""}`}
                    >
                      <button
                        className="queue-row-main"
                        onClick={() => selectQueueItem(index)}
                        title={displayTitle(item)}
                      >
                        <span className="queue-index">
                          {index === queueIndex ? "▶" : index + 1}
                        </span>

                        <span className="queue-title">{displayTitle(item)}</span>
                      </button>

                      <button
                        className="queue-remove"
                        onClick={() => onQueueRemove(index)}
                        title="从队列移除"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}


================================================================================
文件: frontend/src/components/SettingsPanel.tsx
================================================================================
import { useEffect, useRef, useState } from "react";
import { api, endpointPrivacyWarning } from "../api";
import type { LibraryRoot, ScanTask, Tag } from "../types";
import { pickAudioFolder } from "../tauri";
import TaskPanel from "./TaskPanel";

type ToastType = "info" | "success" | "error";
type SettingsTab = "library" | "asr" | "llm" | "tasks" | "maintenance" | "logs";

type Props = {
  refresh: () => void;
  notify?: (message: string, type?: ToastType) => void;
};

function scanProgress(task: ScanTask): number {
  if (!task.total_files) return 0;
  return Math.round((task.processed_files / task.total_files) * 100);
}

function terminalStatus(status: string): boolean {
  return status === "done" || status === "failed" || status === "canceled";
}

export default function SettingsPanel({ refresh, notify }: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("library");

  const [roots, setRoots] = useState<LibraryRoot[]>([]);
  const [scanTasks, setScanTasks] = useState<ScanTask[]>([]);
  const [path, setPath] = useState("");
  const [scanResult, setScanResult] = useState("");
  const [playlistName, setPlaylistName] = useState("");
  const [maintenanceTags, setMaintenanceTags] = useState<Tag[]>([]);

  const [asrModelName, setAsrModelName] = useState("small");
  const [asrDevice, setAsrDevice] = useState("cpu");
  const [asrComputeType, setAsrComputeType] = useState("int8");
  const [asrBeamSize, setAsrBeamSize] = useState("5");

  const [llmEndpoint, setLlmEndpoint] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmTimeout, setLlmTimeout] = useState("60");
  const [llmMaxTokens, setLlmMaxTokens] = useState("800");
  const [llmTemperature, setLlmTemperature] = useState("0.2");

  const [llmTestResult, setLlmTestResult] = useState("");
  const [backendStatus, setBackendStatus] = useState("checking");
  const [logs, setLogs] = useState("");

  const scanStatusRef = useRef<Record<number, string>>({});
  const scanInitializedRef = useRef(false);

  function applyScanTasks(rows: ScanTask[], allowNotify = true) {
    if (allowNotify && scanInitializedRef.current) {
      for (const task of rows) {
        const previous = scanStatusRef.current[task.id];

        if (previous && previous !== task.status && terminalStatus(task.status)) {
          if (task.status === "done") {
            notify?.(
              `扫描任务 #${task.id} 已完成，导入 ${task.imported}，更新 ${task.updated}，缺失 ${task.missing}`,
              "success"
            );
          }

          if (task.status === "failed") {
            notify?.(`扫描任务 #${task.id} 失败：${task.error_message || "未知错误"}`, "error");
          }

          if (task.status === "canceled") {
            notify?.(`扫描任务 #${task.id} 已取消`, "info");
          }
        }
      }
    }

    const nextStatus: Record<number, string> = {};
    for (const task of rows) {
      nextStatus[task.id] = task.status;
    }

    scanStatusRef.current = nextStatus;
    scanInitializedRef.current = true;
    setScanTasks(rows);
  }

  async function loadScanTasks() {
    const rows = await api.listScanTasks({ limit: 20 });
    applyScanTasks(rows, true);
  }

  async function loadLogs() {
    const result = await api.getLogs(400);
    setLogs(result.content || "");
  }

  async function loadTags() {
    const tagRows = await api.listTags().catch(() => []);
    setMaintenanceTags(tagRows);
  }

  async function load() {
    try {
      await api.health();
      setBackendStatus("ok");

      const [rootRows, settings, scanRows, tagRows] = await Promise.all([
        api.listLibraryRoots(),
        api.listSettings(),
        api.listScanTasks({ limit: 20 }),
        api.listTags().catch(() => [])
      ]);

      setRoots(rootRows);
      applyScanTasks(scanRows, false);
      setMaintenanceTags(tagRows);

      setAsrModelName(settings.find((s) => s.key === "asr.model_name")?.value || "small");
      setAsrDevice(settings.find((s) => s.key === "asr.device")?.value || "cpu");
      setAsrComputeType(settings.find((s) => s.key === "asr.compute_type")?.value || "int8");
      setAsrBeamSize(settings.find((s) => s.key === "asr.beam_size")?.value || "5");

      setLlmEndpoint(settings.find((s) => s.key === "llm.endpoint")?.value || "");
      setLlmModel(settings.find((s) => s.key === "llm.model_name")?.value || "");
      setLlmApiKey(settings.find((s) => s.key === "llm.api_key")?.value || "");
      setLlmTimeout(settings.find((s) => s.key === "llm.timeout")?.value || "60");
      setLlmMaxTokens(settings.find((s) => s.key === "llm.max_tokens")?.value || "800");
      setLlmTemperature(settings.find((s) => s.key === "llm.temperature")?.value || "0.2");
    } catch (err) {
      console.error(err);
      setBackendStatus("failed");
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  useEffect(() => {
    load().catch(console.error);
    loadLogs().catch(console.error);

    const timer = setInterval(() => {
      loadScanTasks().catch(console.error);
    }, 3000);

    return () => clearInterval(timer);
  }, []);

  async function chooseFolder() {
    const selected = await pickAudioFolder();

    if (selected) {
      setPath(selected);
    } else {
      notify?.("未选择文件夹，或当前不是 Tauri 运行环境。", "error");
    }
  }

  async function addRoot() {
    if (!path.trim()) return;

    try {
      await api.createLibraryRoot(path.trim());
      setPath("");

      await load();
      refresh();
      notify?.("媒体库目录已添加", "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function toggleRoot(root: LibraryRoot, isEnabled: boolean) {
    try {
      await api.updateLibraryRoot(root.id, {
        is_enabled: isEnabled
      });

      await load();
      refresh();
      notify?.(isEnabled ? "媒体库目录已启用" : "媒体库目录已禁用", "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function scan(id: number) {
    try {
      setScanResult("已创建扫描任务...");
      const task = await api.scanLibraryRoot(id);
      setScanResult(`扫描任务 #${task.id} 已创建`);
      notify?.(`扫描任务 #${task.id} 已创建`, "success");
      await loadScanTasks();
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function cancelScan(task: ScanTask) {
    if (!window.confirm(`确认取消扫描任务 #${task.id}？`)) return;

    try {
      await api.cancelScanTask(task.id);
      notify?.(`扫描任务 #${task.id} 已请求取消`, "info");
      await loadScanTasks();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function createPlaylist() {
    if (!playlistName.trim()) return;

    try {
      await api.createPlaylist(playlistName.trim());
      setPlaylistName("");

      refresh();
      await load();

      notify?.("Playlist 已创建", "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function saveAsr() {
    try {
      await api.setSetting("asr.model_name", asrModelName.trim() || "small");
      await api.setSetting("asr.device", asrDevice.trim() || "cpu");
      await api.setSetting("asr.compute_type", asrComputeType.trim() || "int8");
      await api.setSetting("asr.beam_size", asrBeamSize.trim() || "5");

      notify?.("ASR 设置已保存", "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function saveLlm() {
    const warning = endpointPrivacyWarning(llmEndpoint);
    if (warning) {
      const ok = window.confirm(`${warning}\n\n确认保存该 endpoint？`);
      if (!ok) return;
    }

    try {
      await api.setSetting("llm.endpoint", llmEndpoint.trim());
      await api.setSetting("llm.model_name", llmModel.trim());
      await api.setSetting("llm.api_key", llmApiKey);
      await api.setSetting("llm.timeout", llmTimeout.trim() || "60");
      await api.setSetting("llm.max_tokens", llmMaxTokens.trim() || "800");
      await api.setSetting("llm.temperature", llmTemperature.trim() || "0.2");

      notify?.("LLM 设置已保存", "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function testLlm() {
    const warning = endpointPrivacyWarning(llmEndpoint);
    if (warning) {
      const ok = window.confirm(`${warning}\n\n确认继续测试连接？`);
      if (!ok) return;
    }

    setLlmTestResult("测试中...");

    try {
      const result = await api.testLlm({
        endpoint: llmEndpoint.trim(),
        model_name: llmModel.trim(),
        api_key: llmApiKey || undefined,
        timeout: Number(llmTimeout || "60"),
        max_tokens: Number(llmMaxTokens || "64"),
        temperature: Number(llmTemperature || "0")
      });

      if (result.privacy_warning) {
        notify?.(result.privacy_warning, "error");
      }

      setLlmTestResult(`连接成功：${result.content}`);
      notify?.("LLM 连接测试成功", "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLlmTestResult(`连接失败：${message}`);
      notify?.(`LLM 连接测试失败：${message}`, "error");
    }
  }

  async function rebuildSearch() {
    const ok = window.confirm("确认重建所有音频的搜索索引？");
    if (!ok) return;

    try {
      const result = await api.rebuildSearchIndex();
      notify?.(`已重建 ${result.count} 条搜索索引`, "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function renameTag(tag: Tag) {
    const name = window.prompt("输入新的标签名称：", tag.name);
    if (!name || !name.trim() || name.trim() === tag.name) return;

    try {
      await api.updateTag(tag.id, { name: name.trim() });
      await loadTags();
      refresh();
      notify?.("标签已重命名", "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function deleteTag(tag: Tag) {
    const ok = window.confirm(
      `确认删除标签 #${tag.name}？\n\n如果该标签仍被音频使用，默认不会删除。`
    );

    if (!ok) return;

    try {
      await api.deleteTag(tag.id, false);
      await loadTags();
      refresh();
      notify?.("标签已删除", "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function cleanupTags() {
    const ok = window.confirm("确认清理所有没有关联音频的 orphan tags？");
    if (!ok) return;

    try {
      const result = await api.cleanupTags();
      await loadTags();
      refresh();
      notify?.(`已清理 ${result.deleted} 个未使用标签`, "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  const llmWarning = endpointPrivacyWarning(llmEndpoint);

  return (
    <section className="settings-panel">
      <header className="settings-header">
        <div>
          <span className="eyebrow">Control Center</span>
          <h2>设置中心</h2>
          <p>管理媒体库、ASR、LLM、任务、维护和日志。</p>
        </div>

        <div className={`backend-status ${backendStatus}`}>
          <span />
          {backendStatus === "checking" && "检查中"}
          {backendStatus === "ok" && "后端正常"}
          {backendStatus === "failed" && "后端未连接"}
        </div>
      </header>

      <div className="settings-tabs">
        <button className={activeTab === "library" ? "active" : ""} onClick={() => setActiveTab("library")}>
          媒体库
        </button>
        <button className={activeTab === "asr" ? "active" : ""} onClick={() => setActiveTab("asr")}>
          ASR
        </button>
        <button className={activeTab === "llm" ? "active" : ""} onClick={() => setActiveTab("llm")}>
          LLM
        </button>
        <button className={activeTab === "tasks" ? "active" : ""} onClick={() => setActiveTab("tasks")}>
          任务
        </button>
        <button
          className={activeTab === "maintenance" ? "active" : ""}
          onClick={() => setActiveTab("maintenance")}
        >
          维护
        </button>
        <button className={activeTab === "logs" ? "active" : ""} onClick={() => setActiveTab("logs")}>
          日志
        </button>
      </div>

      <div className="settings-content">
        {activeTab === "library" && (
          <div className="settings-grid-layout">
            <section className="panel-card">
              <h3>媒体库目录</h3>

              <div className="inline-form">
                <input
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="输入或选择本地目录路径"
                />
                <button onClick={chooseFolder}>选择文件夹</button>
                <button className="primary-button" onClick={addRoot}>
                  添加目录
                </button>
              </div>

              {roots.length === 0 && <p className="muted">暂无媒体库目录。</p>}

              {roots.map((root) => (
                <div key={root.id} className={`root-card ${root.is_enabled ? "" : "disabled"}`}>
                  <div>
                    <strong>{root.path}</strong>
                    <span>{root.is_enabled ? "启用中" : "已禁用"}</span>
                  </div>

                  <label className="root-toggle">
                    <input
                      type="checkbox"
                      checked={root.is_enabled}
                      onChange={(e) => toggleRoot(root, e.target.checked)}
                    />
                    {root.is_enabled ? "启用" : "禁用"}
                  </label>

                  <button onClick={() => scan(root.id)}>扫描</button>
                </div>
              ))}

              {scanResult && <p className="test-result">{scanResult}</p>}
            </section>

            <section className="panel-card">
              <h3>扫描任务</h3>

              {scanTasks.length === 0 && <p className="muted">暂无扫描任务</p>}

              {scanTasks.map((task) => (
                <div key={task.id} className="scan-task-row">
                  <div className="scan-task-top">
                    <strong>#{task.id}</strong>
                    <span>root: {task.root_id}</span>
                    <span className={`status-pill ${task.status}`}>{task.status}</span>
                  </div>

                  <div className="progress-line">
                    <div style={{ width: `${scanProgress(task)}%` }} />
                  </div>

                  <div className="scan-task-meta">
                    {task.processed_files}/{task.total_files} · imported {task.imported} · updated{" "}
                    {task.updated} · missing {task.missing}
                  </div>

                  {task.error_message && <div className="task-error">{task.error_message}</div>}

                  {(task.status === "pending" || task.status === "running") && (
                    <button onClick={() => cancelScan(task)}>取消</button>
                  )}
                </div>
              ))}
            </section>

            <section className="panel-card">
              <h3>创建 Playlist</h3>

              <div className="inline-form">
                <input
                  value={playlistName}
                  onChange={(e) => setPlaylistName(e.target.value)}
                  placeholder="Playlist 名称"
                />
                <button className="primary-button" onClick={createPlaylist}>
                  创建
                </button>
              </div>
            </section>
          </div>
        )}

        {activeTab === "asr" && (
          <section className="panel-card max-form-card">
            <h3>本地 ASR 设置 faster-whisper</h3>

            <div className="settings-form-grid">
              <label>
                Model Name / Path
                <input
                  value={asrModelName}
                  onChange={(e) => setAsrModelName(e.target.value)}
                  placeholder="small 或本地模型路径"
                />
              </label>

              <label>
                Device
                <select value={asrDevice} onChange={(e) => setAsrDevice(e.target.value)}>
                  <option value="cpu">cpu</option>
                  <option value="cuda">cuda</option>
                </select>
              </label>

              <label>
                Compute Type
                <input
                  value={asrComputeType}
                  onChange={(e) => setAsrComputeType(e.target.value)}
                  placeholder="int8 / float16 / float32"
                />
              </label>

              <label>
                Beam Size
                <input
                  value={asrBeamSize}
                  onChange={(e) => setAsrBeamSize(e.target.value)}
                  placeholder="5"
                />
              </label>
            </div>

            <button className="primary-button" onClick={saveAsr}>
              保存 ASR 设置
            </button>

            <p className="muted">
              需要后端环境安装 faster-whisper。若希望完全离线，请优先填写本地模型路径；
              如果填写 small / medium / large-v3 等模型名称，首次运行可能尝试下载模型。
            </p>
          </section>
        )}

        {activeTab === "llm" && (
          <section className="panel-card max-form-card">
            <h3>本地 LLM 设置</h3>

            <div className="settings-form-grid">
              <label>
                Endpoint
                <input
                  value={llmEndpoint}
                  onChange={(e) => setLlmEndpoint(e.target.value)}
                  placeholder="http://127.0.0.1:1234/v1"
                />
              </label>

              <label>
                Model Name
                <input
                  value={llmModel}
                  onChange={(e) => setLlmModel(e.target.value)}
                  placeholder="local-model"
                />
              </label>

              <label>
                API Key，可为空
                <input
                  value={llmApiKey}
                  onChange={(e) => setLlmApiKey(e.target.value)}
                  placeholder="可为空"
                />
              </label>

              <label>
                Timeout 秒
                <input
                  value={llmTimeout}
                  onChange={(e) => setLlmTimeout(e.target.value)}
                  placeholder="60"
                />
              </label>

              <label>
                Max Tokens
                <input
                  value={llmMaxTokens}
                  onChange={(e) => setLlmMaxTokens(e.target.value)}
                  placeholder="800"
                />
              </label>

              <label>
                Temperature
                <input
                  value={llmTemperature}
                  onChange={(e) => setLlmTemperature(e.target.value)}
                  placeholder="0.2"
                />
              </label>
            </div>

            {llmWarning && <p className="privacy-warning">隐私提醒：{llmWarning}</p>}

            <div className="section-actions">
              <button className="primary-button" onClick={saveLlm}>
                保存 LLM 设置
              </button>
              <button onClick={testLlm}>测试连接</button>
            </div>

            {llmTestResult && <p className="test-result">{llmTestResult}</p>}
          </section>
        )}

        {activeTab === "tasks" && (
          <section className="panel-card">
            <TaskPanel onTaskChanged={refresh} notify={notify} />
          </section>
        )}

        {activeTab === "maintenance" && (
          <div className="settings-grid-layout">
            <section className="panel-card">
              <h3>导出与索引</h3>

              <div className="section-actions">
                <button onClick={() => window.open(api.metadataExportUrl("json"), "_blank")}>
                  导出 Metadata JSON
                </button>

                <button onClick={() => window.open(api.metadataExportUrl("csv"), "_blank")}>
                  导出 Metadata CSV
                </button>

                <button onClick={rebuildSearch}>重建搜索索引</button>
              </div>
            </section>

            <section className="panel-card">
              <h3>标签维护</h3>

              <p className="muted">可重命名标签，或清理没有关联任何音频的 orphan tags。</p>

              <div className="section-actions">
                <button onClick={cleanupTags}>清理未使用标签</button>
                <button onClick={loadTags}>刷新标签</button>
              </div>

              {maintenanceTags.length === 0 && <p className="muted">暂无标签</p>}

              <div className="tag-list">
                {maintenanceTags.map((tag) => (
                  <span key={tag.id} className="tag">
                    #{tag.name}
                    <button onClick={() => renameTag(tag)}>重命名</button>
                    <button onClick={() => deleteTag(tag)}>删除</button>
                  </span>
                ))}
              </div>
            </section>
          </div>
        )}

        {activeTab === "logs" && (
          <section className="panel-card">
            <h3>日志</h3>

            <div className="section-actions">
              <button onClick={loadLogs}>刷新日志</button>
              <button onClick={() => window.open(api.logsFileUrl(), "_blank")}>下载日志文件</button>
              <button onClick={load}>重新检查后端</button>
            </div>

            <pre className="log-viewer">{logs || "暂无日志"}</pre>
          </section>
        )}
      </div>
    </section>
  );
}


================================================================================
文件: frontend/src/components/Sidebar.tsx
================================================================================
import type { Playlist, Tag } from "../types";

type ViewMode =
  | "library"
  | "favorites"
  | "playlist"
  | "settings"
  | "missingDescription"
  | "transcribed"
  | "missing"
  | "aiFailed";

type Props = {
  view: ViewMode;
  setView: (v: ViewMode) => void;
  tags: Tag[];
  selectedTag?: string;
  setSelectedTag: (tag?: string) => void;
  playlists: Playlist[];
  selectedPlaylistId: number | null;
  setSelectedPlaylistId: (id: number | null) => void;
  refresh: () => void;
};

export default function Sidebar(props: Props) {
  function openView(view: ViewMode) {
    props.setView(view);
    props.setSelectedPlaylistId(null);

    if (view !== "library") {
      props.setSelectedTag(undefined);
    }
  }

  function navClass(active: boolean) {
    return active ? "nav-card active" : "nav-card";
  }

  function pillClass(active: boolean) {
    return active ? "sidebar-pill active" : "sidebar-pill";
  }

  const allAudioActive = props.view === "library" && !props.selectedTag;
  const favoriteActive = props.view === "favorites";
  const settingsActive = props.view === "settings";

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-orb">♪</div>

        <div className="brand-copy">
          <h2>Local Audio</h2>
          <p>私人音频知识库</p>
        </div>
      </div>

      <nav className="sidebar-nav">
        <button
          className={navClass(allAudioActive)}
          onClick={() => {
            props.setView("library");
            props.setSelectedTag(undefined);
            props.setSelectedPlaylistId(null);
          }}
        >
          <span className="nav-symbol">⌂</span>
          <span>
            <strong>资料库</strong>
            <em>全部音频</em>
          </span>
        </button>

        <button
          className={navClass(favoriteActive)}
          onClick={() => openView("favorites")}
        >
          <span className="nav-symbol">★</span>
          <span>
            <strong>收藏</strong>
            <em>常听内容</em>
          </span>
        </button>

        <button
          className={navClass(props.view === "missingDescription")}
          onClick={() => openView("missingDescription")}
        >
          <span className="nav-symbol">✎</span>
          <span>
            <strong>缺少描述</strong>
            <em>需要整理</em>
          </span>
        </button>

        <button
          className={navClass(props.view === "transcribed")}
          onClick={() => openView("transcribed")}
        >
          <span className="nav-symbol">¶</span>
          <span>
            <strong>已转写</strong>
            <em>可全文检索</em>
          </span>
        </button>

        <button
          className={navClass(props.view === "missing")}
          onClick={() => openView("missing")}
        >
          <span className="nav-symbol">!</span>
          <span>
            <strong>文件缺失</strong>
            <em>需要重新定位</em>
          </span>
        </button>

        <button
          className={navClass(props.view === "aiFailed")}
          onClick={() => openView("aiFailed")}
        >
          <span className="nav-symbol">⚡</span>
          <span>
            <strong>AI 失败</strong>
            <em>重试分析</em>
          </span>
        </button>
      </nav>

      <div className="sidebar-section">
        <div className="sidebar-section-heading">
          <h3>播放列表</h3>
          <span>{props.playlists.length}</span>
        </div>

        {props.playlists.length === 0 && (
          <div className="sidebar-empty">
            暂无播放列表
            <br />
            可在设置中创建
          </div>
        )}

        <div className="sidebar-scroll-area">
          {props.playlists.map((playlist) => (
            <button
              key={playlist.id}
              className={
                props.view === "playlist" && props.selectedPlaylistId === playlist.id
                  ? "playlist-row active"
                  : "playlist-row"
              }
              title={playlist.description || playlist.name}
              onClick={() => {
                props.setView("playlist");
                props.setSelectedTag(undefined);
                props.setSelectedPlaylistId(playlist.id);
              }}
            >
              <span>▸</span>
              <strong>{playlist.name}</strong>
            </button>
          ))}
        </div>
      </div>

      <div className="sidebar-section tag-section">
        <div className="sidebar-section-heading">
          <h3>标签</h3>
          <span>{props.tags.length}</span>
        </div>

        <div className="tag-cloud-nav">
          <button
            className={pillClass(allAudioActive)}
            onClick={() => {
              props.setView("library");
              props.setSelectedTag(undefined);
              props.setSelectedPlaylistId(null);
            }}
          >
            全部标签
          </button>

          {props.tags.map((tag) => (
            <button
              key={tag.id}
              className={pillClass(props.selectedTag === tag.name)}
              onClick={() => {
                props.setView("library");
                props.setSelectedPlaylistId(null);
                props.setSelectedTag(tag.name);
              }}
              title={`查看标签：${tag.name}`}
            >
              #{tag.name}
            </button>
          ))}
        </div>
      </div>

      <div className="sidebar-footer">
        <button
          className={settingsActive ? "settings-nav active" : "settings-nav"}
          onClick={() => {
            props.setView("settings");
            props.setSelectedPlaylistId(null);
          }}
        >
          <span>⚙</span>
          <strong>设置中心</strong>
        </button>

        <div className="privacy-card">
          <strong>本地优先</strong>
          <span>音频文件保留在本机。只有你配置 AI endpoint 后，分析任务才会发送 metadata 与 transcript。</span>
        </div>
      </div>
    </aside>
  );
}


================================================================================
文件: frontend/src/components/TaskPanel.tsx
================================================================================
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { AITask } from "../types";

type ToastType = "info" | "success" | "error";

type Props = {
  onTaskChanged?: () => void;
  notify?: (message: string, type?: ToastType) => void;
};

function formatTime(value?: string): string {
  if (!value) return "-";

  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function statusClass(status: string): string {
  if (status === "done") return "done";
  if (status === "failed") return "failed";
  if (status === "running") return "running";
  if (status === "pending") return "pending";
  if (status === "canceled") return "canceled";
  return "";
}

function terminalStatus(status: string): boolean {
  return status === "done" || status === "failed" || status === "canceled";
}

export default function TaskPanel({ onTaskChanged, notify }: Props) {
  const [tasks, setTasks] = useState<AITask[]>([]);
  const [loading, setLoading] = useState(false);

  const taskStatusRef = useRef<Record<number, string>>({});
  const initializedRef = useRef(false);

  function applyTasks(rows: AITask[]) {
    if (initializedRef.current) {
      for (const task of rows) {
        const previous = taskStatusRef.current[task.id];

        if (previous && previous !== task.status && terminalStatus(task.status)) {
          if (task.status === "done") {
            notify?.(`任务 #${task.id} 已完成：${task.task_type}`, "success");
          }

          if (task.status === "failed") {
            notify?.(`任务 #${task.id} 失败：${task.error_message || task.task_type}`, "error");
          }

          if (task.status === "canceled") {
            notify?.(`任务 #${task.id} 已取消`, "info");
          }
        }
      }
    }

    const nextStatus: Record<number, string> = {};
    for (const task of rows) {
      nextStatus[task.id] = task.status;
    }

    taskStatusRef.current = nextStatus;
    initializedRef.current = true;
    setTasks(rows);
  }

  async function load() {
    setLoading(true);
    try {
      const rows = await api.listTasks();
      applyTasks(rows);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch((err) => {
      console.error(err);
      notify?.(err instanceof Error ? err.message : String(err), "error");
    });

    const timer = setInterval(() => {
      load().catch((err) => {
        console.error(err);
      });
    }, 3000);

    return () => clearInterval(timer);
  }, []);

  async function retry(task: AITask) {
    try {
      await api.retryTask(task.id);
      notify?.(`任务 #${task.id} 已重新加入队列`, "success");
      await load();
      onTaskChanged?.();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function cancel(task: AITask) {
    const ok = window.confirm(
      task.status === "running"
        ? "running 任务无法立即中断底层模型调用，但会在当前处理阶段结束后标记取消。确认取消？"
        : "确认取消该任务？"
    );

    if (!ok) return;

    try {
      await api.cancelTask(task.id);
      notify?.(`任务 #${task.id} 已请求取消`, "info");
      await load();
      onTaskChanged?.();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  return (
    <div className="task-panel">
      <div className="task-panel-header">
        <h3>AI / ASR 任务队列</h3>
        <button onClick={load}>{loading ? "刷新中..." : "刷新"}</button>
      </div>

      {tasks.length === 0 && <p className="muted">暂无任务</p>}

      {tasks.length > 0 && (
        <div className="task-table-wrap">
          <table className="task-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>音频</th>
                <th>类型</th>
                <th>状态</th>
                <th>重试</th>
                <th>创建时间</th>
                <th>更新时间</th>
                <th>错误</th>
                <th>操作</th>
              </tr>
            </thead>

            <tbody>
              {tasks.map((task) => (
                <tr key={task.id}>
                  <td>{task.id}</td>
                  <td>{task.audio_id}</td>
                  <td>{task.task_type}</td>
                  <td>
                    <span className={`status-pill ${statusClass(task.status)}`}>
                      {task.status}
                    </span>
                  </td>
                  <td>{task.retry_count}</td>
                  <td>{formatTime(task.created_at)}</td>
                  <td>{formatTime(task.updated_at)}</td>
                  <td className="task-error" title={task.error_message || ""}>
                    {task.error_message || "-"}
                  </td>
                  <td>
                    <div className="task-actions">
                      {(task.status === "failed" || task.status === "canceled") && (
                        <button onClick={() => retry(task)}>重试</button>
                      )}

                      {(task.status === "pending" || task.status === "running") && (
                        <button onClick={() => cancel(task)}>取消</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


================================================================================
文件: frontend/src/components/TopBar.tsx
================================================================================
type TranscriptFilter = "all" | "yes" | "no";
type MissingFilter = "all" | "available" | "missing";

type Props = {
  title: string;
  subtitle?: string;
  totalCount: number;
  q: string;
  setQ: (value: string) => void;
  isLoading?: boolean;

  hasActiveFilter: boolean;
  onClearFilters: () => void;

  missingDescriptionOnly: boolean;
  setMissingDescriptionOnly: (value: boolean) => void;

  hasTranscriptFilter: TranscriptFilter;
  setHasTranscriptFilter: (value: TranscriptFilter) => void;

  missingFilter: MissingFilter;
  setMissingFilter: (value: MissingFilter) => void;

  onBatchTranscribe: () => void;
  onBatchAnalyze: () => void;
  onOpenSettings: () => void;
};

export default function TopBar({
  title,
  subtitle,
  totalCount,
  q,
  setQ,
  isLoading = false,
  hasActiveFilter,
  onClearFilters,
  missingDescriptionOnly,
  setMissingDescriptionOnly,
  hasTranscriptFilter,
  setHasTranscriptFilter,
  missingFilter,
  setMissingFilter,
  onBatchTranscribe,
  onBatchAnalyze,
  onOpenSettings
}: Props) {
  return (
    <header className="top-command-bar">
      <div className="top-title-block">
        <div>
          <span className="eyebrow">Local Audio Studio</span>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>

        <div className="top-count-card">
          <strong>{isLoading ? "同步中" : totalCount}</strong>
          <span>{isLoading ? "正在更新结果" : "个音频"}</span>
        </div>
      </div>

      <div className="top-action-row">
        <div className="global-search">
          <span className="global-search-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path
                d="M10.5 4.75a5.75 5.75 0 1 0 0 11.5 5.75 5.75 0 0 0 0-11.5ZM3.25 10.5a7.25 7.25 0 1 1 12.78 4.67l4.15 4.15a.75.75 0 1 1-1.06 1.06l-4.15-4.15A7.25 7.25 0 0 1 3.25 10.5Z"
                fill="currentColor"
              />
            </svg>
          </span>

          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索标题、作者、标签、描述或 transcript"
          />

          {q.trim() && (
            <button className="search-clear-button" onClick={() => setQ("")}>
              ×
            </button>
          )}
        </div>

        <div className="filter-group">
          <label className={missingDescriptionOnly ? "filter-chip active" : "filter-chip"}>
            <input
              type="checkbox"
              checked={missingDescriptionOnly}
              onChange={(e) => setMissingDescriptionOnly(e.target.checked)}
            />
            缺描述
          </label>

          <select
            value={hasTranscriptFilter}
            onChange={(e) => setHasTranscriptFilter(e.target.value as TranscriptFilter)}
            title="按 transcript 状态筛选"
          >
            <option value="all">全部转写</option>
            <option value="yes">已有 transcript</option>
            <option value="no">未完成 transcript</option>
          </select>

          <select
            value={missingFilter}
            onChange={(e) => setMissingFilter(e.target.value as MissingFilter)}
            title="按文件状态筛选"
          >
            <option value="all">全部文件</option>
            <option value="available">仅可播放</option>
            <option value="missing">仅缺失</option>
          </select>
        </div>

        <div className="top-buttons">
          {hasActiveFilter && (
            <button className="ghost-button" onClick={onClearFilters}>
              清空
            </button>
          )}

          <button className="ghost-button" onClick={onBatchTranscribe} disabled={totalCount === 0}>
            批量转写
          </button>

          <button
            className="primary-button"
            onClick={onBatchAnalyze}
            disabled={totalCount === 0}
          >
            批量 AI
          </button>

          <button className="icon-soft-button" onClick={onOpenSettings} title="设置">
            ⚙
          </button>
        </div>
      </div>
    </header>
  );
}


================================================================================
文件: frontend/src/globals.d.ts
================================================================================
﻿/// <reference types="vite/client" />

declare module "*.css" {}


================================================================================
文件: frontend/src/main.tsx
================================================================================
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);


================================================================================
文件: frontend/src/styles.css
================================================================================
:root {
  --bg: #080b12;
  --bg-2: #0b1020;
  --surface: rgba(16, 22, 36, 0.92);
  --surface-2: rgba(21, 29, 46, 0.92);
  --surface-3: rgba(27, 37, 56, 0.9);
  --surface-soft: rgba(15, 23, 42, 0.62);

  --border: rgba(148, 163, 184, 0.16);
  --border-strong: rgba(148, 163, 184, 0.28);

  --text: #e5e7eb;
  --text-strong: #ffffff;
  --text-soft: #cbd5e1;
  --text-muted: #94a3b8;
  --text-faint: #64748b;

  --primary: #38bdf8;
  --primary-strong: #0ea5e9;
  --accent: #8b5cf6;

  --success: #22c55e;
  --warning: #f59e0b;
  --danger: #ef4444;

  --success-soft: rgba(34, 197, 94, 0.14);
  --warning-soft: rgba(245, 158, 11, 0.14);
  --danger-soft: rgba(239, 68, 68, 0.14);
  --primary-soft: rgba(56, 189, 248, 0.14);
  --accent-soft: rgba(139, 92, 246, 0.14);

  --radius-xs: 8px;
  --radius-sm: 10px;
  --radius-md: 14px;
  --radius-lg: 18px;
  --radius-xl: 24px;

  --player-height: 92px;
  --transition: 160ms ease;
}

* {
  box-sizing: border-box;
}

html,
body,
#root {
  height: 100%;
}

body {
  margin: 0;
  overflow: hidden;
  color: var(--text);
  font-family:
    Inter,
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    "PingFang SC",
    "Microsoft YaHei",
    sans-serif;
  background:
    radial-gradient(circle at 14% 6%, rgba(56, 189, 248, 0.18), transparent 30rem),
    radial-gradient(circle at 84% 12%, rgba(139, 92, 246, 0.2), transparent 34rem),
    radial-gradient(circle at 90% 90%, rgba(34, 197, 94, 0.08), transparent 28rem),
    linear-gradient(135deg, #070a11, #090d18 44%, #0b1020);
}

body::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(rgba(255, 255, 255, 0.018) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.014) 1px, transparent 1px);
  background-size: 42px 42px;
  mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.65), transparent 75%);
}

button,
input,
textarea,
select {
  font: inherit;
}

button {
  cursor: pointer;
  border: 1px solid var(--border);
  color: var(--text);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.018)),
    rgba(30, 41, 59, 0.78);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  line-height: 1.3;
  transition:
    transform var(--transition),
    background var(--transition),
    border-color var(--transition),
    box-shadow var(--transition),
    opacity var(--transition);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.06) inset;
}

button:hover {
  transform: translateY(-1px);
  border-color: var(--border-strong);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.025)),
    rgba(51, 65, 85, 0.9);
}

button:active {
  transform: translateY(0);
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
  transform: none;
}

.primary-button {
  border-color: rgba(125, 211, 252, 0.42);
  color: white;
  background:
    radial-gradient(circle at 24% 13%, rgba(255, 255, 255, 0.28), transparent 24px),
    linear-gradient(135deg, var(--primary-strong), var(--accent));
  box-shadow:
    0 16px 36px rgba(14, 165, 233, 0.22),
    0 1px 0 rgba(255, 255, 255, 0.18) inset;
}

.ghost-button {
  color: var(--text-soft);
  background: rgba(15, 23, 42, 0.52);
}

.icon-soft-button {
  min-width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  padding: 0;
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.62);
}

.danger-button {
  color: #fecaca;
  border-color: rgba(239, 68, 68, 0.35);
  background: rgba(127, 29, 29, 0.35);
}

input,
textarea,
select {
  width: 100%;
  border: 1px solid var(--border);
  color: var(--text);
  background: rgba(2, 6, 23, 0.48);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  transition:
    border-color var(--transition),
    background var(--transition),
    box-shadow var(--transition);
}

input::placeholder,
textarea::placeholder {
  color: var(--text-faint);
}

input:hover,
textarea:hover,
select:hover {
  border-color: var(--border-strong);
}

input:focus,
textarea:focus,
select:focus {
  outline: none;
  border-color: rgba(56, 189, 248, 0.72);
  background: rgba(2, 6, 23, 0.66);
  box-shadow: 0 0 0 4px rgba(56, 189, 248, 0.13);
}

textarea {
  min-height: 116px;
  resize: vertical;
}

select {
  cursor: pointer;
}

input[type="checkbox"] {
  width: auto;
  accent-color: var(--primary);
}

input[type="range"] {
  height: 6px;
  padding: 0;
  border: none;
  border-radius: 999px;
  accent-color: var(--primary);
  cursor: pointer;
}

mark {
  padding: 0 2px;
  color: #0f172a;
  background: #fde68a;
  border-radius: 4px;
}

a {
  color: #7dd3fc;
}

* {
  scrollbar-width: thin;
  scrollbar-color: rgba(100, 116, 139, 0.72) transparent;
}

::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 999px;
  background: rgba(100, 116, 139, 0.58);
  background-clip: content-box;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(148, 163, 184, 0.76);
  background-clip: content-box;
}

.app-shell {
  height: 100vh;
  min-width: 1000px;
  display: flex;
  flex-direction: column;
}

.main-shell {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 248px minmax(0, 1fr) minmax(360px, 420px);
  gap: 14px;
  padding: 14px 14px 10px;
}

.main-shell.settings-mode {
  grid-template-columns: 248px minmax(0, 1fr);
}

.workspace {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.settings-workspace {
  overflow: hidden;
}

.eyebrow {
  display: block;
  margin-bottom: 4px;
  color: var(--text-faint);
  font-size: 11px;
  font-weight: 760;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}

.muted {
  color: var(--text-muted);
  font-size: 13px;
}

/* Sidebar */

.sidebar {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.052), rgba(255, 255, 255, 0.012)),
    var(--surface);
  box-shadow:
    0 24px 80px rgba(0, 0, 0, 0.28),
    0 1px 0 rgba(255, 255, 255, 0.04) inset;
  backdrop-filter: blur(22px);
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 4px 14px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
}

.brand-orb {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  color: white;
  font-size: 24px;
  border-radius: 16px;
  background:
    radial-gradient(circle at 26% 18%, rgba(255, 255, 255, 0.42), transparent 20px),
    linear-gradient(135deg, var(--primary), var(--accent));
  box-shadow:
    0 18px 40px rgba(14, 165, 233, 0.22),
    0 1px 0 rgba(255, 255, 255, 0.24) inset;
}

.brand-copy h2 {
  margin: 0;
  color: var(--text-strong);
  font-size: 19px;
  letter-spacing: -0.03em;
}

.brand-copy p {
  margin: 3px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}

.sidebar-nav {
  display: grid;
  gap: 7px;
}

.nav-card {
  width: 100%;
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  padding: 10px;
  text-align: left;
  border-radius: 16px;
  background: transparent;
  box-shadow: none;
}

.nav-card:hover {
  background: rgba(30, 41, 59, 0.64);
}

.nav-card.active {
  border-color: rgba(125, 211, 252, 0.4);
  background:
    linear-gradient(135deg, rgba(14, 165, 233, 0.22), rgba(139, 92, 246, 0.16)),
    rgba(30, 41, 59, 0.82);
  box-shadow: 0 16px 34px rgba(2, 6, 23, 0.22);
}

.nav-symbol {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  color: #dbeafe;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 13px;
  background: rgba(15, 23, 42, 0.72);
}

.nav-card strong {
  display: block;
  color: var(--text-strong);
  font-size: 14px;
}

.nav-card em {
  display: block;
  margin-top: 2px;
  color: var(--text-muted);
  font-size: 12px;
  font-style: normal;
}

.sidebar-section {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tag-section {
  flex: 1;
  min-height: 120px;
}

.sidebar-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sidebar-section-heading h3 {
  margin: 0;
  color: var(--text-soft);
  font-size: 13px;
}

.sidebar-section-heading span {
  min-height: 22px;
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  color: var(--text-muted);
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.58);
}

.sidebar-empty {
  padding: 14px;
  color: var(--text-muted);
  text-align: center;
  font-size: 13px;
  line-height: 1.6;
  border: 1px dashed var(--border);
  border-radius: 16px;
  background: rgba(2, 6, 23, 0.22);
}

.sidebar-scroll-area,
.tag-cloud-nav {
  overflow: auto;
  display: grid;
  gap: 7px;
}

.playlist-row,
.sidebar-pill {
  width: 100%;
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  text-align: left;
  border-radius: 999px;
  color: var(--text-soft);
  background: rgba(15, 23, 42, 0.34);
  box-shadow: none;
}

.playlist-row strong {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 13px;
}

.playlist-row.active,
.sidebar-pill.active {
  color: white;
  border-color: rgba(125, 211, 252, 0.4);
  background: linear-gradient(135deg, rgba(14, 165, 233, 0.42), rgba(139, 92, 246, 0.28));
}

.sidebar-footer {
  display: grid;
  gap: 10px;
}

.settings-nav {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 12px;
  border-radius: 16px;
}

.settings-nav.active {
  color: white;
  border-color: rgba(125, 211, 252, 0.42);
  background: linear-gradient(135deg, rgba(14, 165, 233, 0.32), rgba(139, 92, 246, 0.2));
}

.privacy-card {
  padding: 13px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.55;
  border: 1px solid rgba(56, 189, 248, 0.18);
  border-radius: 16px;
  background:
    linear-gradient(135deg, rgba(56, 189, 248, 0.09), rgba(139, 92, 246, 0.06)),
    rgba(2, 6, 23, 0.24);
}

.privacy-card strong {
  display: block;
  margin-bottom: 5px;
  color: #dbeafe;
}

/* Top bar */

.top-command-bar {
  flex: 0 0 auto;
  display: grid;
  gap: 14px;
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background:
    radial-gradient(circle at 12% 0%, rgba(56, 189, 248, 0.13), transparent 24rem),
    linear-gradient(180deg, rgba(255, 255, 255, 0.056), rgba(255, 255, 255, 0.014)),
    var(--surface);
  box-shadow:
    0 24px 70px rgba(0, 0, 0, 0.24),
    0 1px 0 rgba(255, 255, 255, 0.04) inset;
  backdrop-filter: blur(22px);
}

.top-title-block {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}

.top-title-block h1 {
  margin: 0;
  color: var(--text-strong);
  font-size: 28px;
  line-height: 1.1;
  letter-spacing: -0.045em;
}

.top-title-block p {
  margin: 6px 0 0;
  color: var(--text-muted);
  font-size: 13px;
}

.top-count-card {
  min-width: 88px;
  padding: 10px 12px;
  text-align: right;
  border: 1px solid rgba(125, 211, 252, 0.2);
  border-radius: 16px;
  background:
    linear-gradient(135deg, rgba(56, 189, 248, 0.11), rgba(139, 92, 246, 0.08)),
    rgba(2, 6, 23, 0.26);
}

.top-count-card strong {
  display: block;
  color: white;
  font-size: 20px;
}

.top-count-card span {
  color: var(--text-muted);
  font-size: 12px;
}

.top-action-row {
  display: grid;
  grid-template-columns: minmax(250px, 1fr) auto auto;
  gap: 10px;
  align-items: center;
}

.global-search {
  position: relative;
  min-width: 0;
  display: flex;
  align-items: center;
}

.global-search > .global-search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-faint);
  transform: translateY(-50%);
  pointer-events: none;
  line-height: 0;
  margin: 0;
  z-index: 1;
}

.global-search > .global-search-icon svg {
  display: block;
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
}

.global-search input {
  width: 100%;
  height: 42px;
  padding-left: 38px;
  padding-right: 42px;
}

.search-clear-button {
  position: absolute;
  right: 6px;
  top: 50%;
  width: 30px;
  height: 30px;
  padding: 0;
  border-radius: 999px;
  transform: translateY(-50%);
  line-height: 1;
}

.search-clear-button:hover {
  transform: translateY(-50%);
}

.filter-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.filter-group select {
  width: auto;
  min-width: 132px;
  height: 42px;
}

.filter-chip {
  height: 42px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0 12px;
  color: var(--text-soft);
  font-size: 13px;
  white-space: nowrap;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: rgba(2, 6, 23, 0.3);
}

.filter-chip.active {
  color: #dbeafe;
  border-color: rgba(125, 211, 252, 0.36);
  background: rgba(56, 189, 248, 0.12);
}

.top-buttons {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Audio list */

.audio-list-panel {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.012)),
    rgba(15, 23, 42, 0.72);
  backdrop-filter: blur(22px);
}

.audio-scroll-list {
  height: 100%;
  overflow: auto;
  padding: 9px;
}

.audio-row {
  display: grid;
  grid-template-columns: 62px minmax(0, 1fr) auto;
  gap: 13px;
  align-items: center;
  padding: 13px;
  border: 1px solid transparent;
  border-radius: 20px;
  transition:
    background var(--transition),
    border-color var(--transition),
    box-shadow var(--transition),
    transform var(--transition),
    opacity var(--transition);
}

.audio-row + .audio-row {
  margin-top: 5px;
}

.audio-row:hover {
  transform: translateY(-1px);
  border-color: rgba(125, 211, 252, 0.18);
  background:
    linear-gradient(90deg, rgba(56, 189, 248, 0.08), rgba(139, 92, 246, 0.055)),
    rgba(30, 41, 59, 0.5);
}

.audio-row.selected {
  border-color: rgba(125, 211, 252, 0.42);
  background:
    radial-gradient(circle at 0% 0%, rgba(56, 189, 248, 0.18), transparent 18rem),
    linear-gradient(90deg, rgba(56, 189, 248, 0.16), rgba(139, 92, 246, 0.09)),
    rgba(30, 41, 59, 0.78);
  box-shadow: 0 18px 42px rgba(2, 6, 23, 0.22);
}

.cover-thumb {
  width: 56px;
  height: 56px;
  position: relative;
  display: grid;
  place-items: center;
  overflow: hidden;
  flex: 0 0 auto;
  color: #dbeafe;
  font-size: 24px;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background:
    radial-gradient(circle at 30% 20%, rgba(255, 255, 255, 0.18), transparent 24px),
    linear-gradient(135deg, rgba(56, 189, 248, 0.42), rgba(139, 92, 246, 0.3)),
    rgba(51, 65, 85, 0.8);
  box-shadow:
    0 12px 25px rgba(2, 6, 23, 0.28),
    0 1px 0 rgba(255, 255, 255, 0.12) inset;
}

.cover-thumb.missing {
  filter: grayscale(0.8);
  opacity: 0.68;
}

.cover-thumb img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.audio-info {
  min-width: 0;
}

.title-line {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.title {
  min-width: 0;
  color: #f8fafc;
  font-size: 15px;
  font-weight: 760;
  letter-spacing: -0.015em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.badge,
.drag-hint {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 760;
}

.badge.danger {
  color: #fecaca;
  border: 1px solid rgba(248, 113, 113, 0.28);
  background: var(--danger-soft);
}

.drag-hint {
  color: var(--text-muted);
  border: 1px solid var(--border);
  background: rgba(100, 116, 139, 0.12);
}

.meta-line {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 5px;
  color: var(--text-muted);
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.meta-dot {
  color: var(--text-faint);
}

.description-line {
  margin-top: 6px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-tags,
.row-status {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 7px;
}

.mini-tag {
  display: inline-flex;
  align-items: center;
  min-height: 23px;
  padding: 2px 8px;
  color: #cbd5e1;
  font-size: 12px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 999px;
  background: rgba(100, 116, 139, 0.12);
}

.muted-tag {
  color: var(--text-muted);
}

.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
  opacity: 0.1;
  transition: opacity var(--transition);
}

.audio-row:hover .row-actions,
.audio-row.selected .row-actions {
  opacity: 1;
}

.row-play-button {
  white-space: nowrap;
  color: #dbeafe;
  border-color: rgba(56, 189, 248, 0.28);
  background: rgba(56, 189, 248, 0.12);
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 24px;
  padding: 2px 8px;
  color: var(--text);
  font-size: 12px;
  font-weight: 720;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(100, 116, 139, 0.14);
}

.status-pill span {
  opacity: 0.72;
  font-weight: 650;
}

.status-pill.none {
  color: #cbd5e1;
  background: rgba(100, 116, 139, 0.12);
}

.status-pill.pending {
  color: #fde68a;
  border-color: rgba(245, 158, 11, 0.28);
  background: var(--warning-soft);
}

.status-pill.running {
  color: #bfdbfe;
  border-color: rgba(56, 189, 248, 0.3);
  background: var(--primary-soft);
}

.status-pill.done {
  color: #bbf7d0;
  border-color: rgba(34, 197, 94, 0.3);
  background: var(--success-soft);
}

.status-pill.failed {
  color: #fecaca;
  border-color: rgba(239, 68, 68, 0.3);
  background: var(--danger-soft);
}

.status-pill.canceled {
  color: #e5e7eb;
  background: rgba(100, 116, 139, 0.18);
}

.search-hits {
  display: grid;
  gap: 6px;
  margin-top: 8px;
  padding: 8px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 14px;
  background: rgba(2, 6, 23, 0.22);
}

.search-hit {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  color: #cbd5e1;
  font-size: 12px;
  line-height: 1.5;
}

.search-hit.timed {
  grid-template-columns: 82px minmax(0, 1fr);
}

.search-hit strong {
  margin-right: 6px;
  color: #7dd3fc;
}

.search-hit button {
  padding: 3px 7px;
  font-size: 12px;
  border-radius: 999px;
}

.list-loading-bar {
  position: sticky;
  top: 0;
  z-index: 5;
  margin: 10px;
  padding: 9px 12px;
  color: #bfdbfe;
  font-size: 13px;
  border: 1px solid rgba(56, 189, 248, 0.24);
  border-radius: 999px;
  background:
    linear-gradient(90deg, rgba(56, 189, 248, 0.18), rgba(139, 92, 246, 0.1)),
    rgba(15, 23, 42, 0.9);
}

.list-error {
  margin: 10px;
  padding: 14px;
  display: grid;
  gap: 8px;
  color: #fecaca;
  border: 1px solid rgba(239, 68, 68, 0.32);
  border-radius: 18px;
  background:
    linear-gradient(135deg, rgba(127, 29, 29, 0.35), rgba(15, 23, 42, 0.72)),
    rgba(15, 23, 42, 0.8);
}

.list-error strong {
  color: white;
}

.list-error span {
  color: #fecaca;
  font-size: 13px;
  line-height: 1.5;
}

.list-error button {
  justify-self: start;
}

.empty-state {
  height: 100%;
  min-height: 420px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  padding: 32px;
  text-align: center;
  color: var(--text-muted);
}

.empty-illustration {
  width: 74px;
  height: 74px;
  display: grid;
  place-items: center;
  margin-bottom: 2px;
  font-size: 34px;
  border-radius: 24px;
  border: 1px solid rgba(56, 189, 248, 0.22);
  background:
    linear-gradient(135deg, rgba(56, 189, 248, 0.16), rgba(139, 92, 246, 0.12)),
    rgba(2, 6, 23, 0.28);
}

.empty-title {
  color: white;
  font-size: 18px;
  font-weight: 760;
}

.empty-subtitle {
  max-width: 420px;
  line-height: 1.6;
}

.empty-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 8px;
}

.empty-support {
  margin-top: 8px;
  max-width: 440px;
  color: var(--text-faint);
  font-size: 12px;
  line-height: 1.6;
}

.list-skeleton {
  display: grid;
  gap: 8px;
  padding: 10px;
}

.skeleton-row {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) 76px;
  gap: 13px;
  align-items: center;
  padding: 13px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 20px;
  background: rgba(15, 23, 42, 0.42);
}

.skeleton-cover,
.skeleton-line,
.skeleton-action {
  display: block;
  overflow: hidden;
  position: relative;
  background: rgba(100, 116, 139, 0.18);
}

.skeleton-cover {
  width: 56px;
  height: 56px;
  border-radius: 18px;
}

.skeleton-content {
  display: grid;
  gap: 9px;
}

.skeleton-line {
  height: 12px;
  border-radius: 999px;
}

.skeleton-line.long {
  width: 70%;
}

.skeleton-line.medium {
  width: 45%;
}

.skeleton-line.short {
  width: 28%;
}

.skeleton-action {
  width: 72px;
  height: 34px;
  border-radius: 999px;
}

.skeleton-cover::after,
.skeleton-line::after,
.skeleton-action::after {
  content: "";
  position: absolute;
  inset: 0;
  transform: translateX(-110%);
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.12), transparent);
  animation: skeleton-shimmer 1.35s infinite;
}

@keyframes skeleton-shimmer {
  100% {
    transform: translateX(110%);
  }
}

/* Inspector */

.inspector-panel {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.052), rgba(255, 255, 255, 0.012)),
    var(--surface);
  box-shadow:
    0 24px 80px rgba(0, 0, 0, 0.28),
    0 1px 0 rgba(255, 255, 255, 0.04) inset;
  backdrop-filter: blur(22px);
}

.empty-inspector {
  display: grid;
  place-items: center;
  padding: 20px;
}

.empty-detail-card {
  width: min(100%, 360px);
  padding: 24px;
  text-align: center;
  border: 1px solid rgba(125, 211, 252, 0.18);
  border-radius: 26px;
  background:
    radial-gradient(circle at 50% 0%, rgba(56, 189, 248, 0.16), transparent 18rem),
    linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.014)),
    rgba(15, 23, 42, 0.58);
}

.empty-detail-icon {
  width: 70px;
  height: 70px;
  display: grid;
  place-items: center;
  margin: 0 auto 16px;
  color: white;
  font-size: 34px;
  border-radius: 24px;
  background:
    radial-gradient(circle at 25% 20%, rgba(255, 255, 255, 0.38), transparent 30px),
    linear-gradient(135deg, var(--primary), var(--accent));
}

.empty-detail-card h2 {
  margin: 0 0 10px;
  color: white;
}

.empty-detail-card p {
  color: var(--text-muted);
  line-height: 1.6;
}

.detail-empty-steps {
  display: grid;
  gap: 9px;
  margin-top: 18px;
}

.detail-empty-steps div {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  padding: 10px;
  text-align: left;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 16px;
  background: rgba(2, 6, 23, 0.28);
}

.detail-empty-steps strong {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  color: #dbeafe;
  border-radius: 999px;
  background: rgba(56, 189, 248, 0.14);
}

.detail-empty-steps span {
  color: var(--text-soft);
  font-size: 13px;
}

.inspector-hero {
  padding: 16px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
  background:
    radial-gradient(circle at 20% 0%, rgba(56, 189, 248, 0.1), transparent 18rem),
    rgba(15, 23, 42, 0.28);
}

.inspector-cover {
  width: 116px;
  height: 116px;
  display: grid;
  place-items: center;
  overflow: hidden;
  margin-bottom: 14px;
  color: #dbeafe;
  font-size: 48px;
  border-radius: 26px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background:
    radial-gradient(circle at 28% 16%, rgba(255, 255, 255, 0.18), transparent 32px),
    linear-gradient(135deg, rgba(56, 189, 248, 0.42), rgba(139, 92, 246, 0.32)),
    rgba(51, 65, 85, 0.82);
  box-shadow:
    0 22px 48px rgba(2, 6, 23, 0.34),
    0 1px 0 rgba(255, 255, 255, 0.12) inset;
}

.inspector-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.inspector-title h2 {
  margin: 0;
  color: white;
  font-size: 22px;
  line-height: 1.2;
  letter-spacing: -0.035em;
}

.inspector-title p {
  margin: 7px 0 0;
  color: var(--text-muted);
  font-size: 13px;
}

.detail-meta-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 12px;
}

.detail-meta-strip > span:not(.status-pill) {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 2px 8px;
  color: var(--text-soft);
  font-size: 12px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 999px;
  background: rgba(100, 116, 139, 0.12);
}

.inspector-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.upload-button {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  color: var(--text);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.018)),
    rgba(30, 41, 59, 0.78);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
}

.upload-button input {
  display: none;
}

.inspector-tabs {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  padding: 10px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
}

.inspector-tabs button {
  padding: 8px 6px;
  border-radius: 999px;
  font-size: 13px;
  background: rgba(15, 23, 42, 0.38);
  box-shadow: none;
}

.inspector-tabs button.active {
  color: white;
  border-color: rgba(125, 211, 252, 0.38);
  background: linear-gradient(135deg, rgba(14, 165, 233, 0.34), rgba(139, 92, 246, 0.2));
}

.inspector-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
}

.inspector-section-stack {
  display: grid;
  gap: 12px;
}

.panel-card {
  padding: 15px;
  border: 1px solid var(--border);
  border-radius: 20px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.034), rgba(255, 255, 255, 0.012)),
    rgba(15, 23, 42, 0.46);
}

.panel-card h3 {
  margin: 0 0 12px;
  color: var(--text-soft);
  font-size: 14px;
}

.panel-card p {
  color: var(--text-soft);
  line-height: 1.65;
}

.card-heading-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.card-heading-row h3 {
  margin-bottom: 0;
}

.field-grid {
  display: grid;
  gap: 12px;
}

.field-grid label,
.settings-form-grid label {
  display: grid;
  gap: 7px;
  color: var(--text-soft);
  font-size: 13px;
  font-weight: 650;
}

.checkbox-row {
  display: flex !important;
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.wide {
  grid-column: 1 / -1;
}

.inline-form {
  display: flex;
  gap: 9px;
  margin-top: 11px;
}

.inline-form input,
.inline-form select {
  flex: 1;
}

.inline-form button {
  white-space: nowrap;
}

.section-actions,
.compact-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.section-button {
  margin-top: 12px;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: white;
  font-size: 13px;
  border: 1px solid rgba(125, 211, 252, 0.28);
  background:
    linear-gradient(135deg, rgba(14, 165, 233, 0.82), rgba(59, 130, 246, 0.72));
  border-radius: 999px;
  padding: 6px 10px;
}

.tag.suggestion {
  border-color: rgba(196, 181, 253, 0.3);
  background:
    linear-gradient(135deg, rgba(124, 58, 237, 0.92), rgba(139, 92, 246, 0.78));
}

.tag.accepted {
  border-color: rgba(134, 239, 172, 0.3);
  background:
    linear-gradient(135deg, rgba(22, 101, 52, 0.92), rgba(34, 197, 94, 0.72));
}

.tag em {
  font-style: normal;
  font-size: 12px;
  opacity: 0.9;
}

.tag button {
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  box-shadow: none;
}

.ai-card {
  border-color: rgba(139, 92, 246, 0.24);
  background:
    linear-gradient(135deg, rgba(14, 165, 233, 0.12), rgba(139, 92, 246, 0.12)),
    rgba(15, 23, 42, 0.58);
}

.soft-empty,
.transcript-empty {
  padding: 16px;
  color: var(--text-muted);
  line-height: 1.6;
  border: 1px dashed var(--border);
  border-radius: 16px;
  background: rgba(2, 6, 23, 0.24);
}

.raw-ai-output {
  max-height: 280px;
  overflow: auto;
  padding: 12px;
  color: var(--text-soft);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: rgba(2, 6, 23, 0.48);
}

.transcript-timeline {
  max-height: 520px;
  overflow: auto;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: rgba(2, 6, 23, 0.28);
}

.segment {
  display: grid;
  grid-template-columns: 78px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  padding: 8px;
  color: var(--text-soft);
  border-radius: 14px;
}

.segment + .segment {
  margin-top: 3px;
}

.segment:hover {
  background: rgba(30, 41, 59, 0.56);
}

.segment button {
  padding: 5px 8px;
  color: #bfdbfe;
  font-size: 12px;
}

.file-info-card dl {
  display: grid;
  grid-template-columns: 104px minmax(0, 1fr);
  gap: 8px 10px;
  margin: 0;
}

.file-info-card dt {
  color: var(--text-muted);
  font-size: 12px;
}

.file-info-card dd {
  margin: 0;
  color: var(--text-soft);
  font-size: 13px;
  word-break: break-all;
}

.danger-zone {
  border-color: rgba(239, 68, 68, 0.28);
  background:
    linear-gradient(135deg, rgba(127, 29, 29, 0.2), rgba(15, 23, 42, 0.52)),
    rgba(15, 23, 42, 0.52);
}

/* Settings */

.settings-panel {
  height: 100%;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.052), rgba(255, 255, 255, 0.012)),
    var(--surface);
  box-shadow:
    0 24px 80px rgba(0, 0, 0, 0.28),
    0 1px 0 rgba(255, 255, 255, 0.04) inset;
  backdrop-filter: blur(22px);
}

.settings-header {
  flex: 0 0 auto;
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 20px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
}

.settings-header h2 {
  margin: 0;
  color: white;
  font-size: 28px;
  letter-spacing: -0.04em;
}

.settings-header p {
  margin: 7px 0 0;
  color: var(--text-muted);
}

.backend-status {
  height: 38px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  white-space: nowrap;
  color: var(--text-soft);
  border: 1px solid var(--border);
  border-radius: 999px;
  background: rgba(2, 6, 23, 0.3);
}

.backend-status span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--warning);
}

.backend-status.ok span {
  background: var(--success);
}

.backend-status.failed span {
  background: var(--danger);
}

.settings-tabs {
  flex: 0 0 auto;
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  overflow-x: auto;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
}

.settings-tabs button {
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.38);
  box-shadow: none;
}

.settings-tabs button.active {
  color: white;
  border-color: rgba(125, 211, 252, 0.38);
  background: linear-gradient(135deg, rgba(14, 165, 233, 0.34), rgba(139, 92, 246, 0.2));
}

.settings-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px;
}

.settings-grid-layout {
  display: grid;
  grid-template-columns: repeat(2, minmax(260px, 1fr));
  gap: 14px;
}

.settings-grid-layout > .panel-card:first-child {
  grid-column: 1 / -1;
}

.max-form-card {
  max-width: 760px;
}

.settings-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(220px, 1fr));
  gap: 13px;
  margin-bottom: 14px;
}

.root-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 10px;
  align-items: center;
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: rgba(2, 6, 23, 0.24);
}

.root-card.disabled {
  opacity: 0.58;
}

.root-card strong {
  display: block;
  min-width: 0;
  color: var(--text-soft);
  word-break: break-all;
}

.root-card span {
  display: block;
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 12px;
}

.root-toggle {
  display: flex;
  align-items: center;
  gap: 7px;
  white-space: nowrap;
  color: var(--text-soft);
  font-size: 13px;
}

.scan-task-row {
  margin-top: 10px;
  padding: 13px;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: rgba(2, 6, 23, 0.26);
}

.scan-task-top {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.progress-line {
  height: 9px;
  margin: 10px 0;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(51, 65, 85, 0.78);
}

.progress-line div {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--primary), var(--accent));
}

.scan-task-meta {
  color: var(--text-muted);
  font-size: 13px;
}

.privacy-warning {
  padding: 12px;
  color: #fecaca;
  line-height: 1.6;
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 16px;
  background: rgba(127, 29, 29, 0.24);
}

.test-result {
  padding: 12px;
  color: var(--text-soft);
  white-space: pre-wrap;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: rgba(2, 6, 23, 0.42);
}

.log-viewer {
  max-height: 560px;
  overflow: auto;
  padding: 13px;
  color: var(--text-soft);
  white-space: pre-wrap;
  font-size: 12px;
  line-height: 1.55;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: rgba(2, 6, 23, 0.62);
}

/* Task panel */

.task-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.task-panel-header h3 {
  margin: 0;
}

.task-table-wrap {
  overflow: auto;
  margin-top: 12px;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: rgba(2, 6, 23, 0.26);
}

.task-table {
  width: 100%;
  min-width: 900px;
  border-collapse: collapse;
  font-size: 13px;
}

.task-table th,
.task-table td {
  padding: 10px;
  text-align: left;
  vertical-align: top;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
}

.task-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  color: var(--text-soft);
  background: rgba(15, 23, 42, 0.94);
}

.task-table tr:hover td {
  background: rgba(30, 41, 59, 0.38);
}

.task-error {
  max-width: 260px;
  color: #fecaca;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* Player */

.player-dock {
  position: relative;
  z-index: 50;
  flex: 0 0 var(--player-height);
  height: var(--player-height);
  display: grid;
  grid-template-columns: minmax(250px, 330px) minmax(320px, 1fr) minmax(260px, 320px);
  gap: 14px;
  align-items: center;
  padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
  overflow: visible;
  border-top: 1px solid rgba(148, 163, 184, 0.16);
  background:
    linear-gradient(180deg, rgba(15, 23, 42, 0.84), rgba(2, 6, 23, 0.96)),
    rgba(2, 6, 23, 0.96);
  backdrop-filter: blur(24px);
  box-shadow: 0 -18px 45px rgba(0, 0, 0, 0.28);
}

.player-now-card {
  min-width: 0;
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  padding: 8px;
  border: 1px solid rgba(56, 189, 248, 0.16);
  border-radius: 18px;
  background:
    linear-gradient(135deg, rgba(56, 189, 248, 0.09), rgba(139, 92, 246, 0.06)),
    rgba(15, 23, 42, 0.45);
}

.player-cover {
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  overflow: hidden;
  color: #dbeafe;
  font-size: 24px;
  border-radius: 16px;
  background:
    radial-gradient(circle at 30% 20%, rgba(255, 255, 255, 0.18), transparent 24px),
    linear-gradient(135deg, rgba(56, 189, 248, 0.42), rgba(139, 92, 246, 0.3));
}

.player-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.player-now-text {
  min-width: 0;
}

.player-now-text .eyebrow {
  margin-bottom: 3px;
  font-size: 10px;
}

.player-now-text strong {
  display: block;
  min-width: 0;
  color: white;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.player-now-text em {
  display: block;
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 12px;
  font-style: normal;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.player-center {
  min-width: 0;
  display: grid;
  gap: 9px;
}

.player-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
}

.icon-button {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  padding: 0;
  font-size: 24px;
  line-height: 1;
  border-radius: 999px;
}

.play-toggle {
  min-width: 64px;
  height: 38px;
  border-radius: 999px;
  color: white;
  border-color: rgba(125, 211, 252, 0.4);
  background: linear-gradient(135deg, var(--primary-strong), var(--accent));
  box-shadow: 0 16px 32px rgba(14, 165, 233, 0.22);
}

.stop-button {
  height: 36px;
  border-radius: 999px;
}

.player-progress {
  min-width: 0;
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr) 52px;
  gap: 9px;
  align-items: center;
}

.player-progress span {
  color: var(--text-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.player-progress input[type="range"] {
  min-width: 0;
  background: rgba(51, 65, 85, 0.9);
}

.player-options {
  position: relative;
  min-width: 0;
  display: grid;
  grid-template-columns: 82px minmax(0, 1fr);
  grid-template-areas:
    "speed volume"
    "queue queue";
  gap: 7px 10px;
  align-content: center;
  overflow: visible;
}

.player-options label {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.player-options label:first-child {
  grid-area: speed;
}

.player-options label:nth-child(2) {
  grid-area: volume;
}

.player-options select {
  height: 30px;
  padding: 3px 8px;
  border-radius: 9px;
}

.player-options input[type="range"] {
  flex: 1;
  min-width: 0;
}

.queue-control {
  grid-area: queue;
  position: relative;
  min-width: 0;
}

.queue-toggle-button {
  width: 100%;
  height: 31px;
  padding: 4px 10px;
  border-radius: 999px;
  color: #dbeafe;
  border-color: rgba(56, 189, 248, 0.28);
  background:
    linear-gradient(135deg, rgba(56, 189, 248, 0.12), rgba(139, 92, 246, 0.08)),
    rgba(15, 23, 42, 0.72);
  white-space: nowrap;
}

.queue-popover {
  position: absolute;
  right: 0;
  bottom: calc(100% + 12px);
  width: min(420px, 42vw);
  max-height: min(460px, 56vh);
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 20px;
  background:
    linear-gradient(180deg, rgba(15, 23, 42, 0.96), rgba(2, 6, 23, 0.96)),
    rgba(2, 6, 23, 0.96);
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.48);
  backdrop-filter: blur(24px);
}

.queue-popover-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 13px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.14);
}

.queue-popover-header strong {
  color: white;
  font-size: 14px;
}

.queue-popover-header button {
  height: 30px;
  padding: 4px 10px;
  border-radius: 999px;
}

.queue-empty {
  padding: 24px;
  color: var(--text-muted);
  text-align: center;
  font-size: 13px;
}

.queue-list {
  max-height: calc(min(460px, 56vh) - 56px);
  overflow: auto;
  padding: 8px;
}

.queue-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 30px;
  gap: 7px;
  align-items: center;
  padding: 5px;
  border: 1px solid transparent;
  border-radius: 13px;
}

.queue-row:hover {
  border-color: rgba(148, 163, 184, 0.14);
  background: rgba(30, 41, 59, 0.58);
}

.queue-row.active {
  border-color: rgba(56, 189, 248, 0.28);
  background:
    linear-gradient(90deg, rgba(56, 189, 248, 0.2), rgba(139, 92, 246, 0.1)),
    rgba(30, 41, 59, 0.7);
}

.queue-row-main {
  min-width: 0;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  padding: 7px 8px;
  text-align: left;
  border: none;
  background: transparent;
  box-shadow: none;
}

.queue-row-main:hover {
  transform: none;
  background: transparent;
}

.queue-index {
  display: inline-flex;
  justify-content: center;
  color: #7dd3fc;
  font-size: 12px;
}

.queue-title {
  min-width: 0;
  color: var(--text-soft);
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.queue-remove {
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 999px;
}

/* Toast */

.toast-stack {
  position: fixed;
  right: 18px;
  bottom: calc(var(--player-height) + 18px);
  z-index: 9999;
  display: grid;
  gap: 10px;
  width: 340px;
}

.toast {
  padding: 12px 14px;
  color: white;
  border-radius: 16px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(18px);
}

.toast-info {
  border: 1px solid rgba(56, 189, 248, 0.45);
  background: rgba(30, 64, 175, 0.92);
}

.toast-success {
  border: 1px solid rgba(34, 197, 94, 0.45);
  background: rgba(20, 83, 45, 0.92);
}

.toast-error {
  border: 1px solid rgba(239, 68, 68, 0.45);
  background: rgba(127, 29, 29, 0.92);
}

.toast-content {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.toast-message {
  flex: 1;
  line-height: 1.55;
}

.toast-close {
  min-width: 26px;
  height: 26px;
  padding: 0 6px;
  border-radius: 999px;
  box-shadow: none;
}

/* Responsive */

@media (max-width: 1280px) {
  .main-shell {
    grid-template-columns: 232px minmax(0, 1fr) minmax(340px, 380px);
    gap: 12px;
    padding: 12px 12px 10px;
  }

  .main-shell.settings-mode {
    grid-template-columns: 232px minmax(0, 1fr);
  }

  .top-action-row {
    grid-template-columns: 1fr;
  }

  .filter-group,
  .top-buttons {
    flex-wrap: wrap;
  }

  .filter-group select {
    flex: 1 1 140px;
  }

  .player-dock {
    grid-template-columns: minmax(220px, 280px) minmax(280px, 1fr) minmax(240px, 290px);
  }
}

@media (max-width: 1080px) {
  :root {
    --player-height: 98px;
  }

  .main-shell {
    grid-template-columns: 220px minmax(0, 1fr) 340px;
  }

  .main-shell.settings-mode {
    grid-template-columns: 220px minmax(0, 1fr);
  }

  .settings-grid-layout,
  .settings-form-grid {
    grid-template-columns: 1fr;
  }

  .settings-grid-layout > .panel-card:first-child {
    grid-column: auto;
  }

  .audio-row {
    grid-template-columns: 56px minmax(0, 1fr);
  }

  .row-actions {
    grid-column: 1 / -1;
    justify-content: flex-start;
    opacity: 1;
  }

  .player-dock {
    grid-template-columns: minmax(190px, 240px) minmax(250px, 1fr) minmax(220px, 250px);
    gap: 10px;
  }

  .player-options {
    grid-template-columns: 76px minmax(0, 1fr);
  }

  .queue-popover {
    width: min(380px, 54vw);
  }
}

/* =========================================================
   Layout Hotfix
   修复：
   1. 左侧栏标签与播放列表数量多时堆积
   2. 界面缩放变大后顶部搜索 / 筛选 / 操作按钮变成长条并被遮挡
   3. 高缩放或较窄窗口下硬性 min-width 导致内容裁切
   ========================================================= */

/* ---------- 全局：允许布局在高缩放下真正收缩 ---------- */

.app-shell {
  min-width: 0;
  overflow: hidden;
}

.main-shell,
.workspace,
.audio-list-panel,
.top-command-bar,
.inspector-panel,
.settings-panel {
  min-width: 0;
}

/* ---------- 左侧栏：播放列表与标签分区滚动，避免互相堆积 ---------- */

.sidebar {
  min-height: 0;
  overflow: hidden;
}

/* 品牌、导航、底部固定占位，不参与无限扩展 */
.brand,
.sidebar-nav,
.sidebar-footer {
  flex: 0 0 auto;
}

/* 导航项在高度不足时允许自己滚动，避免把播放列表 / 标签压没 */
.sidebar-nav {
  min-height: 0;
  max-height: clamp(220px, 34vh, 360px);
  overflow: auto;
  padding-right: 2px;
}

/* 每个 section 都必须允许在 flex 容器中收缩 */
.sidebar-section {
  min-height: 0;
}

/* 播放列表区域限制高度，让它独立滚动 */
.sidebar-section:not(.tag-section) {
  flex: 0 0 auto;
}

.sidebar-section:not(.tag-section) .sidebar-scroll-area {
  min-height: 0;
  max-height: clamp(92px, 18vh, 180px);
  overflow: auto;
  padding-right: 2px;
}

/* 标签区域吃掉剩余高度，并在内部滚动 */
.tag-section {
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
}

/* 标签不要再一行一个撑满左栏，改成胶囊云，减少堆积 */
.tag-section .tag-cloud-nav {
  height: 100%;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 8px;
  padding-right: 2px;
}

.tag-section .sidebar-pill {
  width: auto;
  max-width: 100%;
  flex: 0 1 auto;
  padding-inline: 10px;
  white-space: nowrap;
}

/* “全部标签”单独占一行，更清楚 */
.tag-section .sidebar-pill:first-child {
  flex: 1 0 100%;
  justify-content: center;
}

/* 播放列表仍然保持整行显示 */
.playlist-row {
  width: 100%;
  min-width: 0;
}

.playlist-row strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 左侧底部隐私卡片在高度不足时可以隐藏，优先保证导航可用 */
@media (max-height: 760px) {
  .sidebar {
    gap: 10px;
    padding: 12px;
  }

  .brand {
    padding-bottom: 10px;
  }

  .brand-orb {
    width: 38px;
    height: 38px;
    border-radius: 14px;
  }

  .brand-copy h2 {
    font-size: 17px;
  }

  .brand-copy p {
    display: none;
  }

  .nav-card {
    padding: 8px;
  }

  .nav-symbol {
    width: 32px;
    height: 32px;
  }

  .nav-card em {
    display: none;
  }

  .sidebar-section:not(.tag-section) .sidebar-scroll-area {
    max-height: clamp(72px, 14vh, 124px);
  }

  .privacy-card {
    display: none;
  }
}

@media (max-height: 660px) {
  .sidebar-nav {
    max-height: 220px;
  }

  .sidebar-footer {
    display: none;
  }
}

/* ---------- 顶部工具栏：搜索 / 筛选 / 操作按钮自动换行 ---------- */

.top-command-bar {
  overflow: visible;
}

/* 标题和数量卡片允许换行 */
.top-title-block {
  flex-wrap: wrap;
  align-items: flex-start;
}

.top-count-card {
  flex: 0 0 auto;
}

/* 原先 grid 容易在高缩放下被 auto 列撑开，改为 flex wrap */
.top-action-row {
  display: flex !important;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 10px;
  min-width: 0;
}

/* 搜索框优先占据主空间，但可以换行 */
.global-search {
  flex: 999 1 320px;
  min-width: min(100%, 260px);
}

/* 筛选组整体可以换行 */
.filter-group {
  flex: 1 1 340px;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

/* 缺描述 chip 可以收缩 */
.filter-chip {
  flex: 1 1 112px;
  min-width: 0;
  justify-content: center;
  white-space: nowrap;
}

/* select 不再固定撑开成一长条 */
.filter-group select {
  width: auto;
  flex: 1 1 132px;
  min-width: 0;
  max-width: none;
}

/* 顶部按钮组也要允许换行 */
.top-buttons {
  flex: 1 1 260px;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.top-buttons button {
  flex: 0 1 auto;
  white-space: nowrap;
}

/* 中等宽度 / 放大后：搜索框单独一行，筛选和按钮在下一行 */
@media (max-width: 1180px) {
  .top-action-row {
    align-items: stretch;
  }

  .global-search {
    flex-basis: 100%;
  }

  .filter-group {
    flex: 1 1 420px;
  }

  .top-buttons {
    flex: 1 1 260px;
    justify-content: flex-start;
  }
}

/* 更窄或更高缩放：筛选项和按钮全部可垂直排列 */
@media (max-width: 940px) {
  .top-command-bar {
    padding: 14px;
  }

  .top-title-block h1 {
    font-size: 24px;
  }

  .top-count-card {
    width: 100%;
    text-align: left;
  }

  .filter-group,
  .top-buttons {
    flex-basis: 100%;
  }

  .filter-chip,
  .filter-group select {
    flex: 1 1 100%;
  }

  .top-buttons button:not(.icon-soft-button) {
    flex: 1 1 auto;
  }

  .top-buttons .icon-soft-button {
    flex: 0 0 40px;
  }
}

/* ---------- 高缩放 / 窄宽度下：避免三栏强行并排导致遮挡 ---------- */

/*
  界面放大时，实际 CSS viewport 会变窄。
  此时隐藏右侧 Inspector，优先保证资料库列表和搜索区域可用。
*/
@media (max-width: 1040px) {
  .main-shell {
    grid-template-columns: 220px minmax(0, 1fr);
  }

  .main-shell.settings-mode {
    grid-template-columns: 220px minmax(0, 1fr);
  }

  .inspector-panel {
    display: none;
  }

  .sidebar {
    padding: 12px;
  }
}

/* 极窄时进一步缩小左栏，避免资料库被挤没 */
@media (max-width: 860px) {
  .main-shell,
  .main-shell.settings-mode {
    grid-template-columns: 196px minmax(0, 1fr);
    gap: 10px;
    padding: 10px;
  }

  .sidebar {
    border-radius: 18px;
  }

  .nav-card {
    grid-template-columns: 30px minmax(0, 1fr);
    gap: 8px;
  }

  .nav-symbol {
    width: 30px;
    height: 30px;
  }

  .nav-card strong {
    font-size: 13px;
  }
}

/* ---------- 音频列表：高缩放下行按钮不再挤压标题 ---------- */

@media (max-width: 1180px) {
  .audio-row {
    grid-template-columns: 56px minmax(0, 1fr);
  }

  .row-actions {
    grid-column: 1 / -1;
    justify-content: flex-start;
    opacity: 1;
    padding-left: 68px;
  }
}

@media (max-width: 860px) {
  .row-actions {
    padding-left: 0;
  }

  .description-line {
    white-space: normal;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
}

/* ---------- 播放器：高缩放下避免右侧选项挤压进度条 ---------- */

@media (max-width: 1040px) {
  .player-dock {
    grid-template-columns: minmax(200px, 260px) minmax(0, 1fr);
    height: auto;
    min-height: var(--player-height);
  }

  .player-options {
    grid-column: 1 / -1;
    grid-template-columns: 100px minmax(0, 1fr) minmax(180px, 240px);
    grid-template-areas: "speed volume queue";
  }

  .queue-control {
    min-width: 0;
  }
}

@media (max-width: 860px) {
  .player-dock {
    grid-template-columns: 1fr;
  }

  .player-now-card,
  .player-center,
  .player-options {
    grid-column: 1;
  }

  .player-options {
    grid-template-columns: 1fr;
    grid-template-areas:
      "speed"
      "volume"
      "queue";
  }
}


================================================================================
文件: frontend/src/tauri.ts
================================================================================
import { invoke } from "@tauri-apps/api/core";

export async function isTauriRuntime(): Promise<boolean> {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function pickAudioFolder(): Promise<string | null> {
  try {
    const result = await invoke<string | null>("pick_audio_folder");
    return result;
  } catch (err) {
    console.error("pick_audio_folder failed", err);
    return null;
  }
}

export async function pickAudioFile(): Promise<string | null> {
  try {
    const result = await invoke<string | null>("pick_audio_file");
    return result;
  } catch (err) {
    console.error("pick_audio_file failed", err);
    return null;
  }
}


================================================================================
文件: frontend/src/types.ts
================================================================================
export type LibraryRoot = {
  id: number;
  path: string;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type Tag = {
  id: number;
  name: string;
  source: string;
  created_at: string;
};

export type SearchHit = {
  field: "title" | "author" | "description" | "tags" | "transcript" | string;
  label: string;
  text: string;
  start_seconds?: number;
  end_seconds?: number;
};

export type AudioItem = {
  id: number;
  file_path: string;
  file_name: string;
  file_ext?: string;
  file_size?: number;
  file_mtime?: string;
  file_hash?: string;

  library_root_id?: number;

  title_original?: string;
  title_user?: string;

  author_original?: string;
  author_user?: string;

  album_original?: string;
  album_user?: string;

  description_original?: string;
  description_user?: string;
  description_ai?: string;

  cover_path?: string;
  cover_source?: string;

  duration_seconds?: number;
  bitrate?: number;
  sample_rate?: number;
  channels?: number;

  language?: string;

  transcript_status: string;
  ai_status: string;

  play_count: number;
  last_played_at?: string;
  last_position_seconds: number;

  is_favorite: boolean;
  is_missing: boolean;

  created_at: string;
  updated_at: string;

  tags?: Tag[];
  search_hits?: SearchHit[];

  playlist_item_id?: number;
  playlist_order_index?: number;
};

export type AudioDetail = {
  audio: AudioItem;
  tags: Tag[];
};

export type Playlist = {
  id: number;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
};

export type PlaylistDetail = {
  playlist: Playlist;
  items: {
    playlist_item: {
      id: number;
      playlist_id: number;
      audio_id: number;
      order_index: number;
      created_at: string;
    };
    audio: AudioItem;
  }[];
};

export type Transcript = {
  transcript: {
    id: number;
    audio_id: number;
    language?: string;
    full_text: string;
    model_name?: string;
    status: string;
    generated_at: string;
    updated_at: string;
  };
  segments: {
    id: number;
    transcript_id: number;
    segment_index: number;
    start_seconds: number;
    end_seconds: number;
    text: string;
  }[];
};

export type AITask = {
  id: number;
  audio_id: number;
  task_type: "transcribe" | "analyze" | string;
  status: "pending" | "running" | "done" | "failed" | "canceled" | string;
  input_payload?: string;
  output_payload?: string;
  error_message?: string;
  retry_count: number;
  created_at: string;
  started_at?: string;
  finished_at?: string;
  updated_at: string;
  privacy_warning?: string;
};

export type ScanTask = {
  id: number;
  root_id: number;
  status: "pending" | "running" | "done" | "failed" | "canceled" | string;

  total_files: number;
  processed_files: number;

  imported: number;
  updated: number;
  missing: number;

  error_message?: string;

  created_at: string;
  started_at?: string;
  finished_at?: string;
  updated_at: string;
};

export type AISuggestions = {
  task_id: number | null;
  description?: string;
  tags: string[];
  language?: string;
  raw_content?: string;
};

export type LLMConfigPayload = {
  endpoint: string;
  model_name: string;
  api_key?: string;
  timeout: number;
  max_tokens?: number;
  temperature?: number;
};

export type LLMTestResult = {
  ok: boolean;
  content: string;
  is_local_endpoint?: boolean;
  privacy_warning?: string;
};

export type BatchTaskResult = {
  created: number;
  skipped: number;
  privacy_warning?: string;
  errors: {
    audio_id: number;
    error: string;
  }[];
  tasks: AITask[];
};

export function displayTitle(a: AudioItem): string {
  return a.title_user || a.title_original || a.file_name;
}

export function displayAuthor(a: AudioItem): string {
  return a.author_user || a.author_original || "";
}

export function displayDescription(a: AudioItem): string {
  return a.description_user || a.description_ai || a.description_original || "";
}

export function formatDuration(seconds?: number): string {
  if (!seconds && seconds !== 0) return "--:--";

  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;

  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  return `${m}:${String(sec).padStart(2, "0")}`;
}


================================================================================
文件: frontend/src-tauri/.cargo/config.toml
================================================================================
﻿[source.crates-io]
replace-with = "rsproxy-sparse"

[source.rsproxy-sparse]
registry = "sparse+https://rsproxy.cn/index/"

[net]
retry = 10
git-fetch-with-cli = true

[http]
timeout = 600
multiplexing = false


================================================================================
文件: frontend/src-tauri/build.rs
================================================================================
use std::env;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

const SIDECAR_BASENAME: &str = "local-audio-backend";
const DEV_PLACEHOLDER_MARKER: &[u8] =
    b"LOCAL_AUDIO_LIBRARY_DEV_SIDECAR_PLACEHOLDER\n";

fn target_sidecar_path() -> Option<PathBuf> {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").ok()?;
    let target = env::var("TARGET").ok()?;

    if target.trim().is_empty() {
        return None;
    }

    let exe_suffix = if target.contains("windows") { ".exe" } else { "" };

    Some(
        PathBuf::from(manifest_dir)
            .join("binaries")
            .join(format!("{SIDECAR_BASENAME}-{target}{exe_suffix}")),
    )
}

fn file_starts_with(path: &Path, prefix: &[u8]) -> bool {
    let mut file = match fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return false,
    };

    let mut buf = vec![0_u8; prefix.len()];

    match file.read_exact(&mut buf) {
        Ok(_) => buf == prefix,
        Err(_) => false,
    }
}

fn ensure_dev_sidecar_placeholder() {
    let profile = env::var("PROFILE").unwrap_or_default();

    let Some(path) = target_sidecar_path() else {
        return;
    };

    if profile == "release" {
        if path.exists() && file_starts_with(&path, DEV_PLACEHOLDER_MARKER) {
            panic!(
                "\nRelease sidecar is still a dev placeholder:\n  {}\n\n\
                 Please build the real backend sidecar before running `tauri build`:\n\
                 1. cd backend\n\
                 2. python build_backend.py\n\
                 3. cd ../frontend\n\
                 4. npm run tauri:build\n",
                path.display()
            );
        }

        return;
    }

    if profile != "debug" {
        return;
    }

    if path.exists() {
        return;
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("failed to create src-tauri/binaries directory");
    }

    let content = [
        DEV_PLACEHOLDER_MARKER,
        b"This file is generated only for `tauri dev`.\n",
        b"The dev build starts the Python backend from backend/run.py directly.\n",
        b"Do not ship this file in release builds.\n",
    ]
    .concat();

    fs::write(&path, content).expect("failed to create dev sidecar placeholder");

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        if let Ok(metadata) = fs::metadata(&path) {
            let mut permissions = metadata.permissions();
            permissions.set_mode(0o755);
            let _ = fs::set_permissions(&path, permissions);
        }
    }

    println!(
        "cargo:warning=Created dev sidecar placeholder: {}",
        path.display()
    );
}

fn main() {
    println!("cargo:rerun-if-env-changed=PROFILE");
    println!("cargo:rerun-if-env-changed=TARGET");

    ensure_dev_sidecar_placeholder();

    tauri_build::build();
}


================================================================================
文件: frontend/src-tauri/capabilities/default.json
================================================================================
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default permissions for Local Audio Library",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "shell:default",
    "shell:allow-spawn",
    "shell:allow-execute",
    "dialog:default",
    "dialog:allow-open",
    "process:default"
  ]
}


================================================================================
文件: frontend/src-tauri/Cargo.toml
================================================================================
[package]
name = "local-audio-library"
version = "0.1.0"
description = "Local Audio Library"
authors = ["you"]
edition = "2021"

[lib]
name = "local_audio_library_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-shell = "2"
tauri-plugin-dialog = "2"
tauri-plugin-process = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"


================================================================================
文件: frontend/src-tauri/icons/android/mipmap-anydpi-v26/ic_launcher.xml
================================================================================
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
  <background android:drawable="@color/ic_launcher_background"/>
</adaptive-icon>

================================================================================
文件: frontend/src-tauri/icons/android/values/ic_launcher_background.xml
================================================================================
<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="ic_launcher_background">#fff</color>
</resources>

================================================================================
文件: frontend/src-tauri/src/lib.rs
================================================================================
use std::sync::Mutex;

use tauri::Manager;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::{process::CommandChild, ShellExt};

struct BackendProcess(Mutex<Option<std::process::Child>>);

#[cfg(not(debug_assertions))]
struct BackendSidecarProcess(Mutex<Option<CommandChild>>);

#[tauri::command]
async fn pick_audio_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let folder = app.dialog().file().blocking_pick_folder();

    Ok(folder.map(|p| p.to_string()))
}

#[tauri::command]
async fn pick_audio_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let file = app
        .dialog()
        .file()
        .add_filter("Audio", &["mp3", "m4a", "flac", "wav", "ogg"])
        .blocking_pick_file();

    Ok(file.map(|p| p.to_string()))
}

#[tauri::command]
async fn backend_health() -> Result<bool, String> {
    Ok(true)
}

fn start_backend_sidecar(app: &tauri::AppHandle) {
    #[cfg(debug_assertions)]
    {
        start_backend_in_dev(app);
    }

    #[cfg(not(debug_assertions))]
    {
        start_backend_in_release(app);
    }
}

fn stop_backend_sidecar(app: &tauri::AppHandle) {
    #[cfg(debug_assertions)]
    {
        let state = app.state::<BackendProcess>();
        let mut guard = match state.0.lock() {
            Ok(guard) => guard,
            Err(e) => {
                eprintln!("Failed to lock backend process state: {}", e);
                return;
            }
        };

        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
            println!("Python backend process stopped.");
        }
    }

    #[cfg(not(debug_assertions))]
    {
        let state = app.state::<BackendSidecarProcess>();
        let mut guard = match state.0.lock() {
            Ok(guard) => guard,
            Err(e) => {
                eprintln!("Failed to lock backend sidecar state: {}", e);
                return;
            }
        };

        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            println!("Backend sidecar stopped.");
        }
    }
}

#[cfg(debug_assertions)]
fn find_dev_python() -> std::path::PathBuf {
    use std::env;
    use std::path::PathBuf;

    if let Ok(value) = env::var("LOCAL_AUDIO_LIBRARY_PYTHON") {
        let value = value.trim();
        if !value.is_empty() {
            return PathBuf::from(value);
        }
    }

    if let Ok(venv) = env::var("VIRTUAL_ENV") {
        let python = if cfg!(windows) {
            PathBuf::from(venv).join("Scripts").join("python.exe")
        } else {
            PathBuf::from(venv).join("bin").join("python")
        };

        if python.exists() {
            return python;
        }
    }

    if cfg!(windows) {
        PathBuf::from("python")
    } else {
        PathBuf::from("python3")
    }
}

#[cfg(debug_assertions)]
fn start_backend_in_dev(app: &tauri::AppHandle) {
    use std::path::PathBuf;
    use std::process::{Command, Stdio};

    let state = app.state::<BackendProcess>();
    let mut guard = match state.0.lock() {
        Ok(guard) => guard,
        Err(e) => {
            eprintln!("Failed to lock backend process state: {}", e);
            return;
        }
    };

    if guard.is_some() {
        println!("Python backend is already marked as started.");
        return;
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let backend_script_raw = manifest_dir.join("../../backend/run.py");

    let backend_script = backend_script_raw
        .canonicalize()
        .unwrap_or(backend_script_raw);

    let backend_dir = backend_script
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| manifest_dir.clone());

    let python = find_dev_python();

    println!("Starting FastAPI backend in dev mode...");
    println!("  python: {}", python.display());
    println!("  script: {}", backend_script.display());
    println!("  cwd: {}", backend_dir.display());

    let child = Command::new(&python)
        .arg(&backend_script)
        .current_dir(&backend_dir)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn();

    match child {
        Ok(child) => {
            println!("Python backend process spawned.");
            *guard = Some(child);
        }
        Err(e) => {
            eprintln!("Failed to start Python backend in dev mode: {}", e);
            eprintln!();
            eprintln!("Try manually:");
            eprintln!("  {} {}", python.display(), backend_script.display());
            eprintln!();
            eprintln!("If dependencies are missing, run:");
            eprintln!(
                "  {} -m pip install fastapi uvicorn sqlmodel sqlalchemy mutagen httpx python-multipart",
                python.display()
            );
        }
    }
}

#[cfg(not(debug_assertions))]
fn start_backend_in_release(app: &tauri::AppHandle) {
    let state = app.state::<BackendSidecarProcess>();
    let mut guard = match state.0.lock() {
        Ok(guard) => guard,
        Err(e) => {
            eprintln!("Failed to lock backend sidecar state: {}", e);
            return;
        }
    };

    if guard.is_some() {
        println!("Backend sidecar is already marked as started.");
        return;
    }

    let shell = app.shell();

    let result = shell.sidecar("local-audio-backend");

    match result {
        Ok(cmd) => match cmd.spawn() {
            Ok((mut rx, child)) => {
                println!("Backend sidecar started.");
                *guard = Some(child);

                tauri::async_runtime::spawn(async move {
                    while let Some(event) = rx.recv().await {
                        println!("Backend sidecar event: {:?}", event);
                    }
                });
            }
            Err(e) => {
                eprintln!("Failed to spawn backend sidecar: {}", e);
            }
        },
        Err(e) => {
            eprintln!("Failed to create backend sidecar command: {}", e);
        }
    }
}

pub fn run() {
    let builder = tauri::Builder::default()
        .manage(BackendProcess(Mutex::new(None)))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init());

    #[cfg(not(debug_assertions))]
    let builder = builder.manage(BackendSidecarProcess(Mutex::new(None)));

    builder
        .invoke_handler(tauri::generate_handler![
            pick_audio_folder,
            pick_audio_file,
            backend_health
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            start_backend_sidecar(&handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let handle = window.app_handle();
                stop_backend_sidecar(&handle);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


================================================================================
文件: frontend/src-tauri/src/main.rs
================================================================================
fn main() {
    local_audio_library_lib::run()
}

================================================================================
文件: frontend/src-tauri/tauri.conf.json
================================================================================
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Local Audio Library",
  "version": "0.1.0",
  "identifier": "com.local.audio.library",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://127.0.0.1:5173",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "Local Audio Library",
        "width": 1280,
        "height": 800,
        "minWidth": 1000,
        "minHeight": 700,
        "resizable": true,
        "fullscreen": false
      }
    ],
    "security": {
      "csp": "default-src 'self'; connect-src 'self' http://127.0.0.1:* http://localhost:*; media-src 'self' http://127.0.0.1:* http://localhost:* blob:; img-src 'self' asset: http://127.0.0.1:* http://localhost:* data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'"
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "externalBin": [
      "binaries/local-audio-backend"
    ],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "resources": []
  }
}


================================================================================
文件: frontend/tsconfig.json
================================================================================
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["DOM", "DOM.Iterable", "ES2020"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": false,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src"]
}


================================================================================
文件: frontend/vite.config.ts
================================================================================
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function isIgnoredByViteWatcher(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");

  return (
    normalized.includes("/src-tauri/target/") ||
    normalized.endsWith("/src-tauri/target") ||
    normalized.includes("/src-tauri/.cargo/") ||
    normalized.endsWith("/src-tauri/.cargo")
  );
}

export default defineConfig({
  plugins: [react()],

  // 保留 Rust / Python 后端日志，不要被 Vite 清屏
  clearScreen: false,

  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,

    watch: {
      // 关键：不要让 Vite 监听 Rust 编译产物，否则 Windows 下容易 EBUSY
      ignored: isIgnoredByViteWatcher
    }
  }
});


================================================================================
文件: README.md
================================================================================
# Local Audio Library
