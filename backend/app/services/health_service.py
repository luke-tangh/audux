import hashlib
import json
from collections import defaultdict
from pathlib import Path

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from ..logger import get_logger
from ..models import (
    AudioItem,
    AudioTag,
    LibraryHealthTask,
    LibraryRoot,
    Playlist,
    PlaylistItem,
    ScanTask,
    Transcript,
    TranscriptSegment,
    now_iso,
)
from ..scanner import (
    HASH_CHUNK_SIZE,
    SAMPLED_HASH_PREFIX,
    SUPPORTED_EXTS,
    calculate_file_fingerprint,
    read_audio_metadata,
)
from ..search import rebuild_audio_search_index
from ..time_utils import utc_timestamp_iso
from .common import ServiceError


logger = get_logger(__name__)

ACTIVE_HEALTH_STATUSES = {"pending", "running", "cancel_requested"}
KNOWN_AUDIO_EXTS = SUPPORTED_EXTS | {
    ".aac",
    ".aiff",
    ".alac",
    ".amr",
    ".ape",
    ".caf",
    ".mka",
    ".opus",
    ".wma",
}
MAX_UNSUPPORTED_EXAMPLES = 8
MAX_DUPLICATE_GROUPS = 100
MAX_MISSING_ITEMS = 200


def _parse_json(value: str | None, fallback):
    if not value:
        return fallback
    try:
        parsed = json.loads(value)
        return parsed
    except (TypeError, ValueError):
        return fallback


def _serialize_task(task: LibraryHealthTask) -> dict:
    return {
        **task.model_dump(exclude={"input_json", "result_json"}),
        "input": _parse_json(task.input_json, {}),
        "result": _parse_json(task.result_json, None),
    }


def serialize_health_task(task: LibraryHealthTask) -> dict:
    return _serialize_task(task)


def list_health_tasks(session: Session, limit: int = 20) -> list[dict]:
    rows = session.exec(
        select(LibraryHealthTask)
        .order_by(LibraryHealthTask.created_at.desc(), LibraryHealthTask.id.desc())
        .limit(limit)
    ).all()
    return [_serialize_task(row) for row in rows]


def _active_task(session: Session, task_type: str) -> LibraryHealthTask | None:
    return session.exec(
        select(LibraryHealthTask)
        .where(LibraryHealthTask.task_type == task_type)
        .where(LibraryHealthTask.status.in_(list(ACTIVE_HEALTH_STATUSES)))
        .order_by(LibraryHealthTask.created_at)
    ).first()


def create_health_task(
    session: Session,
    task_type: str = "health_check",
    audio_ids: list[int] | None = None,
) -> LibraryHealthTask:
    if task_type not in {"health_check", "duplicate_hash"}:
        raise ServiceError(400, "Unsupported library health task type", "health.task_type")
    active = _active_task(session, task_type)
    if active:
        raise ServiceError(
            409,
            "Library health task is already active",
            "health.task_active",
            {"task_id": active.id, "task_type": task_type},
        )
    unique_audio_ids = list(dict.fromkeys(audio_ids or []))
    if task_type == "duplicate_hash" and len(unique_audio_ids) < 2:
        raise ServiceError(
            400,
            "At least two audio items are required",
            "health.hash_minimum",
        )
    task = LibraryHealthTask(
        task_type=task_type,
        input_json=json.dumps({"audio_ids": unique_audio_ids}, separators=(",", ":")),
        total_items=len(unique_audio_ids),
    )
    session.add(task)
    try:
        session.commit()
        session.refresh(task)
    except IntegrityError as error:
        session.rollback()
        raise ServiceError(
            409,
            "Library health task is already active",
            "health.task_active",
        ) from error
    return task


def cancel_health_task(session: Session, task_id: int) -> dict:
    task = session.get(LibraryHealthTask, task_id)
    if not task:
        raise ServiceError(404, "Library health task not found", "health.task_not_found")
    if task.status not in ACTIVE_HEALTH_STATUSES:
        raise ServiceError(400, "Library health task cannot be canceled", "health.cannot_cancel")
    timestamp = now_iso()
    if task.status == "pending":
        task.status = "canceled"
        task.finished_at = timestamp
    else:
        task.status = "cancel_requested"
    task.updated_at = timestamp
    session.add(task)
    session.commit()
    session.refresh(task)
    return _serialize_task(task)


