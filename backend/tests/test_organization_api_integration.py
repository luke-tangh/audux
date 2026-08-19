import pytest
from sqlmodel import Session, select

from tests.api_test_support import ApiIntegrationTest
from app.models import (
    AudioItem,
    AudioTag,
    LibraryRoot,
    Playlist,
    PlaylistItem,
    ScanTask,
    Tag,
    Transcript,
    TranscriptSegment,
)
from app.search import search_audio_ids


class TestOrganizationApi(ApiIntegrationTest):
    @pytest.fixture(autouse=True)
    def setup_audio_item(self, api_test_context):
        self.library = self.root_path / "library"
        self.root = self.add_library_root(self.library)
        self.audio = self.add_audio(
            self.library / "organization.mp3",
            root_id=self.root.id,
        )

    def test_playlist_rename_and_delete_preserve_audio(self):
        created = self.client.post(
            "/playlists",
            headers=self.auth_headers(include_client=True),
            json={"name": "  初始列表  ", "description": "测试"},
        )
        assert created.status_code == 200, created.text
        playlist_id = created.json()["id"]
        assert created.json()['name'] == '初始列表'

        for _ in range(2):
            added = self.client.post(
                f"/playlists/{playlist_id}/items",
                headers=self.auth_headers(include_client=True),
                json={"audio_id": self.audio.id},
            )
            assert added.status_code == 200, added.text

        renamed = self.client.request(
            "PATCH",
            f"/playlists/{playlist_id}",
            headers=self.auth_headers(include_client=True),
            json={"name": "  学习列表  "},
        )
        assert renamed.status_code == 200, renamed.text
        assert renamed.json()['name'] == '学习列表'

        deleted = self.client.request(
            "DELETE",
            f"/playlists/{playlist_id}",
            headers=self.auth_headers(include_client=True),
        )
        assert deleted.status_code == 200, deleted.text
        assert deleted.json()['removed_items'] == 2

        with Session(self.engine) as session:
            assert session.get(Playlist, playlist_id) is None
            assert session.exec(
                select(PlaylistItem).where(PlaylistItem.playlist_id == playlist_id)
            ).all() == []
            assert session.get(AudioItem, self.audio.id) is not None

    def test_library_root_remove_is_non_destructive_and_blocks_active_scan(self):
        with Session(self.engine) as session:
            active = ScanTask(root_id=self.root.id, status="running")
            session.add(active)
            session.commit()
            session.refresh(active)
            active_id = active.id

        blocked = self.client.request(
            "DELETE",
            f"/library-roots/{self.root.id}",
            headers=self.auth_headers(include_client=True),
        )
        assert blocked.status_code == 409, blocked.text

        with Session(self.engine) as session:
            task = session.get(ScanTask, active_id)
            task.status = "done"
            session.add(task)
            session.commit()

        removed = self.client.request(
            "DELETE",
            f"/library-roots/{self.root.id}",
            headers=self.auth_headers(include_client=True),
        )
        assert removed.status_code == 200, removed.text
        assert removed.json()['detached_audio_items'] == 1
        assert removed.json()['removed_scan_tasks'] == 1
        assert (self.library / 'organization.mp3').exists()

        with Session(self.engine) as session:
            assert session.get(LibraryRoot, self.root.id) is None
            stored_audio = session.get(AudioItem, self.audio.id)
            assert stored_audio is not None
            assert stored_audio.library_root_id is None
            assert session.get(ScanTask, active_id) is None

    def test_tag_merge_deduplicates_links_and_rebuilds_search(self):
        second_audio = self.add_audio(
            self.library / "second.mp3",
            root_id=self.root.id,
        )

        with Session(self.engine) as session:
            source = Tag(name="旧标签")
            target = Tag(name="目标标签")
            session.add_all([source, target])
            session.commit()
            session.refresh(source)
            session.refresh(target)
            source_id = source.id
            target_id = target.id

            session.add_all(
                [
                    AudioTag(audio_id=self.audio.id, tag_id=source_id),
                    AudioTag(audio_id=second_audio.id, tag_id=source_id),
                    AudioTag(audio_id=second_audio.id, tag_id=target_id),
                ]
            )
            session.commit()

        merged = self.client.post(
            f"/tags/{source_id}/merge",
            headers=self.auth_headers(include_client=True),
            json={"target_tag_id": target_id},
        )
        assert merged.status_code == 200, merged.text
        assert merged.json()['affected_audio_items'] == 2
        assert merged.json()['created_links'] == 1

        with Session(self.engine) as session:
            assert session.get(Tag, source_id) is None
            links = session.exec(
                select(AudioTag).where(AudioTag.tag_id == target_id)
            ).all()
            assert {link.audio_id for link in links} == {self.audio.id, second_audio.id}
            assert len(links) == 2
            assert set(search_audio_ids(session, '目标标签')) == {self.audio.id, second_audio.id}
            assert search_audio_ids(session, '旧标签') == []

    def test_transcript_edit_clears_segments_and_rebuilds_search(self):
        saved = self.client.post(
            f"/audio-items/{self.audio.id}/transcript",
            headers=self.auth_headers(include_client=True),
            json={
                "language": "zh",
                "full_text": "旧的转写内容",
                "model_name": "test-model",
                "segments": [
                    {
                        "segment_index": 0,
                        "start_seconds": 0,
                        "end_seconds": 2,
                        "text": "旧的转写内容",
                    }
                ],
            },
        )
        assert saved.status_code == 200, saved.text
        before_edit = self.client.get(
            f"/audio-items/{self.audio.id}/transcript",
            headers=self.auth_headers(),
        )
        assert before_edit.status_code == 200, before_edit.text
        generated_at = before_edit.json()["transcript"]["generated_at"]

        unchanged = self.client.request(
            "PATCH",
            f"/audio-items/{self.audio.id}/transcript",
            headers=self.auth_headers(include_client=True),
            json={
                "full_text": "  旧的转写内容  ",
                "expected_updated_at": before_edit.json()["transcript"]["updated_at"],
            },
        )
        assert unchanged.status_code == 200, unchanged.text
        assert len(unchanged.json()['segments']) == 1
        assert unchanged.json()['cleared_segments'] == 0

        updated = self.client.request(
            "PATCH",
            f"/audio-items/{self.audio.id}/transcript",
            headers=self.auth_headers(include_client=True),
            json={
                "full_text": "  手动修订后的关键文本  ",
                "expected_updated_at": before_edit.json()["transcript"]["updated_at"],
            },
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()['transcript']['full_text'] == '手动修订后的关键文本'
        assert updated.json()['transcript']['generated_at'] != generated_at
        assert updated.json()['transcript']['revision_number'] == 2
        assert updated.json()['segments'] == []
        assert updated.json()['cleared_segments'] == 1

        with Session(self.engine) as session:
            transcript = session.exec(
                select(Transcript)
                .where(Transcript.audio_id == self.audio.id)
                .where(Transcript.is_current.is_(True))
            ).one()
            assert transcript.model_name == 'test-model'
            assert session.exec(
                select(TranscriptSegment).where(
                    TranscriptSegment.transcript_id == transcript.id
                )
            ).all() == []
            assert search_audio_ids(session, '手动修订') == [self.audio.id]
            assert search_audio_ids(session, '旧的转写') == []
            historical = session.exec(
                select(Transcript)
                .where(Transcript.audio_id == self.audio.id)
                .where(Transcript.is_current.is_(False))
            ).one()
            assert historical.generated_at == generated_at

            audio = session.get(AudioItem, self.audio.id)
            audio.transcript_status = "running"
            session.add(audio)
            session.commit()

        blocked = self.client.request(
            "PATCH",
            f"/audio-items/{self.audio.id}/transcript",
            headers=self.auth_headers(include_client=True),
            json={
                "full_text": "不应保存",
                "expected_updated_at": updated.json()["transcript"]["updated_at"],
            },
        )
        assert blocked.status_code == 409, blocked.text
