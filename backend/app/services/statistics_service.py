from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, case, func, or_
from sqlmodel import Session, select

from ..models import AudioItem, AudioTag, LibraryRoot, PlaybackEvent, Tag
from ..time_utils import utc_now_iso


def _nonempty(*columns):
    values = tuple(func.nullif(func.trim(column), "") for column in columns)
    return values[0] if len(values) == 1 else func.coalesce(*values)


def _count_where(session: Session, condition) -> int:
    return int(
        session.exec(
            select(func.count(AudioItem.id)).where(condition)
        ).one()
        or 0
    )


def get_statistics_overview(session: Session, days: int = 30) -> dict:
    period_start = (datetime.now(UTC) - timedelta(days=days - 1)).replace(
        hour=0,
        minute=0,
        second=0,
        microsecond=0,
        tzinfo=None,
    ).isoformat()

    title = _nonempty(AudioItem.title_user, AudioItem.title_original)
    author = _nonempty(AudioItem.author_user, AudioItem.author_original)
    description = _nonempty(
        AudioItem.description_user,
        AudioItem.description_ai,
        AudioItem.description_original,
    )

    summary = session.exec(
        select(
            func.count(AudioItem.id),
            func.coalesce(func.sum(AudioItem.duration_seconds), 0),
            func.coalesce(func.sum(AudioItem.file_size), 0),
            func.coalesce(func.sum(AudioItem.play_count), 0),
            func.coalesce(func.sum(case((AudioItem.is_favorite == True, 1), else_=0)), 0),
            func.coalesce(func.sum(case((AudioItem.is_missing == True, 1), else_=0)), 0),
        )
    ).one()

    playable_items = int(
        session.exec(
            select(func.count(AudioItem.id))
            .select_from(AudioItem)
            .join(LibraryRoot, LibraryRoot.id == AudioItem.library_root_id, isouter=True)
            .where(
                AudioItem.is_missing == False,
                or_(AudioItem.library_root_id == None, LibraryRoot.is_enabled == True),
            )
        ).one()
        or 0
    )
    disabled_items = int(
        session.exec(
            select(func.count(AudioItem.id))
            .select_from(AudioItem)
            .join(LibraryRoot, LibraryRoot.id == AudioItem.library_root_id)
            .where(LibraryRoot.is_enabled == False)
        ).one()
        or 0
    )
    detached_items = _count_where(session, AudioItem.library_root_id == None)
    tagged_items = int(
        session.exec(select(func.count(func.distinct(AudioTag.audio_id)))).one() or 0
    )
    total_items = int(summary[0] or 0)

    coverage = {
        "transcript": _count_where(session, AudioItem.transcript_status == "done"),
        "description": _count_where(session, description.is_not(None)),
        "tags": tagged_items,
        "cover": _count_where(session, _nonempty(AudioItem.cover_path).is_not(None)),
        "metadata": _count_where(
            session,
            and_(title.is_not(None), author.is_not(None)),
        ),
    }

    format_rows = session.exec(
        select(
            func.coalesce(func.lower(AudioItem.file_ext), "unknown"),
            func.count(AudioItem.id),
            func.coalesce(func.sum(AudioItem.duration_seconds), 0),
            func.coalesce(func.sum(AudioItem.file_size), 0),
        )
        .group_by(func.coalesce(func.lower(AudioItem.file_ext), "unknown"))
        .order_by(func.count(AudioItem.id).desc())
    ).all()

    duration_key = case(
        (AudioItem.duration_seconds == None, "unknown"),
        (AudioItem.duration_seconds < 300, "under_5m"),
        (AudioItem.duration_seconds < 1200, "5_to_20m"),
        (AudioItem.duration_seconds < 3600, "20_to_60m"),
        else_="over_60m",
    )
    duration_rows = session.exec(
        select(duration_key, func.count(AudioItem.id))
        .group_by(duration_key)
    ).all()
    duration_counts = {str(key): int(count) for key, count in duration_rows}
    duration_order = ["under_5m", "5_to_20m", "20_to_60m", "over_60m", "unknown"]

    root_rows = session.exec(
        select(
            LibraryRoot.id,
            LibraryRoot.path,
            LibraryRoot.is_enabled,
            func.count(AudioItem.id),
            func.coalesce(func.sum(case((AudioItem.is_missing == True, 1), else_=0)), 0),
            func.coalesce(func.sum(AudioItem.duration_seconds), 0),
            func.coalesce(func.sum(AudioItem.file_size), 0),
        )
        .select_from(LibraryRoot)
        .join(AudioItem, AudioItem.library_root_id == LibraryRoot.id, isouter=True)
        .group_by(LibraryRoot.id, LibraryRoot.path, LibraryRoot.is_enabled)
        .order_by(func.count(AudioItem.id).desc(), LibraryRoot.id)
    ).all()

    tag_rows = session.exec(
        select(Tag.id, Tag.name, func.count(AudioTag.audio_id))
        .select_from(Tag)
        .join(AudioTag, AudioTag.tag_id == Tag.id)
        .group_by(Tag.id, Tag.name)
        .order_by(func.count(AudioTag.audio_id).desc(), Tag.name)
        .limit(12)
    ).all()

    current_month_index = datetime.now(UTC).year * 12 + datetime.now(UTC).month - 1
    ingest_periods = []
    for offset in range(11, -1, -1):
        month_index = current_month_index - offset
        ingest_periods.append(f"{month_index // 12:04d}-{month_index % 12 + 1:02d}")

    month_key = func.substr(AudioItem.created_at, 1, 7)
    ingest_rows = session.exec(
        select(month_key, func.count(AudioItem.id))
        .where(AudioItem.created_at >= f"{ingest_periods[0]}-01")
        .group_by(month_key)
        .order_by(month_key)
    ).all()
    ingest_counts = {str(period): int(count) for period, count in ingest_rows}

    period_events = PlaybackEvent.started_at >= period_start
    listening_summary = session.exec(
        select(
            func.count(PlaybackEvent.id),
            func.coalesce(func.sum(PlaybackEvent.listened_seconds), 0),
            func.coalesce(func.sum(case((PlaybackEvent.completed == True, 1), else_=0)), 0),
            func.count(func.distinct(PlaybackEvent.audio_id)),
            func.count(func.distinct(func.substr(PlaybackEvent.started_at, 1, 10))),
        ).where(period_events)
    ).one()

    resolved_title = func.coalesce(title, AudioItem.file_name)
    resolved_author = func.coalesce(author, "")
    top_audio_rows = session.exec(
        select(
            AudioItem.id,
            resolved_title,
            resolved_author,
            func.count(PlaybackEvent.id),
            func.coalesce(func.sum(PlaybackEvent.listened_seconds), 0),
        )
        .select_from(PlaybackEvent)
        .join(AudioItem, AudioItem.id == PlaybackEvent.audio_id)
        .where(period_events)
        .group_by(AudioItem.id, resolved_title, resolved_author)
        .order_by(
            func.sum(PlaybackEvent.listened_seconds).desc(),
            func.count(PlaybackEvent.id).desc(),
        )
        .limit(8)
    ).all()

    recent_rows = session.exec(
        select(PlaybackEvent, AudioItem)
        .join(AudioItem, AudioItem.id == PlaybackEvent.audio_id)
        .where(period_events)
        .order_by(PlaybackEvent.started_at.desc())
        .limit(8)
    ).all()

    day_key = func.substr(PlaybackEvent.started_at, 1, 10)
    daily_rows = session.exec(
        select(
            day_key,
            func.count(PlaybackEvent.id),
            func.coalesce(func.sum(PlaybackEvent.listened_seconds), 0),
            func.coalesce(func.sum(case((PlaybackEvent.completed == True, 1), else_=0)), 0),
        )
        .where(period_events)
        .group_by(day_key)
        .order_by(day_key)
    ).all()

    return {
        "generated_at": utc_now_iso(),
        "period_days": days,
        "period_started_at": period_start,
        "library": {
            "total_items": total_items,
            "playable_items": playable_items,
            "missing_items": int(summary[5] or 0),
            "disabled_items": disabled_items,
            "detached_items": detached_items,
            "favorite_items": int(summary[4] or 0),
            "ai_failed_items": _count_where(session, AudioItem.ai_status == "failed"),
            "total_duration_seconds": float(summary[1] or 0),
            "total_size_bytes": int(summary[2] or 0),
            "total_play_count": int(summary[3] or 0),
        },
        "coverage": {
            key: {"count": count, "total": total_items}
            for key, count in coverage.items()
        },
        "formats": [
            {
                "format": str(label).lstrip(".") or "unknown",
                "count": int(count),
                "duration_seconds": float(duration or 0),
                "size_bytes": int(size or 0),
            }
            for label, count, duration, size in format_rows
        ],
        "duration_buckets": [
            {"key": key, "count": duration_counts.get(key, 0)}
            for key in duration_order
            if duration_counts.get(key, 0) > 0
        ],
        "roots": [
            {
                "id": int(root_id),
                "path": path,
                "is_enabled": bool(is_enabled),
                "item_count": int(count),
                "missing_count": int(missing or 0),
                "duration_seconds": float(duration or 0),
                "size_bytes": int(size or 0),
            }
            for root_id, path, is_enabled, count, missing, duration, size in root_rows
        ],
        "top_tags": [
            {"id": int(tag_id), "name": name, "item_count": int(count)}
            for tag_id, name, count in tag_rows
        ],
        "ingest_timeline": [
            {"period": period, "count": ingest_counts.get(period, 0)}
            for period in ingest_periods
        ],
        "listening": {
            "event_count": int(listening_summary[0] or 0),
            "listened_seconds": float(listening_summary[1] or 0),
            "completed_count": int(listening_summary[2] or 0),
            "unique_audio_count": int(listening_summary[3] or 0),
            "active_days": int(listening_summary[4] or 0),
            "top_audio": [
                {
                    "audio_id": int(audio_id),
                    "title": row_title,
                    "author": row_author,
                    "event_count": int(event_count),
                    "listened_seconds": float(listened_seconds or 0),
                }
                for audio_id, row_title, row_author, event_count, listened_seconds in top_audio_rows
            ],
            "recent_events": [
                {
                    "event_id": int(event.id),
                    "audio_id": int(audio.id),
                    "title": audio.title_user or audio.title_original or audio.file_name,
                    "author": audio.author_user or audio.author_original or "",
                    "started_at": event.started_at,
                    "listened_seconds": event.listened_seconds,
                    "completed": event.completed,
                }
                for event, audio in recent_rows
            ],
            "daily": [
                {
                    "date": date,
                    "event_count": int(event_count),
                    "listened_seconds": float(listened_seconds or 0),
                    "completed_count": int(completed_count or 0),
                }
                for date, event_count, listened_seconds, completed_count in daily_rows
            ],
        },
    }