def retry_health_task(session: Session, task_id: int) -> LibraryHealthTask:
    source = session.get(LibraryHealthTask, task_id)
    if not source:
        raise ServiceError(404, "Library health task not found", "health.task_not_found")
    if source.status not in {"failed", "canceled"}:
        raise ServiceError(400, "Only failed or canceled health tasks can be retried", "health.cannot_retry")
    payload = _parse_json(source.input_json, {})
    return create_health_task(
        session,
        task_type=source.task_type,
        audio_ids=payload.get("audio_ids") or [],
    )


def recover_interrupted_health_tasks(engine) -> int:
    recovered = 0
    with Session(engine) as session:
        rows = session.exec(
            select(LibraryHealthTask).where(
                LibraryHealthTask.status.in_(["pending", "running", "cancel_requested"])
            )
        ).all()
        timestamp = now_iso()
        for task in rows:
            task.status = "canceled" if task.status == "cancel_requested" else "failed"
            task.error_code = "health.interrupted"
            task.error_message = "Library health task was interrupted by backend restart"
            task.finished_at = timestamp
            task.updated_at = timestamp
            session.add(task)
            recovered += 1
        if rows:
            session.commit()
    return recovered


def _task_cancel_requested(session: Session, task_id: int) -> bool:
    bind = session.get_bind()
    engine = getattr(bind, "engine", bind)
    with Session(engine) as cancellation_session:
        status = cancellation_session.exec(
            select(LibraryHealthTask.status).where(LibraryHealthTask.id == task_id)
        ).first()
    return status in {"cancel_requested", "canceled"}


def _update_task_progress(
    session: Session,
    task: LibraryHealthTask,
    *,
    processed: int,
    total: int | None = None,
) -> None:
    task.processed_items = processed
    if total is not None:
        task.total_items = total
    task.updated_at = now_iso()
    session.add(task)
    session.commit()
    session.refresh(task)


def _finish_task(
    session: Session,
    task: LibraryHealthTask,
    status: str,
    *,
    result: dict | None = None,
    error: Exception | None = None,
) -> None:
    timestamp = now_iso()
    task.status = status
    task.result_json = (
        json.dumps(result, ensure_ascii=False, separators=(",", ":"))
        if result is not None
        else None
    )
    task.error_message = str(error) if error else None
    task.error_code = "health.check_failed" if error else None
    task.finished_at = timestamp
    task.updated_at = timestamp
    session.add(task)
    session.commit()


def _display_title(item: AudioItem) -> str:
    return item.title_user or item.title_original or item.file_name


def _duplicate_group_key(item: AudioItem):
    if not item.file_size or item.file_size <= 0 or item.duration_seconds is None:
        return None
    title = " ".join((_display_title(item) or "").casefold().split())
    author = " ".join(
        (item.author_user or item.author_original or "").casefold().split()
    )
    return (int(item.file_size), round(float(item.duration_seconds), 1), title, author)


def low_cost_duplicate_groups(items: list[AudioItem]) -> list[dict]:
    groups: dict[tuple, list[AudioItem]] = defaultdict(list)
    for item in items:
        if item.is_missing or not Path(item.file_path).is_file():
            continue
        key = _duplicate_group_key(item)
        if key is not None:
            groups[key].append(item)
    result = []
    for key, rows in groups.items():
        if len(rows) < 2:
            continue
        result.append(
            {
                "candidate_key": f"{key[0]}:{key[1]}:{key[2]}:{key[3]}",
                "reason": "same_size_duration_metadata",
                "file_size": key[0],
                "duration_seconds": key[1],
                "title": _display_title(rows[0]),
                "audio_items": [
                    {
                        "id": row.id,
                        "title": _display_title(row),
                        "file_path": row.file_path,
                        "library_root_id": row.library_root_id,
                    }
                    for row in rows
                ],
            }
        )
    result.sort(key=lambda group: (-len(group["audio_items"]), group["candidate_key"]))
    return result[:MAX_DUPLICATE_GROUPS]


