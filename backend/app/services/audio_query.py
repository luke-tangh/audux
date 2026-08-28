from typing import Optional

from sqlalchemy import and_, func, or_
from sqlmodel import Session, select

from ..models import (
    AudioItem,
    AudioTag,
    LibraryRoot,
    Tag,
    Transcript,
    TranscriptSegment,
)
from ..search import rebuild_audio_search_index, search_audio_ids


def audio_sort_clauses(sort: str):
    """Return deterministic ordering clauses shared by library and playlist pages."""
    title = func.lower(
        func.coalesce(
            func.nullif(AudioItem.title_user, ""),
            func.nullif(AudioItem.title_original, ""),
            AudioItem.file_name,
        )
    )
    author_value = func.coalesce(
        func.nullif(AudioItem.author_user, ""),
        func.nullif(AudioItem.author_original, ""),
    )
    author = func.lower(author_value)

    clauses = {
        "title_asc": (title.asc(),),
        "title_desc": (title.desc(),),
        "author_asc": (author_value.is_(None), author.asc(), title.asc()),
        "created_desc": (AudioItem.created_at.desc(),),
        "updated_desc": (AudioItem.updated_at.desc(),),
        "duration_asc": (
            AudioItem.duration_seconds.is_(None),
            AudioItem.duration_seconds.asc(),
        ),
        "duration_desc": (
            AudioItem.duration_seconds.is_(None),
            AudioItem.duration_seconds.desc(),
        ),
        "play_count_desc": (AudioItem.play_count.desc(),),
    }.get(sort)

    if clauses is None:
        return None

    return (*clauses, AudioItem.id.asc())


def apply_enabled_roots_filter(
    stmt,
    session: Session,
    include_disabled_roots: bool = False,
):
    if include_disabled_roots:
        return stmt

    enabled_root_ids = session.exec(
        select(LibraryRoot.id).where(LibraryRoot.is_enabled == True)
    ).all()

    if not enabled_root_ids:
        return stmt.where(AudioItem.library_root_id == None)

    return stmt.where(
        or_(
            AudioItem.library_root_id == None,
            AudioItem.library_root_id.in_(enabled_root_ids),
        )
    )


def tags_for_audio(session: Session, audio_id: int) -> list[Tag]:
    return session.exec(
        select(Tag)
        .join(AudioTag, AudioTag.tag_id == Tag.id)
        .where(AudioTag.audio_id == audio_id)
        .order_by(Tag.name)
    ).all()


def tags_by_audio_id(session: Session, audio_ids: list[int]) -> dict[int, list[Tag]]:
    if not audio_ids:
        return {}

    result: dict[int, list[Tag]] = {audio_id: [] for audio_id in audio_ids}

    rows = session.exec(
        select(AudioTag.audio_id, Tag)
        .join(Tag, AudioTag.tag_id == Tag.id)
        .where(AudioTag.audio_id.in_(audio_ids))
        .order_by(AudioTag.audio_id, Tag.name)
    ).all()

    for audio_id, tag in rows:
        result.setdefault(int(audio_id), []).append(tag)

    return result


def _escape_sql_like_token(value: str) -> str:
    return (
        value
        .replace("\\", "\\\\")
        .replace("%", "\\%")
        .replace("_", "\\_")
    )


def _query_tokens(q: Optional[str]) -> list[str]:
    if not q:
        return []

    tokens = [x.strip().lower() for x in q.split() if x.strip()]
    if tokens:
        return tokens

    q = q.strip().lower()
    return [q] if q else []


def _text_matches_tokens(text_value: Optional[str], tokens: list[str]) -> bool:
    if not text_value or not tokens:
        return False

    lower = text_value.lower()
    return any(token in lower for token in tokens)


def _shorten_hit_text(text_value: str, tokens: list[str], max_len: int = 220) -> str:
    text_value = text_value.strip()
    if len(text_value) <= max_len:
        return text_value

    lower = text_value.lower()
    first_pos = -1

    for token in tokens:
        pos = lower.find(token)
        if pos >= 0 and (first_pos < 0 or pos < first_pos):
            first_pos = pos

    if first_pos < 0:
        return text_value[:max_len].rstrip() + "..."

    start = max(0, first_pos - 80)
    end = min(len(text_value), start + max_len)

    snippet = text_value[start:end].strip()

    if start > 0:
        snippet = "..." + snippet

    if end < len(text_value):
        snippet = snippet + "..."

    return snippet


