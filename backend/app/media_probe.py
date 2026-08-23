import base64
import hashlib
from pathlib import Path
from typing import Optional

from mutagen import File as MutagenFile
from sqlmodel import Session

from .db import COVERS_DIR
from .logger import get_logger
from .settings_reader import get_setting


logger = get_logger(__name__)

SUPPORTED_EXTS = {".mp3", ".m4a", ".flac", ".wav", ".ogg"}
MAX_COVER_BYTES = 10 * 1024 * 1024
HASH_CHUNK_SIZE = 1024 * 1024
SAMPLED_HASH_PREFIX = "sampled:v1:"
SAMPLED_HASH_CHUNK_SIZE = 1024 * 1024
SUPPORTED_HASH_STRATEGIES = {"sampled", "full"}


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


def calculate_file_hash(path: Path) -> str:
    """
    计算音频文件内容 SHA-256。

    注意：
    - full SHA-256 精确但需要读取完整音频文件。
    - PR3 默认扫描策略改为 sampled fingerprint，以改善大资料库扫描性能。
    - 若 setting scanner.hash_strategy = full，则仍会调用本函数。
    """
    digest = hashlib.sha256()

    with path.open("rb") as f:
        while True:
            chunk = f.read(HASH_CHUNK_SIZE)
            if not chunk:
                break

            digest.update(chunk)

    return digest.hexdigest()


def calculate_sampled_file_hash(path: Path, file_size: Optional[int] = None) -> str:
    """
    计算采样 fingerprint。

    读取文件头 / 中 / 尾若干块，并把 file_size、offset 纳入 hash。
    目标是在保留移动检测可用性的同时，避免对大文件全量读取。

    返回值带 prefix，便于和 full SHA-256 策略区分。
    """
    if file_size is None:
        file_size = path.stat().st_size

    digest = hashlib.sha256()
    digest.update(b"audux-sampled-hash-v1")
    digest.update(str(file_size).encode("utf-8"))

    if file_size <= 0:
        return SAMPLED_HASH_PREFIX + digest.hexdigest()

    chunk_size = min(SAMPLED_HASH_CHUNK_SIZE, file_size)

    positions = {
        0,
        max(0, file_size // 2 - chunk_size // 2),
        max(0, file_size - chunk_size),
    }

    with path.open("rb") as f:
        for pos in sorted(positions):
            f.seek(pos)
            chunk = f.read(chunk_size)
            digest.update(str(pos).encode("utf-8"))
            digest.update(chunk)

    return SAMPLED_HASH_PREFIX + digest.hexdigest()


def get_scan_hash_strategy(session: Session) -> str:
    value = (get_setting(session, "scanner.hash_strategy", "sampled") or "sampled").strip().lower()

    if value not in SUPPORTED_HASH_STRATEGIES:
        return "sampled"

    return value

def calculate_file_fingerprint(
    path: Path,
    strategy: str = "sampled",
    file_size: Optional[int] = None,
) -> str:
    strategy = strategy if strategy in SUPPORTED_HASH_STRATEGIES else "sampled"

    if strategy == "full":
        return calculate_file_hash(path)

    return calculate_sampled_file_hash(path, file_size=file_size)


def safe_calculate_file_hash(
    path: Path,
    strategy: str = "sampled",
    file_size: Optional[int] = None,
) -> Optional[str]:
    try:
        return calculate_file_fingerprint(
            path,
            strategy=strategy,
            file_size=file_size,
        )
    except Exception as e:
        logger.warning("Failed to calculate file hash for %s: %s", path, e)
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


def save_cover_bytes(audio_id: int, data: bytes, mime: Optional[str]) -> Optional[str]:
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

        cover_path = save_cover_bytes(audio_id, data, mime)
        if not cover_path:
            return None

        return {
            "cover_path": cover_path,
            "cover_source": "embedded",
        }

    except Exception as e:
        logger.warning("Failed to extract cover for %s: %s", path, e)
        return None
