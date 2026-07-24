import csv
import io
import json

from fastapi.responses import PlainTextResponse, Response
from sqlalchemy import text
from sqlmodel import Session, select

from ..logger import LOG_FILE, get_logger, read_log_file_redacted, read_log_tail
from ..models import AudioItem, AudioTag, Tag
from ..search import rebuild_audio_search_index, search_audio_ids
from .common import (
    ServiceError,
    _apply_enabled_roots_filter,
    _attachment_headers,
    _audio_rows_with_tags_dicts,
    _tags_by_audio_id,
)


logger = get_logger(__name__)


def search_audio(
    session: Session,
    q: str,
    include_disabled_roots: bool = False,
) -> list[dict]:
    ids = search_audio_ids(session, q)
    if not ids:
        return []

    stmt = select(AudioItem).where(AudioItem.id.in_(ids))
    stmt = _apply_enabled_roots_filter(
        stmt,
        session,
        include_disabled_roots=include_disabled_roots,
    )

    rows = session.exec(stmt).all()
    row_dicts = _audio_rows_with_tags_dicts(session, rows, search_query=q)
    row_by_id = {row["id"]: row for row in row_dicts}

    return [row_by_id[i] for i in ids if i in row_by_id]


def export_metadata_response(
    session: Session,
    format: str = "json",
):
    items = session.exec(select(AudioItem).order_by(AudioItem.updated_at.desc())).all()
    tags_by_audio_id = _tags_by_audio_id(
        session,
        [int(audio.id) for audio in items if audio.id is not None],
    )

    if format == "csv":
        buf = io.StringIO()
        writer = csv.writer(buf)

        writer.writerow(
            [
                "id",
                "title",
                "author",
                "album",
                "file_path",
                "duration_seconds",
                "language",
                "tags",
                "transcript_status",
                "ai_status",
                "is_favorite",
                "is_missing",
            ]
        )

        for audio in items:
            tags = tags_by_audio_id.get(int(audio.id), []) if audio.id is not None else []

            writer.writerow(
                [
                    audio.id,
                    audio.title_user or audio.title_original or audio.file_name,
                    audio.author_user or audio.author_original or "",
                    audio.album_user or audio.album_original or "",
                    audio.file_path,
                    audio.duration_seconds or "",
                    audio.language or "",
                    ",".join(t.name for t in tags),
                    audio.transcript_status,
                    audio.ai_status,
                    audio.is_favorite,
                    audio.is_missing,
                ]
            )

        return PlainTextResponse(
            buf.getvalue(),
            media_type="text/csv; charset=utf-8",
            headers=_attachment_headers("audio_library_metadata.csv"),
        )

    data = [
        {
            **audio.model_dump(),
            "tags": [
                tag.model_dump()
                for tag in (tags_by_audio_id.get(int(audio.id), []) if audio.id is not None else [])
            ],
        }
        for audio in items
    ]

    return Response(
        json.dumps(data, ensure_ascii=False, indent=2),
        media_type="application/json",
        headers=_attachment_headers("audio_library_metadata.json"),
    )


def rebuild_all_search_index(session: Session) -> dict:
    items = session.exec(select(AudioItem)).all()
    count = 0

    for item in items:
        rebuild_audio_search_index(session, item.id, commit=False)
        count += 1

        if count % 200 == 0:
            session.commit()

    session.commit()

    logger.info("Search index rebuilt count=%s", count)
    return {"ok": True, "count": count}


def cleanup_orphan_tags(session: Session) -> dict:
    tags = session.exec(select(Tag)).all()
    deleted = 0

    for tag in tags:
        if tag.id is None:
            continue

        link = session.exec(
            select(AudioTag).where(AudioTag.tag_id == tag.id)
        ).first()

        if not link:
            session.delete(tag)
            deleted += 1

    session.commit()

    logger.info("Orphan tags cleaned count=%s", deleted)
    return {
        "ok": True,
        "deleted": deleted,
    }


def get_app_logs(lines: int = 300) -> dict:
    return {
        "file": str(LOG_FILE),
        "content": read_log_tail(lines),
    }


def get_app_log_file_response():
    if not LOG_FILE.exists():
        raise ServiceError(404, "Log file not found")

    return PlainTextResponse(
        read_log_file_redacted(),
        media_type="text/plain; charset=utf-8",
        headers=_attachment_headers("app.log"),
    )