def _latest_scan_state(session: Session) -> tuple[dict[int, ScanTask], dict[int, int]]:
    tasks = session.exec(select(ScanTask).order_by(ScanTask.created_at.desc())).all()
    latest: dict[int, ScanTask] = {}
    failures: dict[int, int] = defaultdict(int)
    for task in tasks:
        latest.setdefault(task.root_id, task)
        if task.status == "failed":
            failures[task.root_id] += 1
    return latest, failures


def _base_root_summaries(session: Session) -> tuple[list[dict], list[AudioItem]]:
    roots = session.exec(select(LibraryRoot).order_by(LibraryRoot.created_at)).all()
    items = session.exec(select(AudioItem)).all()
    items_by_root: dict[int | None, list[AudioItem]] = defaultdict(list)
    for item in items:
        items_by_root[item.library_root_id].append(item)
    latest_scans, failure_counts = _latest_scan_state(session)
    summaries = []
    for root in roots:
        rows = items_by_root.get(root.id, [])
        latest = latest_scans.get(int(root.id)) if root.id is not None else None
        summaries.append(
            {
                "root": root.model_dump(),
                "path_available": Path(root.path).is_dir(),
                "database_total": len(rows),
                "available": sum(not item.is_missing for item in rows),
                "missing": sum(item.is_missing for item in rows),
                "unsupported_count": None,
                "unsupported_examples": [],
                "supported_files_on_disk": None,
                "failed_scan_count": failure_counts.get(int(root.id or 0), 0),
                "latest_scan": latest.model_dump() if latest else None,
            }
        )
    return summaries, items


def get_library_health_summary(session: Session) -> dict:
    roots, items = _base_root_summaries(session)
    latest_task = session.exec(
        select(LibraryHealthTask)
        .where(LibraryHealthTask.task_type == "health_check")
        .where(LibraryHealthTask.status == "done")
        .order_by(LibraryHealthTask.finished_at.desc(), LibraryHealthTask.id.desc())
    ).first()
    latest_result = _parse_json(latest_task.result_json, {}) if latest_task else {}
    snapshot_roots = {
        row["root"]["id"]: row for row in latest_result.get("roots", [])
    }
    for row in roots:
        snapshot = snapshot_roots.get(row["root"]["id"])
        if snapshot:
            for key in (
                "path_available",
                "available",
                "missing",
                "unsupported_count",
                "unsupported_examples",
                "supported_files_on_disk",
            ):
                row[key] = snapshot.get(key)

    missing_ids = set(latest_result.get("missing_audio_ids", []))
    if not latest_task:
        missing_ids = {int(item.id) for item in items if item.id and item.is_missing}
    missing_items = [item for item in items if item.id in missing_ids]
    duplicate_groups = latest_result.get("duplicate_groups") or low_cost_duplicate_groups(items)
    active = session.exec(
        select(LibraryHealthTask)
        .where(LibraryHealthTask.status.in_(list(ACTIVE_HEALTH_STATUSES)))
        .order_by(LibraryHealthTask.created_at)
    ).all()
    return {
        "generated_at": latest_result.get("generated_at"),
        "roots": roots,
        "totals": {
            "roots": len(roots),
            "disabled_roots": sum(not row["root"]["is_enabled"] for row in roots),
            "available": sum(int(row.get("available") or 0) for row in roots),
            "missing": sum(int(row.get("missing") or 0) for row in roots),
            "unsupported": sum(int(row.get("unsupported_count") or 0) for row in roots),
            "scan_failures": sum(int(row["failed_scan_count"]) for row in roots),
            "duplicate_groups": len(duplicate_groups),
            "detached_audio": sum(item.library_root_id is None for item in items),
        },
        "missing_audio": [
            {
                "id": item.id,
                "title": _display_title(item),
                "file_path": item.file_path,
                "library_root_id": item.library_root_id,
                "file_size": item.file_size,
                "duration_seconds": item.duration_seconds,
                "updated_at": item.updated_at,
            }
            for item in missing_items[:MAX_MISSING_ITEMS]
        ],
        "duplicate_groups": duplicate_groups,
        "active_tasks": [_serialize_task(task) for task in active],
        "latest_task": _serialize_task(latest_task) if latest_task else None,
    }


