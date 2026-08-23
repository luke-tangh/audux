import mimetypes
from pathlib import Path

from sqlmodel import Session, select

from ..db import COVERS_DIR
from ..models import AudioItem, LibraryRoot, now_iso


AUDIO_MIME_TYPES = {
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".flac": "audio/flac",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
}

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def find_library_root_id_for_path(session: Session, file_path: Path) -> int | None:
    resolved_file = file_path.expanduser().resolve()
    roots = session.exec(select(LibraryRoot)).all()

    best_root_id: int | None = None
    best_len = -1

    for root in roots:
        if root.id is None:
            continue

        try:
            root_path = Path(root.path).expanduser().resolve()
            resolved_file.relative_to(root_path)
        except (OSError, RuntimeError, ValueError):
            continue

        root_len = len(str(root_path))
        if root_len > best_len:
            best_root_id = root.id
            best_len = root_len

    return best_root_id


def mark_audio_missing_if_unavailable_no_commit(
    session: Session,
    audio: AudioItem,
) -> bool:
    path = Path(audio.file_path)
    available = path.exists() and path.is_file()

    if audio.is_missing == available:
        audio.is_missing = not available
        audio.updated_at = now_iso()
        session.add(audio)

    return available


def mark_audio_missing_if_unavailable(session: Session, audio: AudioItem) -> bool:
    available = mark_audio_missing_if_unavailable_no_commit(session, audio)
    if session.is_modified(audio):
        session.commit()
        session.refresh(audio)
    return available


def cover_media_type(path: Path) -> str:
    guessed = mimetypes.guess_type(str(path))[0]
    return guessed or "image/jpeg"


def delete_managed_cover_file(path_value: str | None) -> None:
    if not path_value:
        return

    try:
        cover_path = Path(path_value)
        if cover_path.exists() and cover_path.parent.resolve() == COVERS_DIR.resolve():
            cover_path.unlink()
    except OSError:
        pass
