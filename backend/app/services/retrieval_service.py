from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text
from sqlmodel import Session, select

from ..models import (
    AudioItem,
    LibraryRoot,
    Playlist,
    PlaylistItem,
    SavedView,
    Tag,
    Transcript,
    TranscriptSegment,
)
from ..schemas import AgentScope
from ..search import _build_safe_fts5_query, _escape_like_query
from .audio_query import build_audio_items_stmt
from .errors import ServiceError
from .saved_view_service import audio_query_kwargs, decode_saved_view_query


@dataclass(frozen=True)
class ResolvedScope:
    scope: AgentScope
    audio_ids: frozenset[int]
    label: str


def scope_payload(scope: AgentScope) -> dict:
    return {
        "kind": scope.kind,
        **scope.model_dump(
            exclude={"kind"},
            exclude_none=True,
            exclude_defaults=True,
        ),
    }


def _ids_from_stmt(session: Session, stmt) -> frozenset[int]:
    if stmt is None:
        return frozenset()
    values = session.execute(stmt.with_only_columns(AudioItem.id)).scalars().all()
    return frozenset(int(value) for value in values if value is not None)


def _query_scope_ids(session: Session, query) -> frozenset[int]:
    kwargs = audio_query_kwargs(session, query)
    kwargs.pop("sort", None)
    stmt = build_audio_items_stmt(session=session, **kwargs)
    return _ids_from_stmt(session, stmt)


def resolve_scope(session: Session, scope: AgentScope) -> ResolvedScope:
    if scope.kind == "library":
        return ResolvedScope(
            scope=scope,
            audio_ids=_ids_from_stmt(session, build_audio_items_stmt(session=session)),
            label="整个资料库",
        )

    if scope.kind == "audio":
        audio = session.get(AudioItem, scope.audio_id)
        if not audio:
            raise ServiceError(404, "Audio not found", "agent.scope_not_found")
        return ResolvedScope(scope, frozenset({int(audio.id)}), audio.title_user or audio.title_original or audio.file_name)

    if scope.kind == "selection":
        unique_ids = list(dict.fromkeys(scope.audio_ids))
        existing = session.exec(select(AudioItem.id).where(AudioItem.id.in_(unique_ids))).all()
        if len(existing) != len(unique_ids):
            raise ServiceError(404, "One or more selected audio items were not found", "agent.scope_not_found")
        return ResolvedScope(scope, frozenset(int(value) for value in existing), f"已选 {len(existing)} 条音频")

    if scope.kind == "tag":
        tag = session.get(Tag, scope.tag_id)
        if not tag:
            raise ServiceError(404, "Tag not found", "agent.scope_not_found")
        ids = _ids_from_stmt(
            session,
            build_audio_items_stmt(session=session, tag_ids=[int(tag.id)]),
        )
        return ResolvedScope(scope, ids, f"标签：{tag.name}")

    if scope.kind == "library_root":
        root = session.get(LibraryRoot, scope.library_root_id)
        if not root:
            raise ServiceError(404, "Library root not found", "agent.scope_not_found")
        ids = _ids_from_stmt(
            session,
            build_audio_items_stmt(session=session, library_root_id=int(root.id)),
        )
        return ResolvedScope(scope, ids, f"目录：{root.path}")

    if scope.kind == "saved_view":
        view = session.get(SavedView, scope.saved_view_id)
        if not view:
            raise ServiceError(404, "Saved view not found", "agent.scope_not_found")
        query, error = decode_saved_view_query(view.query_json, view.schema_version)
        if not query:
            raise ServiceError(409, "Saved view definition is invalid", "agent.scope_invalid", {"reason": error or "invalid definition"})
        return ResolvedScope(scope, _query_scope_ids(session, query), f"保存视图：{view.name}")

    if scope.kind == "playlist":
        playlist = session.get(Playlist, scope.playlist_id)
        if not playlist:
            raise ServiceError(404, "Playlist not found", "agent.scope_not_found")
        if playlist.kind == "smart":
            query, error = decode_saved_view_query(playlist.query_json, playlist.query_schema_version)
            if not query:
                raise ServiceError(409, "Playlist definition is invalid", "agent.scope_invalid", {"reason": error or "invalid definition"})
            ids = _query_scope_ids(session, query)
        else:
            stmt = build_audio_items_stmt(session=session)
            if stmt is None:
                ids = frozenset()
            else:
                ids = _ids_from_stmt(
                    session,
                    stmt.where(
                        AudioItem.id.in_(
                            select(PlaylistItem.audio_id).where(
                                PlaylistItem.playlist_id == playlist.id
                            )
                        )
                    ),
                )
        return ResolvedScope(scope, ids, f"播放列表：{playlist.name}")

    raise ServiceError(400, "Unsupported Agent scope", "agent.scope_invalid")


def _matched_fields(row, query: str) -> list[str]:
    fields = ("title", "author", "description", "tags", "transcript")
    tokens = [value.casefold() for value in query.split() if value]
    matched = []
    for index, field in enumerate(fields, start=6):
        value = str(row[index] or "").casefold()
        if tokens and all(token in value for token in tokens):
            matched.append(field)
    return matched or ["transcript"]


