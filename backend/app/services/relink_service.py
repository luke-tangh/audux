"""Safe missing-audio candidate discovery, preview, and relinking."""

from collections.abc import Callable
from pathlib import Path

from sqlalchemy import func
from sqlmodel import Session, select

from ..media_probe import (
    SAMPLED_HASH_PREFIX,
    SUPPORTED_EXTS,
    calculate_file_fingerprint,
    read_audio_metadata,
)
from ..models import (
    AudioItem,
    AudioTag,
    LibraryRoot,
    Playlist,
    PlaylistItem,
    Transcript,
    TranscriptSegment,
    now_iso,
)
from ..search import rebuild_audio_search_index
from ..time_utils import utc_timestamp_iso
from .errors import ServiceError


def _display_title(item: AudioItem) -> str:
    return item.title_user or item.title_original or item.file_name


def path_within_configured_root(
    session: Session,
    path_value: str,
) -> tuple[Path, LibraryRoot]:
    try:
        candidate = Path(path_value).expanduser().resolve(strict=True)
    except (OSError, RuntimeError) as error:
        raise ServiceError(400, "Invalid audio file path", "audio.invalid_path") from error
    if not candidate.is_file():
        raise ServiceError(400, "Invalid audio file path", "audio.invalid_path")
    matches: list[tuple[int, LibraryRoot]] = []
    for root in session.exec(select(LibraryRoot)).all():
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


def same_path(left: str, right: Path) -> bool:
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
    comparable_metadata = [
        _normalized(stored) == _normalized(metadata[key])
        for stored, key in (
            (item.title_original, "title_original"),
            (item.author_original, "author_original"),
            (item.album_original, "album_original"),
        )
        if stored and metadata.get(key)
    ]
    metadata_match = all(comparable_metadata) if comparable_metadata else None
    fingerprint = None
    hash_match = None
    if item.file_hash:
        strategy = "sampled" if item.file_hash.startswith(SAMPLED_HASH_PREFIX) else "full"
        try:
            fingerprint = calculate_file_fingerprint(
                candidate, strategy=strategy, file_size=stat.st_size
            )
            hash_match = fingerprint == item.file_hash
        except OSError:
            hash_match = False
    conflict_audio = next(
        (
            row
            for row in session.exec(select(AudioItem).where(AudioItem.id != item.id)).all()
            if same_path(row.file_path, candidate)
        ),
        None,
    )
    checks = {
        "size": size_match,
        "duration": duration_match,
        "metadata": metadata_match,
        "fingerprint": hash_match,
    }
    mismatch = any(value is False for value in checks.values())
    eligible = (
        size_match is True
        and (hash_match is True or (duration_match is True and metadata_match is True))
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


def find_relink_candidates(session: Session, audio_id: int, limit: int = 20) -> dict:
    item = session.get(AudioItem, audio_id)
    if not item:
        raise ServiceError(404, "Audio item not found")
    if Path(item.file_path).exists():
        raise ServiceError(409, "Audio file is not missing", "health.audio_not_missing")
    candidates = []
    for root in session.exec(select(LibraryRoot).order_by(LibraryRoot.created_at)).all():
        try:
            root_path = Path(root.path).expanduser().resolve(strict=True)
            paths = root_path.rglob("*")
            for path in paths:
                if len(candidates) >= limit:
                    break
                try:
                    resolved = path.resolve(strict=True)
                    if not resolved.is_file() or resolved.suffix.lower() not in SUPPORTED_EXTS:
                        continue
                    resolved.relative_to(root_path)
                    if same_path(item.file_path, resolved):
                        continue
                    stat = resolved.stat()
                    if item.file_size is not None and stat.st_size != item.file_size:
                        continue
                    candidates.append(
                        _public_candidate(_candidate_analysis(session, item, resolved, root))
                    )
                except (OSError, RuntimeError, ValueError):
                    continue
        except (OSError, RuntimeError):
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
        select(Transcript)
        .where(Transcript.audio_id == item.id)
        .where(Transcript.is_current.is_(True))
    ).first()
    segment_count = (
        int(
            session.exec(
                select(func.count(TranscriptSegment.id)).where(
                    TranscriptSegment.transcript_id == transcript.id
                )
            ).one()
            or 0
        )
        if transcript and transcript.id is not None
        else 0
    )
    tag_count = int(
        session.exec(select(func.count(AudioTag.tag_id)).where(AudioTag.audio_id == item.id)).one()
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


def _validated_candidate(
    session: Session, item: AudioItem, candidate_path: str
) -> tuple[Path, LibraryRoot, dict]:
    if Path(item.file_path).exists():
        raise ServiceError(409, "Audio file is not missing", "health.audio_not_missing")
    candidate, root = path_within_configured_root(session, candidate_path)
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


def preview_safe_relink(session: Session, audio_id: int, candidate_path: str) -> dict:
    item = session.get(AudioItem, audio_id)
    if not item:
        raise ServiceError(404, "Audio item not found")
    _, _, analysis = _validated_candidate(session, item, candidate_path)
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
    rebuild_index: Callable[..., None] = rebuild_audio_search_index,
) -> dict:
    item = session.get(AudioItem, audio_id)
    if not item:
        raise ServiceError(404, "Audio item not found")
    candidate, root, analysis = _validated_candidate(session, item, candidate_path)
    if item.updated_at != expected_audio_updated_at:
        raise ServiceError(409, "Audio item changed after relink preview", "health.preview_stale")
    stat = candidate.stat()
    if stat.st_size != expected_file_size or stat.st_mtime_ns != expected_mtime_ns:
        raise ServiceError(409, "Relink candidate changed after preview", "health.preview_stale")
    impacts = _relink_impacts(session, item)
    metadata = analysis["_metadata"]
    fingerprint = analysis["_fingerprint"] or calculate_file_fingerprint(
        candidate, strategy="sampled", file_size=stat.st_size
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
        rebuild_index(session, int(item.id), commit=False)
        session.commit()
        session.refresh(item)
    except Exception:
        session.rollback()
        raise
    return {"audio": item.model_dump(), "impacts": impacts, "preserved": True}
