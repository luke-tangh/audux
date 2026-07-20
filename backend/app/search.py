from sqlmodel import Session, select
from sqlalchemy import text
from .models import AudioItem, Tag, AudioTag, Transcript


def get_display_title(audio: AudioItem) -> str:
    return audio.title_user or audio.title_original or audio.file_name


def get_display_author(audio: AudioItem) -> str:
    return audio.author_user or audio.author_original or ""


def get_display_description(audio: AudioItem) -> str:
    return audio.description_user or audio.description_ai or audio.description_original or ""


def rebuild_audio_search_index(session: Session, audio_id: int):
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


def search_audio_ids(session: Session, q: str) -> list[int]:
    q = q.strip()
    if not q:
        return []

    fts_query = _build_safe_fts5_query(q)
    if not fts_query:
        return []

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

        return [int(row[0]) for row in rows]

    except Exception:
        # FTS5 仍可能因为 tokenizer / 特殊输入出现异常。
        # 这里降级为 LIKE，保证搜索框不会把接口打崩。
        pattern = f"%{q}%"

        rows = session.execute(
            text(
                """
                SELECT DISTINCT audio_id
                FROM search_index
                WHERE title LIKE :pattern
                   OR author LIKE :pattern
                   OR description LIKE :pattern
                   OR tags LIKE :pattern
                   OR transcript LIKE :pattern
                LIMIT 200
                """
            ),
            {"pattern": pattern},
        ).fetchall()

        return [int(row[0]) for row in rows]
