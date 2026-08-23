"""Audio and cover file responses and managed cover mutations."""

from pathlib import Path

from fastapi.responses import FileResponse
from sqlmodel import Session

from ..db import COVERS_DIR
from ..logger import get_logger
from ..models import AudioItem, now_iso
from .errors import ServiceError
from .media_paths import (
    AUDIO_MIME_TYPES,
    IMAGE_EXTS,
    cover_media_type,
    delete_managed_cover_file,
)


logger = get_logger(__name__)


def get_audio_file_response(session: Session, audio_id: int) -> FileResponse:
    item = session.get(AudioItem, audio_id)
    if not item:
        raise ServiceError(404, "Audio item not found")
    path = Path(item.file_path)
    if not path.exists():
        item.is_missing = True
        session.add(item)
        session.commit()
        raise ServiceError(404, "Audio file missing")
    media_type = AUDIO_MIME_TYPES.get(path.suffix.lower(), "application/octet-stream")
    return FileResponse(str(path), media_type=media_type, filename=item.file_name)


def get_audio_cover_response(session: Session, audio_id: int) -> FileResponse:
    item = session.get(AudioItem, audio_id)
    if not item:
        raise ServiceError(404, "Audio item not found")
    if not item.cover_path:
        raise ServiceError(404, "Cover not found")
    path = Path(item.cover_path)
    if not path.exists():
        raise ServiceError(404, "Cover file missing")
    return FileResponse(str(path), media_type=cover_media_type(path))


def upload_audio_cover_data(
    session: Session,
    audio_id: int,
    original_name: str,
    content_type: str,
    data: bytes,
) -> AudioItem:
    item = session.get(AudioItem, audio_id)
    if not item:
        raise ServiceError(404, "Audio item not found")
    ext = Path(original_name or "").suffix.lower()
    if ext not in IMAGE_EXTS:
        ext = {
            "image/png": ".png",
            "image/jpeg": ".jpg",
            "image/jpg": ".jpg",
            "image/webp": ".webp",
        }.get(content_type, "")
        if not ext:
            raise ServiceError(400, "Unsupported image format")
    if not data:
        raise ServiceError(400, "Empty cover file")
    if len(data) > 10 * 1024 * 1024:
        raise ServiceError(400, "Cover file is too large")

    COVERS_DIR.mkdir(parents=True, exist_ok=True)
    for old in COVERS_DIR.glob(f"audio_{audio_id}.*"):
        try:
            old.unlink()
        except OSError:
            logger.warning("Failed to remove previous cover path=%s", old)
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


def delete_audio_cover(session: Session, audio_id: int) -> AudioItem:
    item = session.get(AudioItem, audio_id)
    if not item:
        raise ServiceError(404, "Audio item not found")
    if item.cover_path:
        delete_managed_cover_file(item.cover_path)
    item.cover_path = None
    item.cover_source = None
    item.updated_at = now_iso()
    session.add(item)
    session.commit()
    session.refresh(item)
    logger.info("Cover deleted audio_id=%s", audio_id)
    return item