def _run_health_check(session: Session, task: LibraryHealthTask) -> dict | None:
    roots = session.exec(select(LibraryRoot).order_by(LibraryRoot.created_at)).all()
    items = session.exec(select(AudioItem)).all()
    items_by_root: dict[int | None, list[AudioItem]] = defaultdict(list)
    for item in items:
        items_by_root[item.library_root_id].append(item)

    processed = 0
    missing_audio_ids: list[int] = []
    root_results = []
    for root in roots:
        if _task_cancel_requested(session, int(task.id)):
            return None
        root_path = Path(root.path).expanduser().resolve()
        root_items = items_by_root.get(root.id, [])
        available = 0
        missing = 0
        for item in root_items:
            path = Path(item.file_path)
            is_available = path.exists() and path.is_file()
            if is_available:
                available += 1
            else:
                missing += 1
                if item.id is not None:
                    missing_audio_ids.append(int(item.id))
            processed += 1
            if processed % 25 == 0:
                _update_task_progress(session, task, processed=processed)
                if _task_cancel_requested(session, int(task.id)):
                    return None

        unsupported_count = 0
        unsupported_examples: list[str] = []
        supported_files = 0
        if root_path.is_dir():
            try:
                for path in root_path.rglob("*"):
                    try:
                        if not path.is_file():
                            continue
                        suffix = path.suffix.lower()
                        if suffix in SUPPORTED_EXTS:
                            supported_files += 1
                        elif suffix in KNOWN_AUDIO_EXTS:
                            unsupported_count += 1
                            if len(unsupported_examples) < MAX_UNSUPPORTED_EXAMPLES:
                                unsupported_examples.append(str(path))
                        processed += 1
                        if processed % 25 == 0:
                            _update_task_progress(session, task, processed=processed)
                            if _task_cancel_requested(session, int(task.id)):
                                return None
                    except OSError:
                        continue
            except OSError:
                pass

        root_results.append(
            {
                "root": root.model_dump(),
                "path_available": root_path.is_dir(),
                "database_total": len(root_items),
                "available": available,
                "missing": missing,
                "unsupported_count": unsupported_count,
                "unsupported_examples": unsupported_examples,
                "supported_files_on_disk": supported_files,
            }
        )

    _update_task_progress(session, task, processed=processed, total=processed)
    return {
        "generated_at": now_iso(),
        "roots": root_results,
        "missing_audio_ids": missing_audio_ids,
        "duplicate_groups": low_cost_duplicate_groups(items),
    }


def _path_within_configured_root(
    session: Session,
    path_value: str,
) -> tuple[Path, LibraryRoot]:
    try:
        candidate = Path(path_value).expanduser().resolve(strict=True)
    except (OSError, RuntimeError) as error:
        raise ServiceError(400, "Invalid audio file path", "audio.invalid_path") from error
    if not candidate.is_file():
        raise ServiceError(400, "Invalid audio file path", "audio.invalid_path")
    roots = session.exec(select(LibraryRoot)).all()
    matches: list[tuple[int, LibraryRoot]] = []
    for root in roots:
        try:
            resolved_root = Path(root.path).expanduser().resolve(strict=True)
            candidate.relative_to(resolved_root)
            matches.append((len(resolved_root.parts), root))
        except (OSError, RuntimeError, ValueError):
            continue
    if not matches:
        raise ServiceError(
            400,
            "Audio file path must be within a configured library root",
            "audio.outside_library",
        )
    matches.sort(key=lambda match: match[0], reverse=True)
    return candidate, matches[0][1]


def _same_path(left: str, right: Path) -> bool:
    try:
        return Path(left).expanduser().resolve() == right
    except (OSError, RuntimeError):
        return str(left) == str(right)


def _normalized(value: str | None) -> str:
    return " ".join((value or "").casefold().split())


