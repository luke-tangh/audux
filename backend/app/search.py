from dataclasses import dataclass

from sqlmodel import Session, select
from sqlalchemy import text

from .models import AudioItem, Tag, AudioTag, Transcript


@dataclass(frozen=True)
class SearchResult:
    ids: list[int]
    limited: bool
    limit: int | None


def get_display_title(audio: AudioItem) -> str:
    return audio.title_user or audio.title_original or audio.file_name


def get_display_author(audio: AudioItem) -> str:
    return audio.author_user or audio.author_original or ""


def get_display_description(audio: AudioItem) -> str:
    return audio.description_user or audio.description_ai or audio.description_original or ""


def rebuild_audio_search_index(
    session: Session,
    audio_id: int,
    commit: bool = True,
):
    audio = session.get(AudioItem, audio_id)
    if not audio:
        return

    tag_rows = session.exec(
        select(Tag)
        .join(AudioTag, AudioTag.tag_id == Tag.id)
        .where(AudioTag.audio_id == audio_id)
    ).all()
    tag_text = " ".join([t.name for t in tag_rows])

    transcript = session.exec(
        select(Transcript).where(Transcript.audio_id == audio_id)
    ).first()
    transcript_text = transcript.full_text if transcript else ""

    session.execute(
        text("DELETE FROM search_index WHERE audio_id = :audio_id"),
        {"audio_id": audio_id},
    )

    session.execute(
        text(
            """
            INSERT INTO search_index(audio_id, title, author, description, tags, transcript)
            VALUES (:audio_id, :title, :author, :description, :tags, :transcript)
            """
        ),
        {
            "audio_id": audio_id,
            "title": get_display_title(audio),
            "author": get_display_author(audio),
            "description": get_display_description(audio),
            "tags": tag_text,
            "transcript": transcript_text,
        },
    )

    if commit:
        session.commit()


def _escape_fts5_phrase(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def _build_safe_fts5_query(q: str) -> str:
    """
    将用户输入转换为相对安全的 FTS5 MATCH 查询。

    - 普通空格分词：foo bar -> "foo" AND "bar"
    - 中文或无空格文本：线性代数 -> "线性代数"
    - 引号、冒号、括号、减号等特殊字符被包进 phrase，避免 MATCH 语法错误
    """
    tokens = [x.strip() for x in q.strip().split() if x.strip()]
    if not tokens:
        return ""

    return " AND ".join(_escape_fts5_phrase(token) for token in tokens)


def _escape_like_query(value: str) -> str:
    """
    Escape LIKE wildcards.

    SQLite LIKE uses:
    - % as multi-character wildcard
    - _ as single-character wildcard

    We use backslash as ESCAPE char.
    """
    return (
        value
        .replace("\\", "\\\\")
        .replace("%", "\\%")
        .replace("_", "\\_")
    )


def _fts_search_audio_ids(
    session: Session,
    fts_query: str,
) -> list[int]:
    rows = session.execute(
        text(
            """
            SELECT audio_id
            FROM search_index
            WHERE search_index MATCH :q
            ORDER BY bm25(search_index, 0.0, 8.0, 5.0, 3.0, 4.0, 1.0)
            """
        ),
        {"q": fts_query},
    ).fetchall()

    return [int(row[0]) for row in rows]


def _like_search_audio_ids(
    session: Session,
    q: str,
) -> list[int]:
    pattern = f"%{_escape_like_query(q)}%"

    rows = session.execute(
        text(
            """
            SELECT DISTINCT audio_id
            FROM search_index
            WHERE title LIKE :pattern ESCAPE '\\'
               OR author LIKE :pattern ESCAPE '\\'
               OR description LIKE :pattern ESCAPE '\\'
               OR tags LIKE :pattern ESCAPE '\\'
               OR transcript LIKE :pattern ESCAPE '\\'
            """
        ),
        {"pattern": pattern},
    ).fetchall()

    return [int(row[0]) for row in rows]


def search_audio_ids_with_meta(
    session: Session,
    q: str,
    limit: int | None = None,
) -> SearchResult:
    q = q.strip()
    if not q:
        return SearchResult(ids=[], limited=False, limit=None)

    normalized_limit = max(1, limit) if limit is not None else None

    result: list[int] = []
    seen: set[int] = set()
    def add_ids(ids: list[int]):
        for audio_id in ids:
            if audio_id in seen:
                continue

            if normalized_limit is not None and len(result) >= normalized_limit:
                return

            seen.add(audio_id)
            result.append(audio_id)

    fts_query = _build_safe_fts5_query(q)

    if fts_query:
        try:
            add_ids(_fts_search_audio_ids(session, fts_query))
        except Exception:
            # FTS5 可能因为 tokenizer / 特殊输入出现异常。
            # 下面仍会使用 LIKE 作为兜底。
            pass

    # LIKE fallback is useful for substring/CJK cases, but scanning the
    # transcript column with %query% can be expensive on large libraries.
    # Only run it when FTS did not already fill the requested result window.
    if normalized_limit is None or len(result) < normalized_limit:
        try:
            add_ids(_like_search_audio_ids(session, q))
        except Exception:
            pass

    return SearchResult(
        ids=result,
        limited=False,
        limit=None,
    )


def search_audio_ids(session: Session, q: str) -> list[int]:
    return search_audio_ids_with_meta(session, q).ids