def _context_for_segment(session: Session, transcript_id: int, segment_index: int) -> tuple[str, str]:
    if transcript_id <= 0:
        return "", ""
    rows = session.exec(
        select(TranscriptSegment)
        .where(TranscriptSegment.transcript_id == transcript_id)
        .where(TranscriptSegment.segment_index.in_([segment_index - 1, segment_index + 1]))
    ).all()
    by_index = {row.segment_index: row.text for row in rows}
    return by_index.get(segment_index - 1, ""), by_index.get(segment_index + 1, "")


def search_segments(
    session: Session,
    query: str,
    scope: AgentScope,
    *,
    limit: int = 20,
    mode: str = "auto",
) -> dict:
    normalized = query.strip()
    if not normalized:
        raise ServiceError(400, "Search query is required", "search.query_required")
    resolved = resolve_scope(session, scope)
    if not resolved.audio_ids:
        return {
            "items": [],
            "scope": scope_payload(scope),
            "scope_label": resolved.label,
            "scope_audio_count": 0,
            "retrieval_mode": "fts",
            "fallback_reason": "embedding_not_configured" if mode == "hybrid" else None,
        }

    fts_query = _build_safe_fts5_query(normalized)
    rows = []
    try:
        if fts_query:
            rows = session.execute(
                text(
                    """
                    SELECT audio_id, transcript_id, segment_id, segment_index,
                           start_seconds, end_seconds, title, author, description,
                           tags, transcript,
                           bm25(segment_search_index, 0, 0, 0, 0, 0, 0, 8, 5, 3, 6, 1) AS rank
                    FROM segment_search_index
                    WHERE segment_search_index MATCH :query
                    ORDER BY rank
                    """
                ),
                {"query": fts_query},
            ).fetchall()
    except Exception:
        rows = []

    # Phrase/substring fallback is important for CJK tokenization and damaged FTS.
    if not rows:
        pattern = f"%{_escape_like_query(normalized)}%"
        try:
            rows = session.execute(
                text(
                    """
                    SELECT audio_id, transcript_id, segment_id, segment_index,
                           start_seconds, end_seconds, title, author, description,
                           tags, transcript, 0 AS rank
                    FROM segment_search_index
                    WHERE title LIKE :pattern ESCAPE '\\'
                       OR author LIKE :pattern ESCAPE '\\'
                       OR description LIKE :pattern ESCAPE '\\'
                       OR tags LIKE :pattern ESCAPE '\\'
                       OR transcript LIKE :pattern ESCAPE '\\'
                    """
                ),
                {"pattern": pattern},
            ).fetchall()
        except Exception:
            rows = []

    items: list[dict] = []
    seen: set[tuple[int, int]] = set()
    for row in rows:
        audio_id = int(row[0])
        segment_id = int(row[2] or 0)
        matched_fields = _matched_fields(row, normalized)
        result_key = (
            (audio_id, 0)
            if any(field != "transcript" for field in matched_fields)
            else (audio_id, segment_id)
        )
        if audio_id not in resolved.audio_ids or result_key in seen:
            continue
        audio = session.get(AudioItem, audio_id)
        if not audio:
            continue
        transcript_id = int(row[1] or 0)
        if transcript_id:
            revision = session.get(Transcript, transcript_id)
            if not revision or not revision.is_current or revision.audio_id != audio_id:
                continue
        before, after = _context_for_segment(session, transcript_id, int(row[3] or 0))
        transcript_text = str(row[10] or "")
        field_values = {
            "title": str(row[6] or ""),
            "author": str(row[7] or ""),
            "description": str(row[8] or ""),
            "tags": str(row[9] or ""),
            "transcript": transcript_text,
        }
        evidence = " · ".join(
            field_values[field] for field in matched_fields if field_values[field]
        )
        transcript_evidence = "transcript" in matched_fields
        items.append(
            {
                "scope": scope_payload(scope),
                "audio_id": audio_id,
                "audio_title": audio.title_user or audio.title_original or audio.file_name,
                "revision_id": transcript_id or None if transcript_evidence else None,
                "segment_id": segment_id or None if transcript_evidence else None,
                "segment_index": int(row[3] or 0),
                "start_seconds": float(row[4] or 0) if transcript_evidence else 0.0,
                "end_seconds": float(row[5] or 0) if transcript_evidence else 0.0,
                "matched_fields": matched_fields,
                "text": evidence[:4000],
                "context_before": before[:1000] if transcript_evidence else "",
                "context_after": after[:1000] if transcript_evidence else "",
                "score": float(-row[11]) if row[11] is not None else 0.0,
            }
        )
        seen.add(result_key)
        if len(items) >= max(1, min(limit, 100)):
            break

    return {
        "items": items,
        "scope": scope_payload(scope),
        "scope_label": resolved.label,
        "scope_audio_count": len(resolved.audio_ids),
        "retrieval_mode": "fts",
        "fallback_reason": "embedding_not_configured" if mode == "hybrid" else None,
    }
