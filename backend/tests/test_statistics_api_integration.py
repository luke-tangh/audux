from sqlmodel import Session

from app.models import AudioItem, AudioTag, Tag
from tests.api_test_support import ApiIntegrationTest


class TestStatisticsApi(ApiIntegrationTest):
    def test_overview_and_playback_event_lifecycle(self):
        library = self.root_path / "library"
        root = self.add_library_root(library)
        first = self.add_audio(library / "first.mp3", root_id=root.id, transcript_status="done")
        second = self.add_audio(library / "second.flac", root_id=root.id)

        with Session(self.engine) as session:
            first_row = session.get(AudioItem, first.id)
            first_row.title_original = "First"
            first_row.author_original = "Author"
            first_row.description_ai = "Summary"
            first_row.cover_path = "/managed/cover.png"
            first_row.duration_seconds = 600
            first_row.file_size = 1_000
            first_row.is_favorite = True

            second_row = session.get(AudioItem, second.id)
            second_row.duration_seconds = 4_000
            second_row.file_size = 3_000
            second_row.is_missing = True

            tag = Tag(name="knowledge")
            session.add(tag)
            session.commit()
            session.refresh(tag)
            session.add(AudioTag(audio_id=first.id, tag_id=tag.id))
            session.commit()

        headers = self.auth_headers(include_client=True)
        started = self.client.post(
            f"/audio-items/{first.id}/playback-events",
            headers=headers,
            json={"start_position_seconds": 12.5},
        )
        assert started.status_code == 200, started.text
        event_id = started.json()["id"]

        updated = self.client.request(
            "PATCH",
            f"/playback-events/{event_id}",
            headers=headers,
            json={
                "listened_seconds": 125,
                "end_position_seconds": 137.5,
                "completed": True,
                "finish": True,
                "end_reason": "ended",
            },
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["completed"] is True
        assert updated.json()["ended_at"] is not None

        late_heartbeat = self.client.request(
            "PATCH",
            f"/playback-events/{event_id}",
            headers=headers,
            json={
                "listened_seconds": 5,
                "end_position_seconds": 17.5,
                "completed": False,
                "finish": False,
                "end_reason": "paused",
            },
        )
        assert late_heartbeat.status_code == 200
        assert late_heartbeat.json()["listened_seconds"] == 125
        assert late_heartbeat.json()["end_position_seconds"] == 137.5
        assert late_heartbeat.json()["completed"] is True

        response = self.client.get(
            "/statistics/overview?days=30",
            headers=self.auth_headers(),
        )
        assert response.status_code == 200, response.text
        data = response.json()

        assert data["period_days"] == 30
        assert data["library"] == {
            "total_items": 2,
            "playable_items": 1,
            "missing_items": 1,
            "disabled_items": 0,
            "detached_items": 0,
            "favorite_items": 1,
            "ai_failed_items": 0,
            "total_duration_seconds": 4_600.0,
            "total_size_bytes": 4_000,
            "total_play_count": 1,
        }
        assert data["coverage"]["transcript"] == {"count": 1, "total": 2}
        assert data["coverage"]["description"] == {"count": 1, "total": 2}
        assert data["coverage"]["tags"] == {"count": 1, "total": 2}
        assert data["coverage"]["cover"] == {"count": 1, "total": 2}
        assert data["coverage"]["metadata"] == {"count": 1, "total": 2}
        assert {row["format"] for row in data["formats"]} == {"mp3", "flac"}
        assert {row["key"] for row in data["duration_buckets"]} == {
            "5_to_20m",
            "over_60m",
        }
        assert data["roots"][0]["item_count"] == 2
        assert data["top_tags"] == [{"id": 1, "name": "knowledge", "item_count": 1}]
        assert len(data["ingest_timeline"]) == 12
        assert data["listening"]["event_count"] == 1
        assert data["listening"]["listened_seconds"] == 125.0
        assert data["listening"]["completed_count"] == 1
        assert data["listening"]["unique_audio_count"] == 1
        assert data["listening"]["active_days"] == 1
        assert data["listening"]["top_audio"][0]["title"] == "First"
        assert data["listening"]["recent_events"][0]["event_id"] == event_id
        assert data["listening"]["daily"][0]["event_count"] == 1

    def test_event_validation_and_empty_statistics(self):
        invalid_days = self.client.get(
            "/statistics/overview?days=0",
            headers=self.auth_headers(),
        )
        assert invalid_days.status_code == 422

        missing_audio = self.client.post(
            "/audio-items/999/playback-events",
            headers=self.auth_headers(include_client=True),
            json={"start_position_seconds": 0},
        )
        assert missing_audio.status_code == 404

        overview = self.client.get(
            "/statistics/overview",
            headers=self.auth_headers(),
        )
        assert overview.status_code == 200
        assert overview.json()["library"]["total_items"] == 0
        assert overview.json()["listening"]["event_count"] == 0
