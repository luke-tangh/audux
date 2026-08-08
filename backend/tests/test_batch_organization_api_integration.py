import pytest
from sqlmodel import Session, select

from tests.api_test_support import ApiIntegrationTest
from app.models import AudioItem, AudioTag, Playlist, PlaylistItem, Tag
from app.search import search_audio_ids


class TestBatchOrganizationApi(ApiIntegrationTest):
    @pytest.fixture(autouse=True)
    def setup_audio_items(self, api_test_context):
        self.library = self.root_path / "library"
        self.root = self.add_library_root(self.library)
        self.first = self.add_audio(self.library / "first.mp3", root_id=self.root.id)
        self.second = self.add_audio(self.library / "second.mp3", root_id=self.root.id)

    def organize(self, payload: dict):
        return self.client.post(
            "/audio-items/batch/organize",
            headers=self.auth_headers(include_client=True),
            json=payload,
        )

    def test_add_and_remove_tags_reports_duplicates_and_invalid_audio(self):
        added = self.organize(
            {
                "audio_ids": [self.first.id, self.second.id, self.first.id, 99999],
                "action": "add_tags",
                "tag_names": [" 批量标签 ", "知识", "批量标签"],
            }
        )
        assert added.status_code == 200, added.text
        assert added.json() == {
            "action": "add_tags",
            "requested_count": 4,
            "matched_count": 2,
            "changed_count": 2,
            "unchanged_count": 0,
            "duplicate_count": 1,
            "relationship_changes": 4,
            "errors": [{"audio_id": 99999, "error": "Audio item not found"}],
        }

        with Session(self.engine) as session:
            tags = session.exec(select(Tag).order_by(Tag.name)).all()
            assert [tag.name for tag in tags] == ['批量标签', '知识']
            tag_ids = [tag.id for tag in tags]
            links = session.exec(
                select(AudioTag).where(AudioTag.tag_id.in_(tag_ids))
            ).all()
            assert len(links) == 4
            assert set(search_audio_ids(session, '批量标签')) == {self.first.id, self.second.id}
            remove_tag_id = tags[0].id

        removed = self.organize(
            {
                "audio_ids": [self.first.id, self.second.id],
                "action": "remove_tags",
                "tag_ids": [remove_tag_id],
            }
        )
        assert removed.status_code == 200, removed.text
        assert removed.json()['changed_count'] == 2
        assert removed.json()['relationship_changes'] == 2

        repeated = self.organize(
            {
                "audio_ids": [self.first.id, self.second.id],
                "action": "remove_tags",
                "tag_ids": [remove_tag_id],
            }
        )
        assert repeated.status_code == 200, repeated.text
        assert repeated.json()['changed_count'] == 0
        assert repeated.json()['unchanged_count'] == 2

        with Session(self.engine) as session:
            assert search_audio_ids(session, '批量标签') == []

    def test_add_to_playlist_is_ordered_and_idempotent(self):
        with Session(self.engine) as session:
            playlist = Playlist(name="批量 Playlist")
            session.add(playlist)
            session.commit()
            session.refresh(playlist)
            playlist_id = playlist.id

            session.add(
                PlaylistItem(
                    playlist_id=playlist_id,
                    audio_id=self.first.id,
                    order_index=0,
                )
            )
            session.commit()

        response = self.organize(
            {
                "audio_ids": [self.first.id, self.second.id],
                "action": "add_to_playlist",
                "playlist_id": playlist_id,
            }
        )
        assert response.status_code == 200, response.text
        assert response.json()['changed_count'] == 1
        assert response.json()['unchanged_count'] == 1

        with Session(self.engine) as session:
            items = session.exec(
                select(PlaylistItem)
                .where(PlaylistItem.playlist_id == playlist_id)
                .order_by(PlaylistItem.order_index)
            ).all()
            assert [
                (item.audio_id, item.order_index) for item in items
            ] == [
                (self.first.id, 0),
                (self.second.id, 1),
            ]

    def test_set_favorite_updates_valid_items_and_keeps_partial_errors(self):
        response = self.organize(
            {
                "audio_ids": [self.first.id, 99999, self.second.id],
                "action": "set_favorite",
                "is_favorite": True,
            }
        )
        assert response.status_code == 200, response.text
        assert response.json()['matched_count'] == 2
        assert response.json()['changed_count'] == 2
        assert len(response.json()['errors']) == 1

        repeated = self.organize(
            {
                "audio_ids": [self.first.id, self.second.id],
                "action": "set_favorite",
                "is_favorite": True,
            }
        )
        assert repeated.status_code == 200, repeated.text
        assert repeated.json()['changed_count'] == 0
        assert repeated.json()['unchanged_count'] == 2

        with Session(self.engine) as session:
            assert session.get(AudioItem, self.first.id).is_favorite
            assert session.get(AudioItem, self.second.id).is_favorite

    def test_action_payload_validation_and_resource_failure_do_not_partially_write(self):
        invalid_payload = self.organize(
            {
                "audio_ids": [self.first.id],
                "action": "add_tags",
                "tag_names": [],
            }
        )
        assert invalid_payload.status_code == 422, invalid_payload.text

        with Session(self.engine) as session:
            existing = Tag(name="保留标签")
            session.add(existing)
            session.commit()
            session.refresh(existing)
            existing_id = existing.id
            session.add(AudioTag(audio_id=self.first.id, tag_id=existing_id))
            session.commit()

        missing_tag = self.organize(
            {
                "audio_ids": [self.first.id],
                "action": "remove_tags",
                "tag_ids": [existing_id, 99999],
            }
        )
        assert missing_tag.status_code == 404, missing_tag.text

        with Session(self.engine) as session:
            assert session.get(AudioTag, (self.first.id, existing_id)) is not None
