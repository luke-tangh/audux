import json
import time

from sqlmodel import Session, select

from app.models import AudioItem, AudioTag, PlaylistItem, Tag, Transcript
from tests.api_test_support import ApiIntegrationTest


def query_payload(**overrides) -> dict:
    payload = {
        "schema_version": 1,
        "view": "library",
        "q": "",
        "tag_id": None,
        "library_root_id": None,
        "transcript_filter": "all",
        "missing_filter": "all",
        "sort": "title_asc",
        "display_mode": "list",
    }
    payload.update(overrides)
    return payload


class TestSmartPlaylistApi(ApiIntegrationTest):
    def mutate(self, method: str, url: str, json_body: dict | None = None):
        return self.client.request(
            method,
            url,
            headers=self.auth_headers(include_client=True),
            json=json_body,
        )

    def create_smart_playlist(self, query: dict, name: str = "动态精选") -> dict:
        saved = self.mutate(
            "POST",
            "/saved-views",
            {"name": f"{name}视图", "query": query},
        )
        assert saved.status_code == 200, saved.text
        created = self.mutate(
            "POST",
            "/playlists/smart",
            {"saved_view_id": saved.json()["id"], "name": name},
        )
        assert created.status_code == 200, created.text
        return created.json()

    def test_members_are_dynamic_and_static_writes_are_rejected(self):
        root = self.add_library_root(self.root_path / "library")
        first = self.add_audio(self.root_path / "library" / "a.mp3", root_id=root.id)
        second = self.add_audio(self.root_path / "library" / "b.mp3", root_id=root.id)
        third = self.add_audio(self.root_path / "library" / "c.mp3", root_id=root.id)
        with Session(self.engine) as session:
            tag = Tag(name="通勤")
            session.add(tag)
            session.commit()
            session.refresh(tag)
            session.add_all(
                [
                    AudioTag(audio_id=first.id, tag_id=tag.id),
                    AudioTag(audio_id=second.id, tag_id=tag.id),
                ]
            )
            session.commit()
            tag_id = tag.id

        playlist = self.create_smart_playlist(query_payload(tag_id=tag_id))
        assert playlist["kind"] == "smart"
        assert playlist["current_count"] == 2
        assert playlist["query"]["tag_id"] == tag_id

        page = self.client.get(
            f"/playlists/{playlist['id']}/items?missing=true&limit=1",
            headers=self.auth_headers(),
        )
        assert page.status_code == 200, page.text
        assert page.json()["total"] == 2
        assert page.json()["playlist_kind"] == "smart"
        assert page.json()["refreshed_at"]

        with Session(self.engine) as session:
            session.add(AudioTag(audio_id=third.id, tag_id=tag_id))
            session.commit()

        refreshed = self.client.get(
            f"/playlists/{playlist['id']}/items?limit=10",
            headers=self.auth_headers(),
        )
        assert refreshed.status_code == 200, refreshed.text
        assert refreshed.json()["total"] == 3
        assert {row["id"] for row in refreshed.json()["items"]} == {
            first.id,
            second.id,
            third.id,
        }

        with Session(self.engine) as session:
            assert session.exec(
                select(PlaylistItem).where(PlaylistItem.playlist_id == playlist["id"])
            ).all() == []

        add = self.mutate(
            "POST",
            f"/playlists/{playlist['id']}/items",
            {"audio_id": first.id},
        )
        assert add.status_code == 409
        assert add.json()["detail"]["code"] == "playlist.rule_driven"

        batch = self.mutate(
            "POST",
            "/audio-items/batch/organize",
            {
                "audio_ids": [first.id],
                "action": "add_to_playlist",
                "playlist_id": playlist["id"],
            },
        )
        assert batch.status_code == 409
        assert batch.json()["detail"]["code"] == "playlist.rule_driven"

        deleted = self.mutate("DELETE", f"/playlists/{playlist['id']}")
        assert deleted.status_code == 200, deleted.text
        assert deleted.json() == {"ok": True, "removed_items": 0}

    def test_transcript_changes_and_export_use_the_same_dynamic_query(self):
        root = self.add_library_root(self.root_path / "talks")
        audio = self.add_audio(self.root_path / "talks" / "talk.mp3", root_id=root.id)
        playlist = self.create_smart_playlist(
            query_payload(view="transcribed", sort="updated_desc"),
            "已转写",
        )

        initial = self.client.get(
            f"/playlists/{playlist['id']}/items",
            headers=self.auth_headers(),
        )
        assert initial.json()["total"] == 0

        with Session(self.engine) as session:
            stored = session.get(AudioItem, audio.id)
            stored.transcript_status = "done"
            session.add(stored)
            session.add(Transcript(audio_id=audio.id, full_text="动态加入"))
            session.commit()

        dynamic = self.client.get(
            f"/playlists/{playlist['id']}/items",
            headers=self.auth_headers(),
        )
        assert dynamic.json()["total"] == 1
        assert dynamic.json()["items"][0]["id"] == audio.id

        exported = self.client.get(
            f"/playlists/{playlist['id']}/export?format=json",
            headers=self.auth_headers(),
        )
        assert exported.status_code == 200, exported.text
        payload = json.loads(exported.text)
        assert payload["playlist"]["kind"] == "smart"
        assert payload["items"][0]["audio"]["id"] == audio.id
        assert "playlist_item" not in payload["items"][0]

    def test_first_page_stays_paginated_with_5000_matching_items(self):
        root = self.add_library_root(self.root_path / "large")
        with Session(self.engine) as session:
            session.add_all(
                [
                    AudioItem(
                        file_path=str(self.root_path / "large" / f"{index:04}.mp3"),
                        file_name=f"{index:04}.mp3",
                        library_root_id=root.id,
                    )
                    for index in range(5000)
                ]
            )
            session.commit()

        playlist = self.create_smart_playlist(query_payload(), "五千条")
        started = time.monotonic()
        listed = self.client.get("/playlists", headers=self.auth_headers())
        count_elapsed = time.monotonic() - started
        assert listed.status_code == 200, listed.text
        assert listed.json()[0]["current_count"] == 5000

        started = time.monotonic()
        response = self.client.get(
            f"/playlists/{playlist['id']}/items?limit=120",
            headers=self.auth_headers(),
        )
        elapsed = time.monotonic() - started

        assert response.status_code == 200, response.text
        page = response.json()
        assert page["total"] == 5000
        assert len(page["items"]) == 120
        assert page["has_more"] is True
        assert count_elapsed < 5
        assert elapsed < 5
