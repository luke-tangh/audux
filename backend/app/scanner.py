import base64
import hashlib
from pathlib import Path
from typing import Optional

from sqlmodel import Session, select
from mutagen import File as MutagenFile

from .db import COVERS_DIR, engine
from .models import AudioItem, LibraryRoot, ScanTask, Setting, now_iso
from .search import rebuild_audio_search_index
from .logger import get_logger
from .time_utils import utc_timestamp_iso
from .services.common import error_code_for_detail

logger = get_logger(__name__)

SUPPORTED_EXTS = {".mp3", ".m4a", ".flac", ".wav", ".ogg"}

SCAN_PROGRESS_INTERVAL = 25
MAX_COVER_BYTES = 10 * 1024 * 1024
HASH_CHUNK_SIZE = 1024 * 1024

# PR3: 默认使用采样 fingerprint，避免大库扫描时对每个音频都读取完整文件。
# 如果需要完全精确的 SHA-256，可把 setting scanner.hash_strategy 设置为 full。
SAMPLED_HASH_PREFIX = "sampled:v1:"
SAMPLED_HASH_CHUNK_SIZE = 1024 * 1024
SUPPORTED_HASH_STRATEGIES = {"sampled", "full"}

INTERRUPTED_SCAN_STATUSES = {"pending", "running", "cancel_requested"}


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


def _get_scan_hash_strategy(session: Session) -> str:
    row = session.get(Setting, "scanner.hash_strategy")
    value = (row.value if row else "sampled").strip().lower()

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


