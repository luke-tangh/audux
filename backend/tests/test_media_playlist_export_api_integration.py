import json

import pytest
from sqlmodel import Session, select

from tests.api_test_support import ApiIntegrationTest
from app.models import (
    AITask,
    AudioItem,
    AudioTag,
    Playlist,
    PlaylistItem,
    Tag,
    Transcript,
    TranscriptSegment,
)
from app.services import audio_service, media_paths


class TestMediaPlaylistExportApi(ApiIntegrationTest):
    @pytest.fixture(autouse=True)
    def setup_audio_items(self, api_test_context, monkeypatch):
        self.library = self.root_path / "library"
        self.root = self.add_library_root(self.library)
        self.first = self.add_audio(
            self.library / "first.mp3",
            root_id=self.root.id,
        )
        self.second = self.add_audio(
            self.library / "second.wav",
            root_id=self.root.id,
        )
        self.cover_dir = self.root_path / "covers"
        monkeypatch.setattr(audio_service, "COVERS_DIR", self.cover_dir)
        monkeypatch.setattr(media_paths, "COVERS_DIR", self.cover_dir)

    def test_playback_file_and_missing_state_lifecycle(self):
        headers = self.auth_headers(include_client=True)
        position = self.client.post(
            f"/audio-items/{self.first.id}/playback-position",
            headers=headers,
            json={"last_position_seconds": 37.5},
        )
        assert position.status_code == 200, position.text

        counted = self.client.post(
            f"/audio-items/{self.first.id}/play-count",
            headers=headers,
        )
        assert counted.status_code == 200, counted.text

        with Session(self.engine) as session:
            stored = session.get(AudioItem, self.first.id)
            assert stored.last_position_seconds == 37.5
            assert stored.play_count == 1
            assert stored.last_played_at is not None
            media = audio_service.get_audio_file_response(session, self.first.id)
            assert media.path == str(self.library / "first.mp3")
            assert media.media_type == "audio/mpeg"
            assert (self.library / "first.mp3").read_bytes() == b"test-audio-content"

        (self.library / "first.mp3").unlink()
        missing = self.client.get(
            f"/audio-items/{self.first.id}/file",
            headers=self.auth_headers(),
        )
        assert missing.status_code == 404, missing.text
        assert missing.json()["detail"]["code"] == "audio.file_missing"

        with Session(self.engine) as session:
            assert session.get(AudioItem, self.first.id).is_missing is True

    def test_cover_upload_download_validation_and_delete(self):
        headers = self.auth_headers(include_client=True)
        unsupported = self.client.post(
            f"/audio-items/{self.first.id}/cover",
            headers=headers,
            files={"file": ("cover.txt", b"not-image", "text/plain")},
        )
        assert unsupported.status_code == 400, unsupported.text
        assert unsupported.json()["detail"]["code"] == "cover.unsupported_format"

        empty = self.client.post(
            f"/audio-items/{self.first.id}/cover",
            headers=headers,
            files={"file": ("cover.png", b"", "image/png")},
        )
        assert empty.status_code == 400, empty.text
        assert empty.json()["detail"]["code"] == "cover.empty"

        uploaded = self.client.post(
            f"/audio-items/{self.first.id}/cover",
            headers=headers,
            files={"file": ("cover.png", b"png-cover-bytes", "image/png")},
        )
        assert uploaded.status_code == 200, uploaded.text
        cover_path = self.cover_dir / f"audio_{self.first.id}.png"
        assert uploaded.json()["cover_source"] == "user"
        assert cover_path.read_bytes() == b"png-cover-bytes"

        with Session(self.engine) as session:
            downloaded = audio_service.get_audio_cover_response(session, self.first.id)
            assert downloaded.path == str(cover_path)
            assert downloaded.media_type == "image/png"

        deleted = self.client.request(
            "DELETE",
            f"/audio-items/{self.first.id}/cover",
            headers=headers,
        )
        assert deleted.status_code == 200, deleted.text
        assert deleted.json()["cover_path"] is None
        assert not cover_path.exists()

    def test_audio_delete_removes_relations_but_preserves_file_by_default(self):
        with Session(self.engine) as session:
            tag = Tag(name="linked")
            playlist = Playlist(name="linked playlist")
            session.add_all([tag, playlist])
            session.commit()
            session.refresh(tag)
            session.refresh(playlist)

            transcript = Transcript(audio_id=self.first.id, full_text="text")
            session.add(transcript)
            session.commit()
            session.refresh(transcript)

            session.add_all(
                [
                    AudioTag(audio_id=self.first.id, tag_id=tag.id),
                    PlaylistItem(
                        playlist_id=playlist.id,
                        audio_id=self.first.id,
                        order_index=0,
                    ),
                    AITask(audio_id=self.first.id, task_type="analyze", status="done"),
                    TranscriptSegment(
                        transcript_id=transcript.id,
                        segment_index=0,
                        start_seconds=0,
                        end_seconds=1,
                        text="text",
                    ),
                ]
            )
            session.commit()

        deleted = self.client.request(
            "DELETE",
            f"/audio-items/{self.first.id}",
            headers=self.auth_headers(include_client=True),
        )
        assert deleted.status_code == 200, deleted.text
        assert (self.library / "first.mp3").exists()

        with Session(self.engine) as session:
            assert session.get(AudioItem, self.first.id) is None
            assert session.exec(
                select(AudioTag).where(AudioTag.audio_id == self.first.id)
            ).all() == []
            assert session.exec(
                select(PlaylistItem).where(PlaylistItem.audio_id == self.first.id)
            ).all() == []
            assert session.exec(
                select(AITask).where(AITask.audio_id == self.first.id)
            ).all() == []
            assert session.exec(
                select(Transcript).where(Transcript.audio_id == self.first.id)
            ).all() == []

    def test_audio_delete_can_remove_the_managed_media_file(self):
        path = self.library / "second.wav"
        assert path.exists()

        deleted = self.client.request(
            "DELETE",
            f"/audio-items/{self.second.id}?delete_file=true",
            headers=self.auth_headers(include_client=True),
        )
        assert deleted.status_code == 200, deleted.text
        assert not path.exists()

    def test_ai_suggestions_skip_invalid_newer_payloads_and_keep_defaults(self):
        with Session(self.engine) as session:
            first = session.get(AudioItem, self.first.id)
            second = session.get(AudioItem, self.second.id)
            second.description_ai = "Existing description"
            second.language = "en"
            session.add_all([first, second])
            session.add_all(
                [
                    AITask(
                        audio_id=self.first.id,
                        task_type="analyze",
                        status="done",
                        output_payload=json.dumps(
                            {
                                "description": "Useful summary",
                                "tags": [" topic ", "", 3],
                                "language": "zh",
                            }
                        ),
                        created_at="2026-08-10T00:00:00Z",
                    ),
                    AITask(
                        audio_id=self.first.id,
                        task_type="analyze",
                        status="done",
                        output_payload=json.dumps({"tags": "not-a-list"}),
                        created_at="2026-08-10T01:00:00Z",
                    ),
                ]
            )
            session.commit()

        suggestions = self.client.get(
            f"/audio-items/{self.first.id}/ai-suggestions",
            headers=self.auth_headers(),
        )
        assert suggestions.status_code == 200, suggestions.text
        assert suggestions.json()["description"] == "Useful summary"
        assert suggestions.json()["tags"] == ["topic", "3"]
        assert suggestions.json()["language"] == "zh"

        defaults = self.client.get(
            f"/audio-items/{self.second.id}/ai-suggestions",
            headers=self.auth_headers(),
        )
        assert defaults.status_code == 200, defaults.text
        assert defaults.json() == {
            "task_id": None,
            "description": "Existing description",
            "tags": [],
            "language": "en",
            "raw_content": None,
        }

    def test_playlist_reorder_filter_remove_and_export(self):
        headers = self.auth_headers(include_client=True)
        created = self.client.post(
            "/playlists",
            headers=headers,
            json={"name": " Road/Trip ", "description": "ordered"},
        )
        assert created.status_code == 200, created.text
        playlist_id = created.json()["id"]

        item_ids = []
        for audio_id in [self.first.id, self.second.id]:
            added = self.client.post(
                f"/playlists/{playlist_id}/items",
                headers=headers,
                json={"audio_id": audio_id},
            )
            assert added.status_code == 200, added.text
            item_ids.append(added.json()["id"])

        duplicate = self.client.request(
            "PATCH",
            f"/playlists/{playlist_id}/items/reorder",
            headers=headers,
            json={"item_ids": [item_ids[0], item_ids[0]]},
        )
        assert duplicate.status_code == 400, duplicate.text
        assert duplicate.json()["detail"]["code"] == "playlist.duplicate_items"

        mismatch = self.client.request(
            "PATCH",
            f"/playlists/{playlist_id}/items/reorder",
            headers=headers,
            json={"item_ids": [item_ids[0]]},
        )
        assert mismatch.status_code == 400, mismatch.text
        assert mismatch.json()["detail"]["code"] == "playlist.items_mismatch"

        reordered = self.client.request(
            "PATCH",
            f"/playlists/{playlist_id}/items/reorder",
            headers=headers,
            json={"item_ids": list(reversed(item_ids))},
        )
        assert reordered.status_code == 200, reordered.text

        detail = self.client.get(
            f"/playlists/{playlist_id}",
            headers=self.auth_headers(),
        )
        assert [row["playlist_item"]["id"] for row in detail.json()["items"]] == list(
            reversed(item_ids)
        )

        page = self.client.get(
            f"/playlists/{playlist_id}/items?limit=1&offset=0&missing=false",
            headers=self.auth_headers(),
        )
        assert page.status_code == 200, page.text
        assert page.json()["total"] == 2
        assert page.json()["has_more"] is True
        assert page.json()["items"][0]["playlist_item_id"] == item_ids[1]

        m3u = self.client.get(
            f"/playlists/{playlist_id}/export?format=m3u",
            headers=self.auth_headers(),
        )
        assert m3u.status_code == 200, m3u.text
        assert m3u.text.splitlines()[0] == "#EXTM3U"
        assert "second.wav" in m3u.text
        assert "Road_Trip.m3u" in m3u.headers["content-disposition"]

        exported_json = self.client.get(
            f"/playlists/{playlist_id}/export?format=json",
            headers=self.auth_headers(),
        )
        assert exported_json.status_code == 200, exported_json.text
        assert [row["playlist_item"]["id"] for row in exported_json.json()["items"]] == list(
            reversed(item_ids)
        )

        removed = self.client.request(
            "DELETE",
            f"/playlists/{playlist_id}/items/{item_ids[1]}",
            headers=headers,
        )
        assert removed.status_code == 200, removed.text
        missing_item = self.client.request(
            "DELETE",
            f"/playlists/{playlist_id}/items/{item_ids[1]}",
            headers=headers,
        )
        assert missing_item.status_code == 404, missing_item.text

    def test_metadata_export_search_rebuild_and_orphan_cleanup(self):
        with Session(self.engine) as session:
            first = session.get(AudioItem, self.first.id)
            first.title_user = "导出标题"
            first.is_favorite = True
            linked = Tag(name="保留标签")
            orphan = Tag(name="孤儿标签")
            session.add_all([first, linked, orphan])
            session.commit()
            session.refresh(linked)
            session.add(AudioTag(audio_id=self.first.id, tag_id=linked.id))
            session.commit()

        rebuilt = self.client.post(
            "/maintenance/rebuild-search-index",
            headers=self.auth_headers(include_client=True),
        )
        assert rebuilt.status_code == 200, rebuilt.text
        assert rebuilt.json()["count"] == 2

        searched = self.client.get(
            "/search?q=%E5%AF%BC%E5%87%BA%E6%A0%87%E9%A2%98",
            headers=self.auth_headers(),
        )
        assert searched.status_code == 200, searched.text
        assert [row["id"] for row in searched.json()] == [self.first.id]

        csv_response = self.client.get(
            "/export/metadata?format=csv",
            headers=self.auth_headers(),
        )
        assert csv_response.status_code == 200, csv_response.text
        assert "导出标题" in csv_response.text
        assert "保留标签" in csv_response.text

        json_response = self.client.get(
            "/export/metadata?format=json",
            headers=self.auth_headers(),
        )
        exported = json.loads(json_response.text)
        first_export = next(row for row in exported if row["id"] == self.first.id)
        assert [tag["name"] for tag in first_export["tags"]] == ["保留标签"]

        cleaned = self.client.post(
            "/maintenance/cleanup-tags",
            headers=self.auth_headers(include_client=True),
        )
        assert cleaned.status_code == 200, cleaned.text
        assert cleaned.json() == {"ok": True, "deleted": 1}

        with Session(self.engine) as session:
            assert [tag.name for tag in session.exec(select(Tag)).all()] == ["保留标签"]
