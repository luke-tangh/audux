from sqlmodel import Session, select
from sqlalchemy import text
from .models import AudioItem, Tag, AudioTag, Transcript


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


def _like_search_audio_ids(session: Session, q: str, limit: int = 200) -> list[int]:
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
            LIMIT :limit
            """
        ),
        {
            "pattern": pattern,
            "limit": limit,
        },
    ).fetchall()

    return [int(row[0]) for row in rows]


def search_audio_ids(session: Session, q: str) -> list[int]:
    q = q.strip()
    if not q:
        return []

    result: list[int] = []
    seen: set[int] = set()

    fts_query = _build_safe_fts5_query(q)

    if fts_query:
        try:
            rows = session.execute(
                text(
                    """
                    SELECT audio_id
                    FROM search_index
                    WHERE search_index MATCH :q
                    LIMIT 200
                    """
                ),
                {"q": fts_query},
            ).fetchall()

            for row in rows:
                audio_id = int(row[0])
                if audio_id not in seen:
                    seen.add(audio_id)
                    result.append(audio_id)

        except Exception:
            # FTS5 可能因为 tokenizer / 特殊输入出现异常。
            # 下面仍会使用 LIKE 作为兜底。
            pass

    # 即使 FTS 有结果，也额外使用 LIKE 补全。
    # 这样能改善中文、部分词、未分词文本、文件名片段的搜索体验。
    try:
        for audio_id in _like_search_audio_ids(session, q, limit=200):
            if audio_id not in seen:
                seen.add(audio_id)
                result.append(audio_id)
    except Exception:
        pass

    return result[:200]
