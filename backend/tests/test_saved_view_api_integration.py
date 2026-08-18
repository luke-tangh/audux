import json

from sqlmodel import Session

from app.models import LibraryRoot, Playlist, PlaylistItem, SavedView, Tag
from tests.api_test_support import ApiIntegrationTest


def query_payload(**overrides) -> dict:
    payload = {
        "schema_version": 1,
        "view": "library",
        "q": "ambient",
        "tag_id": None,
        "library_root_id": None,
        "transcript_filter": "all",
        "missing_filter": "all",
        "sort": "updated_desc",
        "display_mode": "list",
    }
    payload.update(overrides)
    return payload


class TestSavedViewApi(ApiIntegrationTest):
    def mutate(self, method: str, url: str, json_body: dict | None = None):
        return self.client.request(
            method,
            url,
            headers=self.auth_headers(include_client=True),
            json=json_body,
        )

    def test_crud_copy_and_reorder(self):
        first_response = self.mutate(
            "POST",
            "/saved-views",
            {"name": "最近更新", "query": query_payload()},
        )
        assert first_response.status_code == 200, first_response.text
        first = first_response.json()
        assert first["name"] == "最近更新"
        assert first["query"]["sort"] == "updated_desc"

        duplicate = self.mutate(
            "POST",
            "/saved-views",
            {"name": "  最近更新  ", "query": query_payload()},
        )
        assert duplicate.status_code == 409
        assert duplicate.json()["detail"]["code"] == "saved_view.name_exists"

        updated_response = self.mutate(
            "PATCH",
            f"/saved-views/{first['id']}",
            {
                "name": "需要整理",
                "query": query_payload(view="missingDescription", q=""),
            },
        )
        assert updated_response.status_code == 200, updated_response.text
        assert updated_response.json()["query"]["view"] == "missingDescription"

        copy_response = self.mutate(
            "POST",
            f"/saved-views/{first['id']}/copy",
            {},
        )
        assert copy_response.status_code == 200, copy_response.text
        copied = copy_response.json()
        assert copied["name"] == "需要整理 副本"

        reorder_response = self.mutate(
            "PATCH",
            "/saved-views/reorder",
            {"view_ids": [copied["id"], first["id"]]},
        )
        assert reorder_response.status_code == 200, reorder_response.text
        assert [row["id"] for row in reorder_response.json()] == [
            copied["id"],
            first["id"],
        ]

        listed = self.client.get("/saved-views", headers=self.auth_headers())
        assert listed.status_code == 200
        assert [row["id"] for row in listed.json()] == [copied["id"], first["id"]]

        deleted = self.mutate("DELETE", f"/saved-views/{copied['id']}")
        assert deleted.status_code == 200
        assert deleted.json() == {"ok": True}

    def test_accepts_ai_failed_as_a_file_filter(self):
        created = self.mutate(
            "POST",
            "/saved-views",
            {
                "name": "AI 失败",
                "query": query_payload(q="", missing_filter="aiFailed"),
            },
        )

        assert created.status_code == 200, created.text
        assert created.json()["query"]["missing_filter"] == "aiFailed"

    def test_persists_and_resolves_multi_tag_rules(self):
        with Session(self.engine) as session:
            work = Tag(name="工作")
            review = Tag(name="复习")
            archive = Tag(name="归档")
            session.add_all([work, review, archive])
            session.commit()
            session.refresh(work)
            session.refresh(review)
            session.refresh(archive)
            work_id, review_id, archive_id = work.id, review.id, archive.id

        created = self.mutate(
            "POST",
            "/saved-views",
            {
                "name": "组合标签",
                "query": query_payload(
                    q="",
                    tag_ids=[work_id, review_id],
                    excluded_tag_ids=[archive_id],
                    tag_mode="or",
                ),
            },
        )

        assert created.status_code == 200, created.text
        payload = created.json()
        assert payload["query"]["tag_ids"] == [work_id, review_id]
        assert payload["query"]["excluded_tag_ids"] == [archive_id]
        assert payload["query"]["tag_mode"] == "or"
        assert payload["tag_names"] == ["工作", "复习"]
        assert payload["excluded_tag_names"] == ["归档"]

    def test_resolves_references_and_retains_view_after_they_are_deleted(self):
        root = self.add_library_root(self.root_path / "effects")
        with Session(self.engine) as session:
            tag = Tag(name="待处理")
            session.add(tag)
            session.commit()
            session.refresh(tag)
            tag_id = tag.id

        created = self.mutate(
            "POST",
            "/saved-views",
            {
                "name": "失效条件测试",
                "query": query_payload(
                    tag_id=tag_id,
                    library_root_id=root.id,
                    future_optional_field="ignored",
                ),
            },
        )
        assert created.status_code == 200, created.text
        assert created.json()["tag_name"] == "待处理"
        assert created.json()["library_root_path"] == str((self.root_path / "effects").resolve())

        with Session(self.engine) as session:
            session.delete(session.get(Tag, tag_id))
            session.delete(session.get(LibraryRoot, root.id))
            session.commit()

        listed = self.client.get("/saved-views", headers=self.auth_headers()).json()
        assert len(listed) == 1
        assert listed[0]["query"] is not None
        assert listed[0]["invalid_references"] == ["tag", "library_root"]

    def test_rejects_noncurrent_and_corrupt_stored_definitions(self):
        future = self.mutate(
            "POST",
            "/saved-views",
            {
                "name": "未来版本",
                "query": query_payload(schema_version=2),
            },
        )
        assert future.status_code == 422

        with Session(self.engine) as session:
            session.add_all(
                [
                    SavedView(
                        name="缺少版本视图",
                        query_json=json.dumps(
                            {
                                "view": "library",
                                "q": "missing-version",
                                "future_optional_field": "ignored",
                            }
                        ),
                        schema_version=1,
                    ),
                    SavedView(
                        name="损坏视图",
                        query_json=json.dumps(
                            {"schema_version": 1, "sort": "unknown"}
                        ),
                        schema_version=1,
                    ),
                ]
            )
            session.commit()

        listed = self.client.get("/saved-views", headers=self.auth_headers()).json()
        by_name = {row["name"]: row for row in listed}
        assert by_name["缺少版本视图"]["query"] is None
        assert by_name["缺少版本视图"]["definition_error"]
        assert by_name["损坏视图"]["query"] is None
        assert by_name["损坏视图"]["definition_error"]

    def test_library_root_filter_is_shared_by_library_and_playlist_queries(self):
        first_root = self.add_library_root(self.root_path / "first")
        second_root = self.add_library_root(self.root_path / "second")
        first_audio = self.add_audio(
            self.root_path / "first" / "first.mp3",
            root_id=first_root.id,
        )
        second_audio = self.add_audio(
            self.root_path / "second" / "second.mp3",
            root_id=second_root.id,
        )
        with Session(self.engine) as session:
            playlist = Playlist(name="Across roots")
            session.add(playlist)
            session.commit()
            session.refresh(playlist)
            session.add_all(
                [
                    PlaylistItem(
                        playlist_id=playlist.id,
                        audio_id=first_audio.id,
                        order_index=0,
                    ),
                    PlaylistItem(
                        playlist_id=playlist.id,
                        audio_id=second_audio.id,
                        order_index=1,
                    ),
                ]
            )
            session.commit()
            playlist_id = playlist.id

        response = self.client.get(
            f"/audio-items?library_root_id={second_root.id}",
            headers=self.auth_headers(),
        )
        assert response.status_code == 200, response.text
        assert [item["id"] for item in response.json()["items"]] == [second_audio.id]
        playlist_response = self.client.get(
            f"/playlists/{playlist_id}/items?library_root_id={first_root.id}",
            headers=self.auth_headers(),
        )
        assert playlist_response.status_code == 200, playlist_response.text
        assert [item["id"] for item in playlist_response.json()["items"]] == [
            first_audio.id
        ]