def _candidate_analysis(
    session: Session,
    item: AudioItem,
    candidate: Path,
    root: LibraryRoot,
) -> dict:
    stat = candidate.stat()
    metadata = read_audio_metadata(candidate)
    size_match = item.file_size == stat.st_size if item.file_size is not None else None
    duration = metadata.get("duration_seconds")
    duration_match = None
    if item.duration_seconds is not None and duration is not None:
        tolerance = max(2.0, float(item.duration_seconds) * 0.02)
        duration_match = abs(float(item.duration_seconds) - float(duration)) <= tolerance

    comparable_metadata = []
    for stored, key in (
        (item.title_original, "title_original"),
        (item.author_original, "author_original"),
        (item.album_original, "album_original"),
    ):
        candidate_value = metadata.get(key)
        if stored and candidate_value:
            comparable_metadata.append(_normalized(stored) == _normalized(candidate_value))
    metadata_match = all(comparable_metadata) if comparable_metadata else None

    fingerprint = None
    hash_match = None
    if item.file_hash:
        strategy = "sampled" if item.file_hash.startswith(SAMPLED_HASH_PREFIX) else "full"
        try:
            fingerprint = calculate_file_fingerprint(
                candidate,
                strategy=strategy,
                file_size=stat.st_size,
            )
            hash_match = fingerprint == item.file_hash
        except OSError:
            hash_match = False

    conflict = session.exec(
        select(AudioItem).where(AudioItem.id != item.id)
    ).all()
    conflict_audio = next(
        (row for row in conflict if _same_path(row.file_path, candidate)),
        None,
    )
    checks = {
        "size": size_match,
        "duration": duration_match,
        "metadata": metadata_match,
        "fingerprint": hash_match,
    }
    mismatch = any(value is False for value in checks.values())
    strong_identity = hash_match is True
    metadata_identity = duration_match is True and metadata_match is True
    eligible = (
        size_match is True
        and (strong_identity or metadata_identity)
        and not mismatch
        and conflict_audio is None
    )
    return {
        "path": str(candidate),
        "library_root_id": root.id,
        "library_root_path": root.path,
        "file_size": stat.st_size,
        "mtime_ns": stat.st_mtime_ns,
        "duration_seconds": duration,
        "title": metadata.get("title_original"),
        "author": metadata.get("author_original"),
        "album": metadata.get("album_original"),
        "checks": checks,
        "eligible": eligible,
        "confidence": "high" if hash_match is True else "medium" if eligible else "rejected",
        "conflict_audio_id": conflict_audio.id if conflict_audio else None,
        "_metadata": metadata,
        "_fingerprint": fingerprint,
    }


def _public_candidate(candidate: dict) -> dict:
    return {key: value for key, value in candidate.items() if not key.startswith("_")}


def find_relink_candidates(
    session: Session,
    audio_id: int,
    limit: int = 20,
) -> dict:
    item = session.get(AudioItem, audio_id)
    if not item:
        raise ServiceError(404, "Audio item not found")
    if Path(item.file_path).exists():
        raise ServiceError(409, "Audio file is not missing", "health.audio_not_missing")
    roots = session.exec(select(LibraryRoot).order_by(LibraryRoot.created_at)).all()
    candidates = []
    for root in roots:
        try:
            root_path = Path(root.path).expanduser().resolve(strict=True)
        except (OSError, RuntimeError):
            continue
        try:
            for path in root_path.rglob("*"):
                if len(candidates) >= limit:
                    break
                try:
                    resolved = path.resolve(strict=True)
                    if not resolved.is_file() or resolved.suffix.lower() not in SUPPORTED_EXTS:
                        continue
                    resolved.relative_to(root_path)
                    if _same_path(item.file_path, resolved):
                        continue
                    stat = resolved.stat()
                    if item.file_size is not None and stat.st_size != item.file_size:
                        continue
                    analysis = _candidate_analysis(session, item, resolved, root)
                    candidates.append(_public_candidate(analysis))
                except (OSError, RuntimeError, ValueError):
                    continue
        except OSError:
            continue
        if len(candidates) >= limit:
            break
    candidates.sort(
        key=lambda row: (
            0 if row["eligible"] else 1,
            0 if row["confidence"] == "high" else 1,
            row["path"],
        )
    )
    return {
        "audio": {
            "id": item.id,
            "title": _display_title(item),
            "file_path": item.file_path,
            "file_size": item.file_size,
            "duration_seconds": item.duration_seconds,
            "updated_at": item.updated_at,
        },
        "candidates": candidates,
    }


