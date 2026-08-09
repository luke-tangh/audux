import pytest
from sqlmodel import Session

from tests.api_test_support import ApiIntegrationTest
from app.models import AudioItem, Playlist, PlaylistItem


class TestAudioSortingApi(ApiIntegrationTest):
    @pytest.fixture(autouse=True)
    def setup_audio_items(self, api_test_context):
        library = self.root_path / "library"
        root = self.add_library_root(library)
        self.alpha = self.add_audio(library / "z-file.mp3", root_id=root.id)
        self.beta = self.add_audio(library / "beta.mp3", root_id=root.id)
        self.gamma = self.add_audio(library / "gamma.mp3", root_id=root.id)

        with Session(self.engine) as session:
            alpha = session.get(AudioItem, self.alpha.id)
            beta = session.get(AudioItem, self.beta.id)
            gamma = session.get(AudioItem, self.gamma.id)

            alpha.title_user = "Alpha"
            alpha.author_user = "Zulu"
            alpha.duration_seconds = 30
            alpha.play_count = 2
            alpha.created_at = "2026-01-01T00:00:00Z"
            alpha.updated_at = "2026-03-01T00:00:00Z"

            beta.title_original = "Beta"
            beta.author_original = "Alpha"
            beta.duration_seconds = None
            beta.play_count = 8
            beta.created_at = "2026-03-01T00:00:00Z"
            beta.updated_at = "2026-01-01T00:00:00Z"

            gamma.title_original = "Gamma"
            gamma.author_original = "Mike"
            gamma.duration_seconds = 90
            gamma.play_count = 4
            gamma.created_at = "2026-02-01T00:00:00Z"
            gamma.updated_at = "2026-02-01T00:00:00Z"
            session.add_all([alpha, beta, gamma])
            session.commit()

    def sorted_ids(self, sort: str) -> list[int]:
        response = self.client.get(
            f"/audio-items?sort={sort}",
            headers=self.auth_headers(),
        )
        assert response.status_code == 200, response.text
        return [item["id"] for item in response.json()["items"]]

    def test_library_sort_modes(self):
        assert self.sorted_ids("title_asc") == [
            self.alpha.id,
            self.beta.id,
            self.gamma.id,
        ]
        assert self.sorted_ids("title_desc") == [
            self.gamma.id,
            self.beta.id,
            self.alpha.id,
        ]
        assert self.sorted_ids("author_asc") == [
            self.beta.id,
            self.gamma.id,
            self.alpha.id,
        ]
        assert self.sorted_ids("created_desc") == [
            self.beta.id,
            self.gamma.id,
            self.alpha.id,
        ]
        assert self.sorted_ids("updated_desc") == [
            self.alpha.id,
            self.gamma.id,
            self.beta.id,
        ]
        assert self.sorted_ids("duration_asc") == [
            self.alpha.id,
            self.gamma.id,
            self.beta.id,
        ]
        assert self.sorted_ids("duration_desc") == [
            self.gamma.id,
            self.alpha.id,
            self.beta.id,
        ]
        assert self.sorted_ids("play_count_desc") == [
            self.beta.id,
            self.gamma.id,
            self.alpha.id,
        ]

    def test_playlist_keeps_manual_default_and_accepts_explicit_sort(self):
        with Session(self.engine) as session:
            playlist = Playlist(name="Sorted playlist")
            session.add(playlist)
            session.commit()
            session.refresh(playlist)
            session.add_all(
                [
                    PlaylistItem(
                        playlist_id=playlist.id,
                        audio_id=self.gamma.id,
                        order_index=0,
                    ),
                    PlaylistItem(
                        playlist_id=playlist.id,
                        audio_id=self.alpha.id,
                        order_index=1,
                    ),
                    PlaylistItem(
                        playlist_id=playlist.id,
                        audio_id=self.beta.id,
                        order_index=2,
                    ),
                ]
            )
            session.commit()
            playlist_id = playlist.id

        default_response = self.client.get(
            f"/playlists/{playlist_id}/items",
            headers=self.auth_headers(),
        )
        sorted_response = self.client.get(
            f"/playlists/{playlist_id}/items?sort=title_asc",
            headers=self.auth_headers(),
        )

        assert [item["id"] for item in default_response.json()["items"]] == [
            self.gamma.id,
            self.alpha.id,
            self.beta.id,
        ]
        assert [item["id"] for item in sorted_response.json()["items"]] == [
            self.alpha.id,
            self.beta.id,
            self.gamma.id,
        ]

    def test_rejects_unknown_sort_mode(self):
        response = self.client.get(
            "/audio-items?sort=unsupported",
            headers=self.auth_headers(),
        )
        assert response.status_code == 422
