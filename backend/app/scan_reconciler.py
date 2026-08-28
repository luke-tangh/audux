from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

from sqlmodel import Session, select

from .logger import get_logger
from .media_probe import (
    extract_embedded_cover,
    read_audio_metadata,
    safe_calculate_file_hash,
)
from .models import AudioItem, now_iso
from .search import rebuild_audio_search_index
from .time_utils import utc_timestamp_iso
from .services.media_paths import delete_managed_cover_file


logger = get_logger(__name__)


@dataclass(frozen=True)
class CandidateReconciliation:
    resolved_path: str | None
    imported: int = 0
    updated: int = 0


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


def _ensure_cover(session: Session, item: AudioItem, file_path: Path, force_refresh: bool = False):
    if item.id is None:
        return

    if item.cover_source == "user" and item.cover_path and Path(item.cover_path).exists():
        return

    changed = False

    if force_refresh and item.cover_source == "embedded":
        delete_managed_cover_file(item.cover_path)
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
            delete_managed_cover_file(item.cover_path)
            item.cover_path = None
            item.cover_source = None
            changed = True

    if changed:
        item.updated_at = now_iso()
        session.add(item)
        session.commit()


def _commit_audio_with_search_index(session: Session, item: AudioItem) -> None:
    """Commit audio metadata and its FTS projection as one transaction."""
    session.add(item)
    try:
        session.flush()
        rebuild_audio_search_index(session, int(item.id), commit=False)
        session.commit()
        session.refresh(item)
    except Exception:
        session.rollback()
        raise


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

    _commit_audio_with_search_index(session, item)

    # 同一 hash 通常表示同一文件，封面无需强制刷新；
    # 但如果旧封面缺失，则尝试重新提取。
    _ensure_cover(session, item, file_path, force_refresh=False)

    logger.info(
        "Detected moved audio by file_hash id=%s old_path=%s new_path=%s hash=%s",
        item.id,
        old_path,
        resolved_path,
        file_hash[:16],
    )


def reconcile_audio_candidate(
    session: Session,
    *,
    root_id: int,
    root_path: Path,
    candidate: Path,
    hash_strategy: str,
) -> CandidateReconciliation:
    try:
        file_path = candidate.resolve(strict=True)
        file_path.relative_to(root_path)
        stat = file_path.stat()
    except ValueError:
        logger.warning(
            "Skipping audio candidate outside library root root=%s candidate=%s",
            root_path,
            candidate,
        )
        return CandidateReconciliation(None)
    except OSError as error:
        logger.warning("Skipping unavailable audio file %s: %s", candidate, error)
        return CandidateReconciliation(None)

    resolved = str(file_path)
    existing = session.exec(
        select(AudioItem).where(AudioItem.file_path == resolved)
    ).first()
    mtime = utc_timestamp_iso(stat.st_mtime)

    if existing:
        file_changed = _audio_file_changed(existing, stat, mtime)
        file_hash = (
            safe_calculate_file_hash(
                file_path,
                strategy=hash_strategy,
                file_size=stat.st_size,
            )
            if file_changed or not existing.file_hash
            else existing.file_hash
        )

        if file_changed:
            existing.file_size = stat.st_size
            existing.file_mtime = mtime
            existing.file_hash = file_hash
            existing.is_missing = False
            existing.library_root_id = root_id
            existing.updated_at = now_iso()
            for key, value in read_audio_metadata(file_path).items():
                setattr(existing, key, value)
            _commit_audio_with_search_index(session, existing)
            _ensure_cover(session, existing, file_path, force_refresh=True)
            return CandidateReconciliation(resolved, updated=1)

        touched = _touch_existing_without_metadata(existing, root_id)
        if not existing.file_hash and file_hash:
            existing.file_hash = file_hash
            existing.updated_at = now_iso()
            touched = True
        if touched:
            session.add(existing)
            session.commit()
        if (
            existing.cover_source != "user"
            and (not existing.cover_path or not Path(existing.cover_path).exists())
        ):
            _ensure_cover(session, existing, file_path)
        return CandidateReconciliation(resolved, updated=int(touched))

    file_hash = safe_calculate_file_hash(
        file_path,
        strategy=hash_strategy,
        file_size=stat.st_size,
    )
    moved_item = (
        _find_moved_audio_by_hash(
            session=session,
            file_hash=file_hash,
            resolved_path=resolved,
            root_id=root_id,
            file_size=stat.st_size,
        )
        if file_hash
        else None
    )
    if moved_item and file_hash:
        _relocate_audio_item_by_hash(
            session=session,
            item=moved_item,
            resolved_path=resolved,
            file_path=file_path,
            stat=stat,
            mtime=mtime,
            root_id=root_id,
            file_hash=file_hash,
        )
        return CandidateReconciliation(resolved, updated=1)

    item = AudioItem(
        file_path=resolved,
        file_name=file_path.name,
        file_ext=file_path.suffix.lower(),
        file_size=stat.st_size,
        file_mtime=mtime,
        file_hash=file_hash,
        library_root_id=root_id,
        **read_audio_metadata(file_path),
    )
    _commit_audio_with_search_index(session, item)
    _ensure_cover(session, item, file_path)
    return CandidateReconciliation(resolved, imported=1)


def reconcile_missing_items(
    session: Session,
    *,
    root_id: int,
    found_paths: set[str],
    should_cancel: Callable[[int], bool],
) -> tuple[int, bool]:
    missing = 0
    items = session.exec(
        select(AudioItem).where(AudioItem.library_root_id == root_id)
    ).all()
    for index, item in enumerate(items):
        if should_cancel(index):
            return missing, True
        if item.file_path not in found_paths and not item.is_missing:
            item.is_missing = True
            item.updated_at = now_iso()
            session.add(item)
            missing += 1
    return missing, False