def _add_search_hit(
    hits: list[dict],
    field: str,
    label: str,
    text_value: Optional[str],
    tokens: list[str],
    start_seconds: Optional[float] = None,
    end_seconds: Optional[float] = None,
    segment_index: Optional[int] = None,
    transcript_revision_id: Optional[int] = None,
    segment_id: Optional[int] = None,
    context_before: Optional[str] = None,
    context_after: Optional[str] = None,
    limit: int = 6,
):
    if len(hits) >= limit:
        return

    if not text_value:
        return

    if not _text_matches_tokens(text_value, tokens):
        return

    hit = {
        "field": field,
        "label": label,
        "text": _shorten_hit_text(text_value, tokens),
    }

    if start_seconds is not None:
        hit["start_seconds"] = start_seconds

    if end_seconds is not None:
        hit["end_seconds"] = end_seconds

    if segment_index is not None:
        hit["segment_index"] = segment_index

    if transcript_revision_id is not None:
        hit["transcript_revision_id"] = transcript_revision_id

    if segment_id is not None:
        hit["segment_id"] = segment_id

    if context_before:
        hit["context_before"] = context_before

    if context_after:
        hit["context_after"] = context_after

    hits.append(hit)


def _matching_transcript_segments_by_transcript_ids(
    session: Session,
    transcript_ids: list[int],
    tokens: list[str],
    per_transcript_limit: int = 3,
) -> dict[int, list[TranscriptSegment]]:
    result: dict[int, list[TranscriptSegment]] = {
        transcript_id: [] for transcript_id in transcript_ids
    }

    if not transcript_ids or not tokens:
        return result

    conditions = [
        func.lower(TranscriptSegment.text).like(
            f"%{_escape_sql_like_token(token.lower())}%",
            escape="\\",
        )
        for token in tokens
        if token
    ]

    if not conditions:
        return result

    rows = session.exec(
        select(TranscriptSegment)
        .where(TranscriptSegment.transcript_id.in_(transcript_ids))
        .where(and_(*conditions))
        .order_by(TranscriptSegment.transcript_id, TranscriptSegment.segment_index)
    ).all()

    matching_by_transcript_id: dict[int, list[TranscriptSegment]] = {
        transcript_id: [] for transcript_id in transcript_ids
    }

    for segment in rows:
        transcript_id = int(segment.transcript_id)
        bucket = matching_by_transcript_id.setdefault(transcript_id, [])

        if len(bucket) >= per_transcript_limit:
            continue

        bucket.append(segment)

    context_conditions = []
    for transcript_id, matching_segments in matching_by_transcript_id.items():
        context_indexes: set[int] = set()

        for segment in matching_segments:
            context_indexes.update(
                {
                    segment.segment_index - 1,
                    segment.segment_index,
                    segment.segment_index + 1,
                }
            )

        if context_indexes:
            context_conditions.append(
                and_(
                    TranscriptSegment.transcript_id == transcript_id,
                    TranscriptSegment.segment_index.in_(context_indexes),
                )
            )

    if not context_conditions:
        return result

    context_rows = session.exec(
        select(TranscriptSegment)
        .where(or_(*context_conditions))
        .order_by(TranscriptSegment.transcript_id, TranscriptSegment.segment_index)
    ).all()

    for segment in context_rows:
        result.setdefault(int(segment.transcript_id), []).append(segment)

    return result


def _transcripts_and_segments_by_audio_ids(
    session: Session,
    audio_ids: list[int],
    q: Optional[str] = None,
) -> tuple[dict[int, Transcript], dict[int, list[TranscriptSegment]]]:
    if not audio_ids:
        return {}, {}

    transcripts = session.exec(
        select(Transcript)
        .where(Transcript.audio_id.in_(audio_ids))
        .where(Transcript.is_current.is_(True))
    ).all()

    transcript_by_audio_id = {int(t.audio_id): t for t in transcripts}
    transcript_ids = [int(t.id) for t in transcripts if t.id is not None]

    segments_by_transcript_id: dict[int, list[TranscriptSegment]] = {
        transcript_id: [] for transcript_id in transcript_ids
    }

    if transcript_ids:
        tokens = _query_tokens(q)

        if tokens:
            segments_by_transcript_id = _matching_transcript_segments_by_transcript_ids(
                session=session,
                transcript_ids=transcript_ids,
                tokens=tokens,
                per_transcript_limit=3,
            )
        else:
            segments = session.exec(
                select(TranscriptSegment)
                .where(TranscriptSegment.transcript_id.in_(transcript_ids))
                .order_by(TranscriptSegment.transcript_id, TranscriptSegment.segment_index)
            ).all()

            for segment in segments:
                segments_by_transcript_id.setdefault(int(segment.transcript_id), []).append(segment)

    return transcript_by_audio_id, segments_by_transcript_id


