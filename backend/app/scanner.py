from pathlib import Path
from typing import Optional
from datetime import datetime
from sqlmodel import Session, select
from mutagen import File as MutagenFile

from .models import AudioItem, LibraryRoot, now_iso
from .search import rebuild_audio_search_index

SUPPORTED_EXTS = {".mp3", ".m4a", ".flac", ".wav", ".ogg"}


def _tag_first(tags, keys: list[str]) -> Optional[str]:
    if not tags:
        return None

    for key in keys:
        value = tags.get(key)
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

    except Exception:
        pass

    return metadata


def scan_library_root(session: Session, root_id: int) -> dict:
    root = session.get(LibraryRoot, root_id)
    if not root:
        raise ValueError("Library root not found")

    root_path = Path(root.path).expanduser().resolve()
    if not root_path.exists() or not root_path.is_dir():
        raise ValueError("Invalid library root path")

    found_paths = set()
    imported = 0
    updated = 0

    for file_path in root_path.rglob("*"):
        if not file_path.is_file():
            continue

        if file_path.suffix.lower() not in SUPPORTED_EXTS:
            continue

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
            existing.updated_at = now_iso()
            session.add(existing)
            session.commit()
            rebuild_audio_search_index(session, existing.id)
            updated += 1
            continue

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

        rebuild_audio_search_index(session, item.id)
        imported += 1

    items = session.exec(
        select(AudioItem).where(AudioItem.library_root_id == root.id)
    ).all()

    missing = 0
    for item in items:
        if item.file_path not in found_paths:
            item.is_missing = True
            item.updated_at = now_iso()
            session.add(item)
            missing += 1

    session.commit()

    return {
        "imported": imported,
        "updated": updated,
        "missing": missing,
    }
