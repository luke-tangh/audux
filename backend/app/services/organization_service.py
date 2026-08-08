from sqlalchemy import func
from sqlmodel import Session, select

from ..logger import get_logger
from ..models import AudioItem, AudioTag, Playlist, PlaylistItem, Tag, now_iso
from ..search import rebuild_audio_search_index
from .common import ServiceError


logger = get_logger(__name__)


def _unique_values(values: list[int]) -> tuple[list[int], int]:
    seen: set[int] = set()
    unique: list[int] = []
    duplicate_count = 0

    for value in values:
        if value in seen:
            duplicate_count += 1
            continue

        seen.add(value)
        unique.append(value)

    return unique, duplicate_count


def _normalized_tag_names(values: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()

    for value in values:
        name = value.strip()
        if not name or name in seen:
            continue

        seen.add(name)
        result.append(name)

    return result


def batch_organize_audio(session: Session, payload: dict) -> dict:
    action = payload["action"]
    requested_ids = payload["audio_ids"]
    audio_ids, duplicate_count = _unique_values(requested_ids)

    errors: list[dict] = []
    audio_by_id: dict[int, AudioItem] = {}

    for audio_id in audio_ids:
        audio = session.get(AudioItem, audio_id)
        if not audio:
            errors.append({"audio_id": audio_id, "error": "Audio item not found"})
            continue

        audio_by_id[audio_id] = audio

    changed_audio_ids: set[int] = set()
    unchanged_count = 0
    relationship_changes = 0

    try:
        if action == "add_tags":
            tag_names = _normalized_tag_names(payload.get("tag_names") or [])
            if not tag_names:
                raise ServiceError(400, "At least one tag name is required")

            tags: list[Tag] = []
            if audio_by_id:
                for name in tag_names:
                    tag = session.exec(select(Tag).where(Tag.name == name)).first()
                    if not tag:
                        tag = Tag(name=name, source="user")
                        session.add(tag)
                        session.flush()
                    tags.append(tag)

            tag_ids = [int(tag.id) for tag in tags if tag.id is not None]
            existing_links = (
                session.exec(
                    select(AudioTag).where(
                        AudioTag.audio_id.in_(list(audio_by_id)),
                        AudioTag.tag_id.in_(tag_ids),
                    )
                ).all()
                if tag_ids
                else []
            )
            existing = {(link.audio_id, link.tag_id) for link in existing_links}

            for audio_id, audio in audio_by_id.items():
                changed = False
                for tag_id in tag_ids:
                    if (audio_id, tag_id) in existing:
                        continue
                    session.add(AudioTag(audio_id=audio_id, tag_id=tag_id))
                    relationship_changes += 1
                    changed = True

                if changed:
                    audio.updated_at = now_iso()
                    session.add(audio)
                    changed_audio_ids.add(audio_id)
                else:
                    unchanged_count += 1

        elif action == "remove_tags":
            tag_ids, _ = _unique_values(payload.get("tag_ids") or [])
            tags = session.exec(select(Tag).where(Tag.id.in_(tag_ids))).all()
            found_tag_ids = {int(tag.id) for tag in tags if tag.id is not None}
            missing_tag_ids = [tag_id for tag_id in tag_ids if tag_id not in found_tag_ids]
            if missing_tag_ids:
                raise ServiceError(404, f"Tags not found: {missing_tag_ids}")

            links = (
                session.exec(
                    select(AudioTag).where(
                        AudioTag.audio_id.in_(list(audio_by_id)),
                        AudioTag.tag_id.in_(tag_ids),
                    )
                ).all()
                if audio_by_id
                else []
            )
            links_by_audio: dict[int, list[AudioTag]] = {}
            for link in links:
                links_by_audio.setdefault(link.audio_id, []).append(link)

            for audio_id, audio in audio_by_id.items():
                audio_links = links_by_audio.get(audio_id, [])
                if not audio_links:
                    unchanged_count += 1
                    continue

                for link in audio_links:
                    session.delete(link)
                    relationship_changes += 1

                audio.updated_at = now_iso()
                session.add(audio)
                changed_audio_ids.add(audio_id)

        elif action == "add_to_playlist":
            playlist_id = payload.get("playlist_id")
            playlist = session.get(Playlist, playlist_id)
            if not playlist:
                raise ServiceError(404, "Playlist not found")

            existing_audio_ids = set(
                session.exec(
                    select(PlaylistItem.audio_id).where(
                        PlaylistItem.playlist_id == playlist_id
                    )
                ).all()
            )
            max_order = session.exec(
                select(func.max(PlaylistItem.order_index)).where(
                    PlaylistItem.playlist_id == playlist_id
                )
            ).one()
            next_order = 0 if max_order is None else int(max_order) + 1

            for audio_id in audio_by_id:
                if audio_id in existing_audio_ids:
                    unchanged_count += 1
                    continue

                session.add(
                    PlaylistItem(
                        playlist_id=playlist_id,
                        audio_id=audio_id,
                        order_index=next_order,
                    )
                )
                next_order += 1
                relationship_changes += 1
                changed_audio_ids.add(audio_id)

            if changed_audio_ids:
                playlist.updated_at = now_iso()
                session.add(playlist)

        elif action == "set_favorite":
            is_favorite = payload.get("is_favorite")
            if not isinstance(is_favorite, bool):
                raise ServiceError(400, "is_favorite is required")

            for audio_id, audio in audio_by_id.items():
                if audio.is_favorite == is_favorite:
                    unchanged_count += 1
                    continue

                audio.is_favorite = is_favorite
                audio.updated_at = now_iso()
                session.add(audio)
                changed_audio_ids.add(audio_id)
                relationship_changes += 1

        else:
            raise ServiceError(400, "Unsupported batch organization action")

        if action in {"add_tags", "remove_tags"}:
            session.flush()
            for audio_id in changed_audio_ids:
                rebuild_audio_search_index(session, audio_id, commit=False)

        session.commit()
    except Exception:
        session.rollback()
        raise

    result = {
        "action": action,
        "requested_count": len(requested_ids),
        "matched_count": len(audio_by_id),
        "changed_count": len(changed_audio_ids),
        "unchanged_count": unchanged_count,
        "duplicate_count": duplicate_count,
        "relationship_changes": relationship_changes,
        "errors": errors,
    }

    logger.info(
        "Batch organization action=%s requested=%s matched=%s changed=%s errors=%s",
        action,
        result["requested_count"],
        result["matched_count"],
        result["changed_count"],
        len(errors),
    )
    return result