def _search_hits_for_audio(
    session: Session,
    audio: AudioItem,
    q: Optional[str],
    tags: Optional[list[Tag]] = None,
    transcript: Optional[Transcript] = None,
    segments: Optional[list[TranscriptSegment]] = None,
    transcript_prefetched: bool = False,
) -> list[dict]:
    tokens = _query_tokens(q)
    if not tokens or audio.id is None:
        return []

    hits: list[dict] = []

    _add_search_hit(
        hits,
        "title",
        "标题",
        audio.title_user or audio.title_original or audio.file_name,
        tokens,
    )
    _add_search_hit(
        hits,
        "author",
        "作者",
        audio.author_user or audio.author_original,
        tokens,
    )
    _add_search_hit(
        hits,
        "description",
        "描述",
        audio.description_user or audio.description_ai or audio.description_original,
        tokens,
    )

    tag_rows = tags if tags is not None else tags_for_audio(session, audio.id)
    tag_text = " ".join(tag.name for tag in tag_rows)
    _add_search_hit(hits, "tags", "标签", tag_text, tokens)

    if not transcript_prefetched:
        transcript = session.exec(
            select(Transcript)
            .where(Transcript.audio_id == audio.id)
            .where(Transcript.is_current.is_(True))
        ).first()

    if not transcript:
        return hits[:6]

    if segments is None:
        segments = session.exec(
            select(TranscriptSegment)
            .where(TranscriptSegment.transcript_id == transcript.id)
            .order_by(TranscriptSegment.segment_index)
        ).all()

    segment_hit_count = 0
    segment_by_index = {
        segment.segment_index: segment
        for segment in segments or []
    }

    for seg in segments or []:
        if segment_hit_count >= 3:
            break

        before_count = len(hits)
        _add_search_hit(
            hits,
            "transcript",
            "Transcript",
            seg.text,
            tokens,
            start_seconds=seg.start_seconds,
            end_seconds=seg.end_seconds,
            segment_index=seg.segment_index,
            transcript_revision_id=int(transcript.id),
            segment_id=int(seg.id),
            context_before=(
                segment_by_index[seg.segment_index - 1].text
                if seg.segment_index - 1 in segment_by_index
                else None
            ),
            context_after=(
                segment_by_index[seg.segment_index + 1].text
                if seg.segment_index + 1 in segment_by_index
                else None
            ),
        )

        if len(hits) > before_count:
            segment_hit_count += 1

    if segment_hit_count == 0:
        _add_search_hit(
            hits,
            "transcript",
            "Transcript",
            transcript.full_text,
            tokens,
            transcript_revision_id=int(transcript.id),
        )

    return hits[:6]


def audio_with_tags_dict(
    session: Session,
    audio: AudioItem,
    search_query: Optional[str] = None,
) -> dict:
    if audio.id is None:
        return {
            **audio.model_dump(),
            "tags": [],
            "search_hits": [],
        }

    tags = tags_for_audio(session, audio.id)

    return {
        **audio.model_dump(),
        "tags": [tag.model_dump() for tag in tags],
        "search_hits": _search_hits_for_audio(session, audio, search_query, tags=tags)
        if search_query
        else [],
    }


def audio_rows_with_tags_dicts(
    session: Session,
    rows: list[AudioItem],
    search_query: Optional[str] = None,
) -> list[dict]:
    audio_ids = [int(audio.id) for audio in rows if audio.id is not None]
    tags_by_id = tags_by_audio_id(session, audio_ids)

    transcript_by_audio_id: dict[int, Transcript] = {}
    segments_by_transcript_id: dict[int, list[TranscriptSegment]] = {}

    if search_query:
        transcript_by_audio_id, segments_by_transcript_id = (
            _transcripts_and_segments_by_audio_ids(session, audio_ids, q=search_query)
        )

    result = []

    for audio in rows:
        audio_id = int(audio.id) if audio.id is not None else None
        tags = tags_by_id.get(audio_id, []) if audio_id is not None else []
        transcript = transcript_by_audio_id.get(audio_id) if audio_id is not None else None
        segments = (
            segments_by_transcript_id.get(int(transcript.id), [])
            if transcript and transcript.id is not None
            else []
        )

        result.append(
            {
                **audio.model_dump(),
                "tags": [tag.model_dump() for tag in tags],
                "search_hits": _search_hits_for_audio(
                    session,
                    audio,
                    search_query,
                    tags=tags,
                    transcript=transcript,
                    segments=segments,
                    transcript_prefetched=True,
                )
                if search_query
                else [],
            }
        )

    return result


