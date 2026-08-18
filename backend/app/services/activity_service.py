from sqlmodel import Session, select

from ..models import AITask, AudioItem, LibraryHealthTask, LibraryRoot, ScanTask
from .whisper_component_service import get_whisper_component_status


ACTIVE_STATUSES = {"pending", "running", "cancel_requested", "downloading", "installing"}
FAILED_STATUSES = {"failed", "canceled", "interrupted"}


def _progress(current: int, total: int) -> float | None:
    if total <= 0:
        return None
    return round(min(1.0, max(0.0, current / total)), 4)


def list_activities(session: Session, limit: int = 40) -> dict:
    ai_tasks = session.exec(
        select(AITask).order_by(AITask.updated_at.desc()).limit(limit)
    ).all()
    scan_tasks = session.exec(
        select(ScanTask).order_by(ScanTask.updated_at.desc()).limit(limit)
    ).all()
    health_tasks = session.exec(
        select(LibraryHealthTask)
        .order_by(LibraryHealthTask.updated_at.desc())
        .limit(limit)
    ).all()

    audio_ids = {task.audio_id for task in ai_tasks}
    root_ids = {task.root_id for task in scan_tasks}
    audio_by_id = {
        row.id: row
        for row in session.exec(select(AudioItem).where(AudioItem.id.in_(audio_ids))).all()
    } if audio_ids else {}
    root_by_id = {
        row.id: row
        for row in session.exec(select(LibraryRoot).where(LibraryRoot.id.in_(root_ids))).all()
    } if root_ids else {}

    items: list[dict] = []
    for task in ai_tasks:
        audio = audio_by_id.get(task.audio_id)
        title = (
            audio.title_user or audio.title_original or audio.file_name
            if audio
            else f"Audio #{task.audio_id}"
        )
        items.append({
            "id": f"ai:{task.id}",
            "source": "ai",
            "source_id": task.id,
            "kind": task.task_type,
            "status": task.status,
            "title": title,
            "detail": None,
            "current": None,
            "total": None,
            "progress": None,
            "error_message": task.error_message,
            "error_code": task.error_code,
            "error_params": task.error_params,
            "created_at": task.created_at,
            "updated_at": task.updated_at,
            "can_cancel": task.status in {"pending", "running"},
            "can_retry": task.status in {"failed", "canceled", "interrupted"},
        })

    for task in scan_tasks:
        root = root_by_id.get(task.root_id)
        items.append({
            "id": f"scan:{task.id}",
            "source": "scan",
            "source_id": task.id,
            "target_id": task.root_id,
            "kind": "scan",
            "status": task.status,
            "title": root.path if root else f"Library #{task.root_id}",
            "detail": {
                "imported": task.imported,
                "updated": task.updated,
                "missing": task.missing,
            },
            "current": task.processed_files,
            "total": task.total_files,
            "progress": _progress(task.processed_files, task.total_files),
            "error_message": task.error_message,
            "error_code": task.error_code,
            "error_params": task.error_params,
            "created_at": task.created_at,
            "updated_at": task.updated_at,
            "can_cancel": task.status in {"pending", "running"},
            "can_retry": task.status in {"failed", "canceled", "interrupted"},
        })

    for task in health_tasks:
        items.append({
            "id": f"health:{task.id}",
            "source": "health",
            "source_id": task.id,
            "kind": task.task_type,
            "status": task.status,
            "title": "Library health check",
            "detail": None,
            "current": task.processed_items,
            "total": task.total_items,
            "progress": _progress(task.processed_items, task.total_items),
            "error_message": task.error_message,
            "error_code": task.error_code,
            "error_params": None,
            "created_at": task.created_at,
            "updated_at": task.updated_at,
            "can_cancel": task.status in {"pending", "running"},
            "can_retry": task.status in {"failed", "canceled", "interrupted"},
        })

    component = get_whisper_component_status()
    if component["status"] in {"downloading", "installing", "failed"}:
        total_bytes = int(component.get("total_bytes") or 0)
        downloaded_bytes = int(component.get("downloaded_bytes") or 0)
        items.append({
            "id": "component:whisper",
            "source": "component",
            "source_id": None,
            "kind": "whisper_component",
            "status": component["status"],
            "title": "Whisper component",
            "detail": {"target": component.get("target")},
            "current": downloaded_bytes,
            "total": total_bytes or None,
            "progress": _progress(downloaded_bytes, total_bytes),
            "error_message": component.get("error_message"),
            "error_code": None,
            "error_params": None,
            "created_at": None,
            "updated_at": None,
            "can_cancel": component["status"] in {"downloading", "installing"},
            "can_retry": component["status"] == "failed",
        })

    items.sort(key=lambda item: item.get("updated_at") or "", reverse=True)
    items.sort(key=lambda item: item["status"] not in ACTIVE_STATUSES)
    active_count = sum(item["status"] in ACTIVE_STATUSES for item in items)
    failed_count = sum(item["status"] in FAILED_STATUSES for item in items)
    return {
        "items": items[:limit],
        "active_count": active_count,
        "failed_count": failed_count,
    }