def _safe_calculate_file_hash(
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


def _same_audio_path(left: str, right: str) -> bool:
    try:
        return Path(left).expanduser().resolve() == Path(right).expanduser().resolve()
    except Exception:
        return left == right


def _path_points_to_available_file(path_value: str) -> bool:
    try:
        path = Path(path_value)
        return path.exists() and path.is_file()
    except Exception:
        return False


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

    next_status = kwargs.get("status")

    # Do not let a stale worker overwrite a user cancel request back to running.
    if next_status == "running" and task.status in {
        "canceled",
        "cancel_requested",
        "done",
        "failed",
    }:
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
    return bool(task and task.status in {"canceled", "cancel_requested"})


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


def _iter_audio_candidates(root_path: Path):
    """
    Streaming audio candidate iterator.

    Avoids materializing the whole library tree before processing. This reduces
    memory usage on large libraries and lets scan cancellation be observed while
    enumeration is still in progress.
    """
    try:
        for p in root_path.rglob("*"):
            try:
                if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS:
                    yield p
            except Exception as e:
                logger.warning("Failed to inspect scan candidate %s: %s", p, e)

    except Exception as e:
        logger.warning("Failed to enumerate library root %s: %s", root_path, e)


def _find_moved_audio_by_hash(
    session: Session,
    file_hash: Optional[str],
    resolved_path: str,
    root_id: int,
    file_size: int,
) -> Optional[AudioItem]:
    """
    根据 file_hash 查找可能被移动的旧记录。

    只匹配“旧路径当前不可用”的记录，避免把正常存在的重复文件误判为移动。
    典型场景：
    - 旧记录：/old/path/a.mp3，file_hash = xxx，但该路径已不存在
    - 新扫描：/new/path/a.mp3，hash 同为 xxx
    - 结果：更新旧记录 file_path，而不是创建新 AudioItem
    """
    if not file_hash:
        return None

    rows = session.exec(
        select(AudioItem).where(AudioItem.file_hash == file_hash)
    ).all()

    candidates: list[AudioItem] = []

    for item in rows:
        if item.id is None:
            continue

        if _same_audio_path(item.file_path, resolved_path):
            continue

        # hash 相同理论上已足够；size 作为额外保护，避免脏数据或极端碰撞。
        if item.file_size is not None and item.file_size != file_size:
            continue

        # 如果旧路径还存在，视为重复副本，不当作移动。
        if _path_points_to_available_file(item.file_path):
            continue

        candidates.append(item)

    if not candidates:
        return None

    candidates.sort(
        key=lambda item: (
            0 if item.library_root_id == root_id else 1,
            0 if item.is_missing else 1,
            item.updated_at or "",
        )
    )

    return candidates[0]


def _relocate_audio_item_by_hash(
    session: Session,
    item: AudioItem,
    resolved_path: str,
    file_path: Path,
    stat,
    mtime: str,
    root_id: int,
    file_hash: str,
):
    """
    将旧 AudioItem 记录迁移到新路径。

    保留：
    - 用户编辑字段
    - tags
    - playlist 关系
    - transcript
    - AI task 历史
    - 播放计数和播放位置
    """
    old_path = item.file_path

    item.file_path = resolved_path
    item.file_name = file_path.name
    item.file_ext = file_path.suffix.lower()
    item.file_size = stat.st_size
    item.file_mtime = mtime
    item.file_hash = file_hash
    item.library_root_id = root_id
    item.is_missing = False

    meta = read_audio_metadata(file_path)
    for key, value in meta.items():
        setattr(item, key, value)

    item.updated_at = now_iso()

    session.add(item)
    session.commit()
    session.refresh(item)

    # 同一 hash 通常表示同一文件，封面无需强制刷新；
    # 但如果旧封面缺失，则尝试重新提取。
    _ensure_cover(session, item, file_path, force_refresh=False)

    if item.id is not None:
        rebuild_audio_search_index(session, item.id)

    logger.info(
        "Detected moved audio by file_hash id=%s old_path=%s new_path=%s hash=%s",
        item.id,
        old_path,
        resolved_path,
        file_hash[:16],
    )


def scan_library_root(session: Session, root_id: int, scan_task_id: Optional[int] = None) -> dict:
    root = session.get(LibraryRoot, root_id)
    if not root:
        raise ValueError("Library root not found")

    root_path = Path(root.path).expanduser().resolve()
    if not root_path.exists() or not root_path.is_dir():
        raise ValueError("Invalid library root path")

    if _is_scan_canceled(session, scan_task_id):
        _update_scan_task(
            session,
            scan_task_id,
            status="canceled",
            finished_at=now_iso(),
        )
        return {
            "imported": 0,
            "updated": 0,
            "missing": 0,
        }

    hash_strategy = _get_scan_hash_strategy(session)

    imported = 0
    updated = 0
    missing = 0
    processed = 0
    discovered = 0
    found_paths: set[str] = set()
    canceled = False

    # Set running before filesystem enumeration so a cancel request made during
    # large-directory walking cannot be overwritten later.
    _update_scan_task(
        session,
        scan_task_id,
        status="running",
        started_at=now_iso(),
        total_files=0,
        processed_files=0,
        imported=0,
        updated=0,
        missing=0,
        error_message=None,
    )

    logger.info(
        "Scanning root %s, hash_strategy=%s",
        root.path,
        hash_strategy,
    )

    def update_progress(force: bool = False):
        if not scan_task_id:
            return

        if not force and processed % SCAN_PROGRESS_INTERVAL != 0:
            return

        _update_scan_task(
            session,
            scan_task_id,
            total_files=discovered,
            processed_files=processed,
            imported=imported,
            updated=updated,
            missing=missing,
        )

    for file_path in _iter_audio_candidates(root_path):
        discovered += 1

        if _is_scan_canceled(session, scan_task_id):
            canceled = True
            break

        try:
            resolved = str(file_path.resolve())
            stat = file_path.stat()
        except Exception as e:
            logger.warning("Skipping unavailable audio file %s: %s", file_path, e)
            processed += 1
            update_progress()
            continue

        found_paths.add(resolved)
        existing = session.exec(
            select(AudioItem).where(AudioItem.file_path == resolved)
        ).first()

        mtime = utc_timestamp_iso(stat.st_mtime)

        if existing:
            file_changed = _audio_file_changed(existing, stat, mtime)

            if file_changed or not existing.file_hash:
                file_hash = _safe_calculate_file_hash(
                    file_path,
                    strategy=hash_strategy,
                    file_size=stat.st_size,
                )
            else:
                file_hash = existing.file_hash

            if file_changed:
                existing.file_size = stat.st_size
                existing.file_mtime = mtime
                existing.file_hash = file_hash
                existing.is_missing = False
                existing.library_root_id = root.id
                existing.updated_at = now_iso()

                meta = read_audio_metadata(file_path)
                for key, value in meta.items():
                    setattr(existing, key, value)

                session.add(existing)
                session.commit()
                session.refresh(existing)

                _ensure_cover(session, existing, file_path, force_refresh=True)
                rebuild_audio_search_index(session, existing.id)

                updated += 1
            else:
                touched = _touch_existing_without_metadata(existing, root.id)

                if not existing.file_hash and file_hash:
                    existing.file_hash = file_hash
                    existing.updated_at = now_iso()
                    touched = True

                if touched:
                    session.add(existing)
                    session.commit()
                    updated += 1

                if (
                    existing.cover_source != "user"
                    and (not existing.cover_path or not Path(existing.cover_path).exists())
                ):
                    _ensure_cover(session, existing, file_path)

        else:
            file_hash = _safe_calculate_file_hash(
                file_path,
                strategy=hash_strategy,
                file_size=stat.st_size,
            )

            moved_item = None
            if file_hash:
                moved_item = _find_moved_audio_by_hash(
                    session=session,
                    file_hash=file_hash,
                    resolved_path=resolved,
                    root_id=root.id,
                    file_size=stat.st_size,
                )

            if moved_item and file_hash:
                _relocate_audio_item_by_hash(
                    session=session,
                    item=moved_item,
                    resolved_path=resolved,
                    file_path=file_path,
                    stat=stat,
                    mtime=mtime,
                    root_id=root.id,
                    file_hash=file_hash,
                )

                updated += 1
            else:
                meta = read_audio_metadata(file_path)

                item = AudioItem(
                    file_path=resolved,
                    file_name=file_path.name,
                    file_ext=file_path.suffix.lower(),
                    file_size=stat.st_size,
                    file_mtime=mtime,
                    file_hash=file_hash,
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
        update_progress()

    session.commit()

    if canceled or _is_scan_canceled(session, scan_task_id):
        _update_scan_task(
            session,
            scan_task_id,
            status="canceled",
            total_files=discovered,
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

    for index, item in enumerate(items):
        if index % SCAN_PROGRESS_INTERVAL == 0 and _is_scan_canceled(session, scan_task_id):
            canceled = True
            break

        if item.file_path not in found_paths:
            if not item.is_missing:
                item.is_missing = True
                item.updated_at = now_iso()
                session.add(item)
                missing += 1

    if canceled:
        session.rollback()

        _update_scan_task(
            session,
            scan_task_id,
            status="canceled",
            total_files=discovered,
            processed_files=processed,
            imported=imported,
            updated=updated,
            missing=missing,
            finished_at=now_iso(),
        )

        logger.info(
            "Scan canceled during missing reconciliation root=%s imported=%s updated=%s missing=%s",
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

    session.commit()

    _update_scan_task(
        session,
        scan_task_id,
        status="done",
        total_files=discovered,
        processed_files=processed,
        imported=imported,
        updated=updated,
        missing=missing,
        finished_at=now_iso(),
    )

    logger.info(
        "Scan done root=%s files=%s imported=%s updated=%s missing=%s",
        root.path,
        discovered,
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
            if task.status == "cancel_requested":
                task.status = "canceled"
            else:
                task.status = "failed"
                task.error_message = task.error_message or "Scan interrupted by backend restart"
                task.error_code = task.error_code or "scan.interrupted"
                task.error_params = task.error_params or "{}"

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
                task.error_code = error_code_for_detail(str(e))
                task.error_params = "{}"
                task.finished_at = now_iso()
                task.updated_at = now_iso()
                session.add(task)
                session.commit()