def build_audio_items_stmt(
    session: Session,
    q: Optional[str] = None,
    search_ids: Optional[list[int]] = None,
    tag: Optional[str] = None,
    tag_ids: Optional[list[int]] = None,
    excluded_tag_ids: Optional[list[int]] = None,
    tag_mode: str = "and",
    library_root_id: Optional[int] = None,
    has_transcript: Optional[bool] = None,
    transcript_status: Optional[str] = None,
    ai_status: Optional[str] = None,
    favorite: Optional[bool] = None,
    missing: Optional[bool] = None,
    missing_description: Optional[bool] = None,
    include_disabled_roots: bool = False,
):
    stmt = select(AudioItem)

    stmt = apply_enabled_roots_filter(
        stmt,
        session,
        include_disabled_roots=include_disabled_roots,
    )

    if library_root_id is not None:
        stmt = stmt.where(AudioItem.library_root_id == library_root_id)

    if q:
        ids = search_ids if search_ids is not None else search_audio_ids(session, q)
        if not ids:
            return None

        stmt = stmt.where(AudioItem.id.in_(ids))

    if favorite is not None:
        stmt = stmt.where(AudioItem.is_favorite == favorite)

    if missing is not None:
        stmt = stmt.where(AudioItem.is_missing == missing)

    if transcript_status:
        stmt = stmt.where(AudioItem.transcript_status == transcript_status)
    elif has_transcript is not None:
        if has_transcript:
            stmt = stmt.where(AudioItem.transcript_status == "done")
        else:
            stmt = stmt.where(AudioItem.transcript_status != "done")

    if ai_status:
        stmt = stmt.where(AudioItem.ai_status == ai_status)

    if missing_description is not None:
        if missing_description:
            stmt = stmt.where(
                and_(
                    or_(AudioItem.description_user == None, AudioItem.description_user == ""),
                    or_(AudioItem.description_ai == None, AudioItem.description_ai == ""),
                    or_(AudioItem.description_original == None, AudioItem.description_original == ""),
                )
            )
        else:
            stmt = stmt.where(
                or_(
                    and_(AudioItem.description_user != None, AudioItem.description_user != ""),
                    and_(AudioItem.description_ai != None, AudioItem.description_ai != ""),
                    and_(AudioItem.description_original != None, AudioItem.description_original != ""),
                )
            )

    resolved_tag_ids = list(dict.fromkeys(tag_ids or []))
    excluded_ids = list(dict.fromkeys(excluded_tag_ids or []))

    if tag:
        tag_row = session.exec(select(Tag).where(Tag.name == tag)).first()
        if not tag_row:
            return None
        if tag_row.id is not None and tag_row.id not in resolved_tag_ids:
            resolved_tag_ids.append(tag_row.id)

    if resolved_tag_ids:
        if tag_mode == "or":
            stmt = stmt.where(
                AudioItem.id.in_(
                    select(AudioTag.audio_id).where(AudioTag.tag_id.in_(resolved_tag_ids))
                )
            )
        else:
            for tag_id in resolved_tag_ids:
                stmt = stmt.where(
                    AudioItem.id.in_(
                        select(AudioTag.audio_id).where(AudioTag.tag_id == tag_id)
                    )
                )

    if excluded_ids:
        stmt = stmt.where(
            ~AudioItem.id.in_(
                select(AudioTag.audio_id).where(AudioTag.tag_id.in_(excluded_ids))
            )
        )

    return stmt


def rebuild_many_audio_search_indexes(session: Session, audio_ids: list[int]):
    try:
        for audio_id in audio_ids:
            rebuild_audio_search_index(session, audio_id, commit=False)
        session.commit()
    except Exception:
        session.rollback()
        raise