def _relink_impacts(session: Session, item: AudioItem) -> dict:
    transcript = session.exec(
        select(Transcript).where(Transcript.audio_id == item.id)
    ).first()
    segment_count = 0
    if transcript and transcript.id is not None:
        segment_count = int(
            session.exec(
                select(func.count(TranscriptSegment.id)).where(
                    TranscriptSegment.transcript_id == transcript.id
                )
            ).one()
            or 0
        )
    tag_count = int(
        session.exec(
            select(func.count(AudioTag.tag_id)).where(AudioTag.audio_id == item.id)
        ).one()
        or 0
    )
    playlist_count = int(
        session.exec(
            select(func.count(PlaylistItem.id))
            .join(Playlist, Playlist.id == PlaylistItem.playlist_id)
            .where(PlaylistItem.audio_id == item.id)
            .where(Playlist.kind == "manual")
        ).one()
        or 0
    )
    return {
        "transcript_preserved": transcript is not None,
        "transcript_segments": segment_count,
        "tags_preserved": tag_count,
        "manual_playlists_preserved": playlist_count,
        "cover_preserved": bool(item.cover_path),
        "cover_source": item.cover_source,
        "play_count_preserved": item.play_count,
        "playback_position_preserved": item.last_position_seconds,
        "user_metadata_preserved": True,
        "files_deleted": 0,
        "database_records_deleted": 0,
    }


def _validated_relink_candidate(
    session: Session,
    item: AudioItem,
    candidate_path: str,
) -> tuple[Path, LibraryRoot, dict]:
    if Path(item.file_path).exists():
        raise ServiceError(409, "Audio file is not missing", "health.audio_not_missing")
    candidate, root = _path_within_configured_root(session, candidate_path)
    if candidate.suffix.lower() not in SUPPORTED_EXTS:
        raise ServiceError(400, "Unsupported audio format")
    analysis = _candidate_analysis(session, item, candidate, root)
    if not analysis["eligible"]:
        raise ServiceError(
            409,
            "Relink candidate did not pass safety checks",
            "health.candidate_rejected",
            {"checks": analysis["checks"]},
        )
    return candidate, root, analysis


def preview_safe_relink(
    session: Session,
    audio_id: int,
    candidate_path: str,
) -> dict:
    item = session.get(AudioItem, audio_id)
    if not item:
        raise ServiceError(404, "Audio item not found")
    _, _, analysis = _validated_relink_candidate(session, item, candidate_path)
    return {
        "audio": {
            "id": item.id,
            "title": _display_title(item),
            "old_path": item.file_path,
            "updated_at": item.updated_at,
        },
        "candidate": _public_candidate(analysis),
        "impacts": _relink_impacts(session, item),
        "confirmation": {
            "expected_audio_updated_at": item.updated_at,
            "expected_file_size": analysis["file_size"],
            "expected_mtime_ns": analysis["mtime_ns"],
        },
    }


