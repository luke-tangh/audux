"""Playback position and listening-event persistence."""

from typing import Optional

from sqlmodel import Session

from ..models import AudioItem, PlaybackEvent, now_iso
from .errors import ServiceError


def update_playback_position(
    session: Session,
    audio_id: int,
    last_position_seconds: float,
) -> dict:
    item = session.get(AudioItem, audio_id)
    if not item:
        raise ServiceError(404, "Audio item not found")
    item.last_position_seconds = last_position_seconds
    item.last_played_at = now_iso()
    item.updated_at = now_iso()
    session.add(item)
    session.commit()
    return {"ok": True}


def increment_play_count(session: Session, audio_id: int) -> dict:
    item = session.get(AudioItem, audio_id)
    if not item:
        raise ServiceError(404, "Audio item not found")
    item.play_count += 1
    item.last_played_at = now_iso()
    item.updated_at = now_iso()
    session.add(item)
    session.commit()
    return {"ok": True}


def start_playback_event(
    session: Session,
    audio_id: int,
    start_position_seconds: float,
) -> PlaybackEvent:
    item = session.get(AudioItem, audio_id)
    if not item:
        raise ServiceError(404, "Audio item not found")
    timestamp = now_iso()
    event = PlaybackEvent(
        audio_id=audio_id,
        started_at=timestamp,
        start_position_seconds=start_position_seconds,
        end_position_seconds=start_position_seconds,
    )
    item.play_count += 1
    item.last_played_at = timestamp
    item.updated_at = timestamp
    session.add(item)
    session.add(event)
    session.commit()
    session.refresh(event)
    return event


def update_playback_event(
    session: Session,
    event_id: int,
    *,
    listened_seconds: float,
    end_position_seconds: float,
    completed: bool,
    finish: bool,
    end_reason: Optional[str],
) -> PlaybackEvent:
    event = session.get(PlaybackEvent, event_id)
    if not event:
        raise ServiceError(404, "Playback event not found")
    if event.ended_at is not None:
        return event
    if listened_seconds >= event.listened_seconds:
        event.listened_seconds = listened_seconds
        event.end_position_seconds = end_position_seconds
    event.completed = event.completed or completed
    if finish:
        event.ended_at = now_iso()
        event.end_reason = end_reason or ("ended" if completed else "closed")
    session.add(event)
    session.commit()
    session.refresh(event)
    return event
