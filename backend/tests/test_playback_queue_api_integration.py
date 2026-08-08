from sqlmodel import Session

from app.models import AudioItem

from tests.api_test_support import ApiIntegrationTest


class TestPlaybackQueueApiIntegration(ApiIntegrationTest):
    def test_resolve_preserves_order_and_skips_unavailable_items(self):
        enabled_root = self.add_library_root(self.root_path / "enabled")
        disabled_root = self.add_library_root(
            self.root_path / "disabled",
            enabled=False,
        )
        first = self.add_audio(
            self.root_path / "enabled" / "first.mp3",
            root_id=enabled_root.id,
        )
        second = self.add_audio(
            self.root_path / "enabled" / "second.mp3",
            root_id=enabled_root.id,
        )
        missing = self.add_audio(
            self.root_path / "enabled" / "missing.mp3",
            root_id=enabled_root.id,
        )
        disabled = self.add_audio(
            self.root_path / "disabled" / "disabled.mp3",
            root_id=disabled_root.id,
        )
        (self.root_path / "enabled" / "missing.mp3").unlink()

        response = self.client.post(
            "/audio-items/playback-queue/resolve",
            headers=self.auth_headers(include_client=True),
            json={
                "audio_ids": [
                    second.id,
                    999_999,
                    missing.id,
                    first.id,
                    disabled.id,
                    second.id,
                ]
            },
        )

        assert response.status_code == 200, response.text
        payload = response.json()
        assert [item['id'] for item in payload['items']] == [second.id, first.id]
        assert payload["skipped"] == [
            {"audio_id": 999999, "reason": "deleted"},
            {"audio_id": missing.id, "reason": "missing"},
            {"audio_id": disabled.id, "reason": "disabled_root"},
            {"audio_id": second.id, "reason": "duplicate"},
        ]

        with Session(self.engine) as session:
            assert session.get(AudioItem, missing.id).is_missing

    def test_resolve_requires_a_bounded_non_empty_queue(self):
        empty = self.client.post(
            "/audio-items/playback-queue/resolve",
            headers=self.auth_headers(include_client=True),
            json={"audio_ids": []},
        )
        oversized = self.client.post(
            "/audio-items/playback-queue/resolve",
            headers=self.auth_headers(include_client=True),
            json={"audio_ids": list(range(1, 502))},
        )

        assert empty.status_code == 422, empty.text
        assert oversized.status_code == 422, oversized.text