def commit_safe_relink(
    session: Session,
    audio_id: int,
    candidate_path: str,
    *,
    expected_audio_updated_at: str,
    expected_file_size: int,
    expected_mtime_ns: int,
) -> dict:
    item = session.get(AudioItem, audio_id)
    if not item:
        raise ServiceError(404, "Audio item not found")
    candidate, root, analysis = _validated_relink_candidate(
        session,
        item,
        candidate_path,
    )
    if item.updated_at != expected_audio_updated_at:
        raise ServiceError(409, "Audio item changed after relink preview", "health.preview_stale")
    stat = candidate.stat()
    if stat.st_size != expected_file_size or stat.st_mtime_ns != expected_mtime_ns:
        raise ServiceError(409, "Relink candidate changed after preview", "health.preview_stale")
    impacts = _relink_impacts(session, item)
    old_path = item.file_path
    metadata = analysis["_metadata"]
    fingerprint = analysis["_fingerprint"]
    if fingerprint is None:
        fingerprint = calculate_file_fingerprint(
            candidate,
            strategy="sampled",
            file_size=stat.st_size,
        )
    try:
        item.file_path = str(candidate)
        item.file_name = candidate.name
        item.file_ext = candidate.suffix.lower()
        item.file_size = stat.st_size
        item.file_mtime = utc_timestamp_iso(stat.st_mtime)
        item.file_hash = fingerprint
        item.library_root_id = root.id
        item.is_missing = False
        for key, value in metadata.items():
            if value is not None:
                setattr(item, key, value)
        item.updated_at = now_iso()
        session.add(item)
        session.flush()
        rebuild_audio_search_index(session, int(item.id), commit=False)
        session.commit()
        session.refresh(item)
    except Exception:
        session.rollback()
        raise
    logger.info(
        "Safely relinked audio id=%s old_path=%s new_path=%s",
        audio_id,
        old_path,
        candidate,
    )
    return {
        "audio": item.model_dump(),
        "impacts": impacts,
        "preserved": True,
    }


def _full_hash_with_cancel(
    session: Session,
    task_id: int,
    path: Path,
) -> str | None:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        chunks = 0
        while True:
            chunk = handle.read(HASH_CHUNK_SIZE)
            if not chunk:
                break
            digest.update(chunk)
            chunks += 1
            if chunks % 8 == 0 and _task_cancel_requested(session, task_id):
                return None
    return digest.hexdigest()


def _run_duplicate_hash(session: Session, task: LibraryHealthTask) -> dict | None:
    payload = _parse_json(task.input_json, {})
    audio_ids = list(dict.fromkeys(payload.get("audio_ids") or []))
    task.total_items = len(audio_ids)
    session.add(task)
    session.commit()
    hashes: dict[str, list[AudioItem]] = defaultdict(list)
    errors = []
    for index, audio_id in enumerate(audio_ids, start=1):
        if _task_cancel_requested(session, int(task.id)):
            return None
        item = session.get(AudioItem, audio_id)
        if not item:
            errors.append({"audio_id": audio_id, "code": "audio.not_found"})
            continue
        try:
            path, _ = _path_within_configured_root(session, item.file_path)
            digest = _full_hash_with_cancel(session, int(task.id), path)
            if digest is None:
                return None
            hashes[digest].append(item)
        except (OSError, ServiceError) as error:
            errors.append({"audio_id": audio_id, "code": "health.hash_failed", "error": str(error)})
        _update_task_progress(session, task, processed=index, total=len(audio_ids))
    confirmed = []
    for digest, rows in hashes.items():
        if len(rows) < 2:
            continue
        confirmed.append(
            {
                "hash_prefix": digest[:12],
                "audio_items": [
                    {"id": row.id, "title": _display_title(row), "file_path": row.file_path}
                    for row in rows
                ],
            }
        )
    return {
        "generated_at": now_iso(),
        "confirmed_groups": confirmed,
        "errors": errors,
    }


def run_health_task(engine, task_id: int) -> None:
    with Session(engine) as session:
        task = session.get(LibraryHealthTask, task_id)
        if not task or task.status == "canceled":
            return
        if task.status == "cancel_requested":
            _finish_task(session, task, "canceled")
            return
        task.status = "running"
        task.started_at = now_iso()
        task.updated_at = task.started_at
        session.add(task)
        session.commit()
        session.refresh(task)
        try:
            if task.task_type == "health_check":
                result = _run_health_check(session, task)
            else:
                result = _run_duplicate_hash(session, task)
            if result is None:
                _finish_task(session, task, "canceled")
            else:
                _finish_task(session, task, "done", result=result)
        except Exception as error:
            session.rollback()
            task = session.get(LibraryHealthTask, task_id)
            if task:
                _finish_task(session, task, "failed", error=error)
            logger.exception("Library health task failed id=%s", task_id)
