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


def search_audio_ids(session: Session, q: str) -> list[int]:
    rows = session.execute(
        text(
            """
            SELECT audio_id
            FROM search_index
            WHERE search_index MATCH :q
            LIMIT 200
            """
        ),
        {"q": q},
    ).fetchall()

    return [int(row[0]) for row in rows]
