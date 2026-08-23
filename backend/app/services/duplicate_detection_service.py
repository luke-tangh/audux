"""Low-cost duplicate grouping and cancelable full-hash confirmation."""

import hashlib
from collections import defaultdict
from collections.abc import Callable
from pathlib import Path

from sqlmodel import Session

from ..media_probe import HASH_CHUNK_SIZE
from ..models import AudioItem, LibraryHealthTask, LibraryRoot, now_iso
from .errors import ServiceError
from .health_task_service import (
    parse_task_json,
    task_cancel_requested,
    update_task_progress,
)


MAX_DUPLICATE_GROUPS = 100


def _display_title(item: AudioItem) -> str:
    return item.title_user or item.title_original or item.file_name


def _duplicate_group_key(item: AudioItem):
    if not item.file_size or item.file_size <= 0 or item.duration_seconds is None:
        return None
    title = " ".join(_display_title(item).casefold().split())
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


def _full_hash_with_cancel(session: Session, task_id: int, path: Path) -> str | None:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        chunks = 0
        while chunk := handle.read(HASH_CHUNK_SIZE):
            digest.update(chunk)
            chunks += 1
            if chunks % 8 == 0 and task_cancel_requested(session, task_id):
                return None
    return digest.hexdigest()


def run_duplicate_hash(
    session: Session,
    task: LibraryHealthTask,
    validate_path: Callable[[Session, str], tuple[Path, LibraryRoot]],
) -> dict | None:
    payload = parse_task_json(task.input_json, {})
    audio_ids = list(dict.fromkeys(payload.get("audio_ids") or []))
    task.total_items = len(audio_ids)
    session.add(task)
    session.commit()
    hashes: dict[str, list[AudioItem]] = defaultdict(list)
    errors = []
    for index, audio_id in enumerate(audio_ids, start=1):
        if task_cancel_requested(session, int(task.id)):
            return None
        item = session.get(AudioItem, audio_id)
        if not item:
            errors.append({"audio_id": audio_id, "code": "audio.not_found"})
            continue
        try:
            path, _ = validate_path(session, item.file_path)
            digest = _full_hash_with_cancel(session, int(task.id), path)
            if digest is None:
                return None
            hashes[digest].append(item)
        except (OSError, ServiceError) as error:
            errors.append(
                {"audio_id": audio_id, "code": "health.hash_failed", "error": str(error)}
            )
        update_task_progress(session, task, processed=index, total=len(audio_ids))
    confirmed = [
        {
            "hash_prefix": digest[:12],
            "audio_items": [
                {"id": row.id, "title": _display_title(row), "file_path": row.file_path}
                for row in rows
            ],
        }
        for digest, rows in hashes.items()
        if len(rows) >= 2
    ]
    return {"generated_at": now_iso(), "confirmed_groups": confirmed, "errors": errors}
