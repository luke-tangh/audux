import csv
import io
import json
import mimetypes
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import (
    FastAPI,
    Depends,
    HTTPException,
    BackgroundTasks,
    UploadFile,
    File,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, PlainTextResponse
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
    PlaylistCreate,
    PlaylistItemAdd,
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

app = FastAPI(title="Local Audio Library API", version="0.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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


@app.on_event("startup")
async def on_startup():
    create_db_and_tables()
    start_worker_once()
    logger.info("Local Audio Library backend started")


@app.get("/health")
def health():
    return {"status": "ok"}


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
        return None

    return stmt.where(AudioItem.library_root_id.in_(enabled_root_ids))


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
    ms = int((seconds - int(seconds)) * 1000)
    total = int(seconds)
    s = total % 60
    m = (total // 60) % 60
    h = total // 3600
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _cover_media_type(path: Path) -> str:
    guessed = mimetypes.guess_type(str(path))[0]
    return guessed or "image/jpeg"


def _audio_to_export_dict(session: Session, audio: AudioItem) -> dict:
    tags = session.exec(
        select(Tag)
        .join(AudioTag, AudioTag.tag_id == Tag.id)
        .where(AudioTag.audio_id == audio.id)
        .order_by(Tag.name)
    ).all()

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
    limit: int = 50,
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
    limit: int = 100,
    offset: int = 0,
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
    return session.exec(stmt).all()


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

        if audio.transcript_status in ["pending", "running"]:
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

    created = []
    skipped = []
    errors = []

    for audio_id in payload.audio_ids:
        audio = session.get(AudioItem, audio_id)
        if not audio:
            errors.append({"audio_id": audio_id, "error": "Audio not found"})
            continue

        if audio.ai_status in ["pending", "running"]:
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
        "errors": errors,
        "tasks": created,
    }


@app.get("/audio-items/{audio_id}")
def get_audio_item(audio_id: int, session: Session = Depends(get_session)):
    item = session.get(AudioItem, audio_id)
    if not item:
        raise HTTPException(status_code=404, detail="Audio item not found")

    tags = session.exec(
        select(Tag)
        .join(AudioTag, AudioTag.tag_id == Tag.id)
        .where(AudioTag.audio_id == audio_id)
    ).all()

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

    session.commit()
    rebuild_audio_search_index(session, audio_id)
    return result


@app.delete("/audio-items/{audio_id}/tags/{tag_id}")
def remove_audio_tag(audio_id: int, tag_id: int, session: Session = Depends(get_session)):
    link = session.get(AudioTag, (audio_id, tag_id))
    if not link:
        raise HTTPException(status_code=404, detail="Audio tag relation not found")

    session.delete(link)
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
        "items": [{"playlist_item": pi, "audio": audio} for pi, audio in items],
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
    session.commit()
    session.refresh(item)
    return item


@app.delete("/playlists/{playlist_id}/items/{item_id}")
def remove_playlist_item(
    playlist_id: int,
    item_id: int,
    session: Session = Depends(get_session),
):
    item = session.get(PlaylistItem, item_id)
    if not item or item.playlist_id != playlist_id:
        raise HTTPException(status_code=404, detail="Playlist item not found")

    session.delete(item)
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
        session.commit()

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
    session.commit()
    session.refresh(transcript)

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

    rebuild_audio_search_index(session, audio_id)

    return transcript


# AI

@app.post("/audio-items/{audio_id}/analyze")
def enqueue_analyze(audio_id: int, session: Session = Depends(get_session)):
    audio = session.get(AudioItem, audio_id)
    if not audio:
        raise HTTPException(status_code=404, detail="Audio not found")

    endpoint = session.get(Setting, "llm.endpoint")
    model_name = session.get(Setting, "llm.model_name")

    if not endpoint or not endpoint.value or not model_name or not model_name.value:
        raise HTTPException(status_code=400, detail="LLM endpoint or model_name is not configured")

    audio.ai_status = "pending"
    audio.updated_at = now_iso()
    session.add(audio)
    session.commit()

    task = create_task(session, audio_id, "analyze")
    return task


@app.post("/ai/test-llm")
async def test_llm_config(payload: LLMConfig):
    if not payload.endpoint or not payload.model_name:
        raise HTTPException(status_code=400, detail="endpoint and model_name are required")

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

    task.status = "canceled"
    task.finished_at = now_iso()
    task.updated_at = now_iso()
    session.add(task)

    audio = session.get(AudioItem, task.audio_id)
    if audio:
        if task.task_type == "transcribe":
            audio.transcript_status = "canceled"
        if task.task_type == "analyze":
            audio.ai_status = "canceled"

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
    row_by_id = {row.id: row for row in rows}

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
            tags = session.exec(
                select(Tag)
                .join(AudioTag, AudioTag.tag_id == Tag.id)
                .where(AudioTag.audio_id == audio.id)
                .order_by(Tag.name)
            ).all()

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


@app.get("/logs/app")
def get_app_logs(lines: int = 300):
    return {
        "file": str(LOG_FILE),
        "content": read_log_tail(lines),
    }


@app.get("/logs/app/file")
def get_app_log_file():
    if not LOG_FILE.exists():
        raise HTTPException(status_code=404, detail="Log file not found")

    return FileResponse(str(LOG_FILE), media_type="text/plain", filename="app.log")
