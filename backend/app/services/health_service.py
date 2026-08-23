"""Library health summaries and health-check execution orchestration."""

from collections import defaultdict
from pathlib import Path

from sqlmodel import Session, select

from ..logger import get_logger
from ..media_probe import SUPPORTED_EXTS
from ..models import AudioItem, LibraryHealthTask, LibraryRoot, ScanTask, now_iso
from ..search import rebuild_audio_search_index
from .duplicate_detection_service import low_cost_duplicate_groups, run_duplicate_hash
from .health_task_service import (
    ACTIVE_HEALTH_STATUSES,
    cancel_health_task,
    create_health_task,
    finish_task as _finish_task,
    list_health_tasks,
    parse_task_json as _parse_json,
    recover_interrupted_health_tasks,
    retry_health_task,
    serialize_health_task,
    serialize_health_task as _serialize_task,
    task_cancel_requested as _task_cancel_requested,
    update_task_progress as _update_task_progress,
)
from .relink_service import (
    commit_safe_relink as _commit_safe_relink,
    find_relink_candidates,
    path_within_configured_root as _path_within_configured_root,
    preview_safe_relink,
    same_path as _same_path,
)


logger = get_logger(__name__)
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
MAX_MISSING_ITEMS = 200


def _display_title(item: AudioItem) -> str:
    return item.title_user or item.title_original or item.file_name


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
    snapshot_roots = {row["root"]["id"]: row for row in latest_result.get("roots", [])}
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
            is_available = Path(item.file_path).is_file()
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


def commit_safe_relink(
    session: Session,
    audio_id: int,
    candidate_path: str,
    *,
    expected_audio_updated_at: str,
    expected_file_size: int,
    expected_mtime_ns: int,
) -> dict:
    return _commit_safe_relink(
        session,
        audio_id,
        candidate_path,
        expected_audio_updated_at=expected_audio_updated_at,
        expected_file_size=expected_file_size,
        expected_mtime_ns=expected_mtime_ns,
        rebuild_index=rebuild_audio_search_index,
    )


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
            result = (
                _run_health_check(session, task)
                if task.task_type == "health_check"
                else run_duplicate_hash(session, task, _path_within_configured_root)
            )
            _finish_task(
                session,
                task,
                "canceled" if result is None else "done",
                result=result,
            )
        except Exception as error:
            session.rollback()
            task = session.get(LibraryHealthTask, task_id)
            if task:
                _finish_task(session, task, "failed", error=error)
            logger.exception("Library health task failed id=%s", task_id)
