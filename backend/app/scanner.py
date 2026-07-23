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

SCAN_PROGRESS_INTERVAL = 25
MAX_COVER_BYTES = 10 * 1024 * 1024
INTERRUPTED_SCAN_STATUSES = {"pending", "running"}


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

    if len(data) > MAX_COVER_BYTES:
        logger.warning("Embedded cover is too large audio_id=%s bytes=%s", audio_id, len(data))
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


def _delete_managed_cover_file(path_value: Optional[str]):
    if not path_value:
        return

    try:
        cover_path = Path(path_value)
        if cover_path.exists() and cover_path.parent.resolve() == COVERS_DIR.resolve():
            cover_path.unlink()
    except Exception:
        pass


def extract_embedded_cover(path: Path, audio_id: int) -> Optional[dict]:
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


def _ensure_cover(session: Session, item: AudioItem, file_path: Path, force_refresh: bool = False):
    if item.id is None:
        return

    if item.cover_source == "user" and item.cover_path and Path(item.cover_path).exists():
        return

    changed = False

    if force_refresh and item.cover_source == "embedded":
        _delete_managed_cover_file(item.cover_path)
        item.cover_path = None
        item.cover_source = None
        changed = True
    elif item.cover_source == "embedded" and item.cover_path and Path(item.cover_path).exists():
        return

    cover = extract_embedded_cover(file_path, item.id)
    if cover:
        item.cover_path = cover["cover_path"]
        item.cover_source = cover["cover_source"]
        changed = True
    elif force_refresh and item.cover_source != "user":
        if item.cover_path or item.cover_source:
            _delete_managed_cover_file(item.cover_path)
            item.cover_path = None
            item.cover_source = None
            changed = True

    if changed:
        item.updated_at = now_iso()
        session.add(item)
        session.commit()


def _audio_file_changed(existing: AudioItem, stat, mtime: str) -> bool:
    if existing.file_size != stat.st_size:
        return True

    if existing.file_mtime != mtime:
        return True

    return False


def _touch_existing_without_metadata(existing: AudioItem, root_id: int) -> bool:
    changed = False

    if existing.is_missing:
        existing.is_missing = False
        changed = True

    if existing.library_root_id != root_id:
        existing.library_root_id = root_id
        changed = True

    if changed:
        existing.updated_at = now_iso()

    return changed


def _collect_audio_candidates(root_path: Path) -> list[Path]:
    candidates: list[Path] = []

    try:
        for p in root_path.rglob("*"):
            try:
                if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS:
                    candidates.append(p)
            except Exception as e:
                logger.warning("Failed to inspect scan candidate %s: %s", p, e)

    except Exception as e:
        logger.warning("Failed to enumerate library root %s: %s", root_path, e)

    return candidates


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

    candidates = _collect_audio_candidates(root_path)

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

        try:
            resolved = str(file_path.resolve())
            stat = file_path.stat()
        except Exception as e:
            logger.warning("Skipping unavailable audio file %s: %s", file_path, e)
            processed += 1

            if processed % SCAN_PROGRESS_INTERVAL == 0:
                _update_scan_task(
                    session,
                    scan_task_id,
                    processed_files=processed,
                    imported=imported,
                    updated=updated,
                    missing=missing,
                )

            continue

        found_paths.add(resolved)
        existing = session.exec(
            select(AudioItem).where(AudioItem.file_path == resolved)
        ).first()

        mtime = datetime.utcfromtimestamp(stat.st_mtime).isoformat()

        if existing:
            if _audio_file_changed(existing, stat, mtime):
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

                _ensure_cover(session, existing, file_path, force_refresh=True)
                rebuild_audio_search_index(session, existing.id)

                updated += 1
            else:
                touched = _touch_existing_without_metadata(existing, root.id)
                if touched:
                    session.add(existing)
                    updated += 1

                if (
                    existing.cover_source != "user"
                    and (not existing.cover_path or not Path(existing.cover_path).exists())
                ):
                    session.commit()
                    _ensure_cover(session, existing, file_path)

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

        if processed % SCAN_PROGRESS_INTERVAL == 0:
            _update_scan_task(
                session,
                scan_task_id,
                processed_files=processed,
                imported=imported,
                updated=updated,
                missing=missing,
            )

    session.commit()

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
            if not item.is_missing:
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


def recover_interrupted_scan_tasks() -> int:
    """
    FastAPI BackgroundTasks are in-process. If backend exits during a scan,
    pending/running scan_tasks cannot resume automatically, so mark them failed
    with an explicit recovery message.
    """
    recovered = 0

    with Session(engine) as session:
        tasks = session.exec(
            select(ScanTask).where(ScanTask.status.in_(list(INTERRUPTED_SCAN_STATUSES)))
        ).all()

        for task in tasks:
            task.status = "failed"
            task.error_message = task.error_message or "Scan interrupted by backend restart"
            task.finished_at = task.finished_at or now_iso()
            task.updated_at = now_iso()
            session.add(task)
            recovered += 1

        if recovered:
            session.commit()
            logger.warning("Recovered interrupted scan tasks count=%s", recovered)

    return recovered


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
