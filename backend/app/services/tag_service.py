from sqlmodel import Session, select

from ..logger import get_logger
from ..models import AudioItem, AudioTag, Tag, now_iso
from ..search import rebuild_audio_search_index
from .common import ServiceError


logger = get_logger(__name__)


def list_tags(session: Session) -> list[Tag]:
    return session.exec(select(Tag).order_by(Tag.name)).all()


def update_tag(session: Session, tag_id: int, name_value: str | None) -> Tag:
    tag = session.get(Tag, tag_id)
    if not tag:
        raise ServiceError(404, "Tag not found")

    name = name_value.strip() if name_value is not None else None
    if not name:
        raise ServiceError(400, "Tag name is required")

    exists = session.exec(
        select(Tag).where(Tag.name == name, Tag.id != tag_id)
    ).first()

    if exists:
        raise ServiceError(409, "Tag name already exists")

    audio_ids = session.exec(
        select(AudioTag.audio_id).where(AudioTag.tag_id == tag_id)
    ).all()

    tag.name = name
    session.add(tag)
    session.commit()
    session.refresh(tag)

    for audio_id in audio_ids:
        rebuild_audio_search_index(session, audio_id)

    logger.info("Tag renamed id=%s name=%s", tag_id, name)
    return tag


def delete_tag(session: Session, tag_id: int, force: bool = False) -> dict:
    tag = session.get(Tag, tag_id)
    if not tag:
        raise ServiceError(404, "Tag not found")

    links = session.exec(
        select(AudioTag).where(AudioTag.tag_id == tag_id)
    ).all()

    if links and not force:
        raise ServiceError(400, "Tag is still used by audio items")

    affected_audio_ids = [link.audio_id for link in links]

    for link in links:
        session.delete(link)

    session.delete(tag)
    session.commit()

    for audio_id in affected_audio_ids:
        rebuild_audio_search_index(session, audio_id)

    logger.info("Tag deleted id=%s force=%s", tag_id, force)
    return {
        "ok": True,
        "affected_audio_items": len(affected_audio_ids),
    }


def add_tags_to_audio(
    session: Session,
    audio_id: int,
    tags: list[str],
    source: str = "user",
) -> list[Tag]:
    item = session.get(AudioItem, audio_id)
    if not item:
        raise ServiceError(404, "Audio item not found")

    result = []

    for name in tags:
        name = name.strip()
        if not name:
            continue

        tag = session.exec(select(Tag).where(Tag.name == name)).first()
        if not tag:
            tag = Tag(name=name, source=source)
            session.add(tag)
            session.commit()
            session.refresh(tag)

        exists = session.exec(
            select(AudioTag).where(
                AudioTag.audio_id == audio_id,
                AudioTag.tag_id == tag.id,
            )
        ).first()

        if not exists:
            link = AudioTag(audio_id=audio_id, tag_id=tag.id)
            session.add(link)

        result.append(tag)

    item.updated_at = now_iso()
    session.add(item)
    session.commit()
    rebuild_audio_search_index(session, audio_id)
    return result


def remove_audio_tag(session: Session, audio_id: int, tag_id: int) -> dict:
    link = session.get(AudioTag, (audio_id, tag_id))
    if not link:
        raise ServiceError(404, "Audio tag relation not found")

    session.delete(link)

    item = session.get(AudioItem, audio_id)
    if item:
        item.updated_at = now_iso()
        session.add(item)

    session.commit()
    rebuild_audio_search_index(session, audio_id)
    return {"ok": True}
