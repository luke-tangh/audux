from pathlib import Path
from typing import Optional
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlmodel import Session, select
from sqlalchemy import text, func, or_, and_

from .db import create_db_and_tables, get_session
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
    now_iso,
)
from .schemas import (
    LibraryRootCreate,
    LibraryRootUpdate,
    AudioUpdate,
    PlaybackPositionUpdate,
    TagsAddRequest,
    PlaylistCreate,
    PlaylistItemAdd,
    TranscriptCreate,
    SettingUpdate,
)
from .scanner import scan_library_root
from .search import rebuild_audio_search_index, search_audio_ids
from .tasks import create_task, start_worker_once


app = FastAPI(title="Local Audio Library API", version="0.1.0")

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


@app.on_event("startup")
async def on_startup():
    create_db_and_tables()
    start_worker_once()


@app.get("/health")
def health():
    return {"status": "ok"}


def _apply_enabled_roots_filter(
    stmt,
    session: Session,
    include_disabled_roots: bool = False,
):
    """
    默认音频库只展示启用状态的 LibraryRoot 下的音频。
    """
    if include_disabled_roots:
        return stmt

    enabled_root_ids = session.exec(
        select(LibraryRoot.id).where(LibraryRoot.is_enabled == True)
    ).all()

    if not enabled_root_ids:
        return None

    return stmt.where(AudioItem.library_root_id.in_(enabled_root_ids))


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
    return root


@app.post("/library-roots/{root_id}/scan")
def scan_root(root_id: int, session: Session = Depends(get_session)):
    try:
        return scan_library_root(session, root_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


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

    audio.ai_status = "pending"
    audio.updated_at = now_iso()
    session.add(audio)
    session.commit()

    task = create_task(session, audio_id, "analyze")
    return task


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
    task.started_at = None
    task.finished_at = None
    task.updated_at = now_iso()
    session.add(task)
    session.commit()
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
