from sqlalchemy import text
from sqlmodel import Session

from app.models import AITask, AudioItem, AudioTag, Tag
from tests.api_test_support import ApiIntegrationTest


class TestDiscoveryAndActivityApi(ApiIntegrationTest):
    def get(self, path: str):
        return self.client.get(path, headers=self.auth_headers())

    def test_search_is_ranked_and_pages_beyond_two_hundred_results(self):
        root = self.add_library_root(self.root_path / "ranked")
        with Session(self.engine) as session:
            title_match = AudioItem(
                file_path=str(self.root_path / "ranked" / "title.mp3"),
                file_name="title.mp3",
                title_user="rankword needle appears in the title",
                library_root_id=root.id,
            )
            transcript_match = AudioItem(
                file_path=str(self.root_path / "ranked" / "transcript.mp3"),
                file_name="transcript.mp3",
                title_user="unrelated recording",
                library_root_id=root.id,
            )
            session.add_all([title_match, transcript_match])
            session.commit()
            session.refresh(title_match)
            session.refresh(transcript_match)

            bulk = [
                AudioItem(
                    file_path=str(self.root_path / "ranked" / f"bulk-{index}.mp3"),
                    file_name=f"bulk-{index}.mp3",
                    title_user=f"needle bulk {index}",
                    library_root_id=root.id,
                )
                for index in range(230)
            ]
            session.add_all(bulk)
            session.commit()
            for item in bulk:
                session.refresh(item)

            rows = [
                {
                    "audio_id": title_match.id,
                    "title": title_match.title_user,
                    "author": "",
                    "description": "",
                    "tags": "",
                    "transcript": "",
                },
                {
                    "audio_id": transcript_match.id,
                    "title": transcript_match.title_user,
                    "author": "",
                    "description": "",
                    "tags": "",
                    "transcript": "rankword needle appears only in the transcript",
                },
                *[
                    {
                        "audio_id": item.id,
                        "title": item.title_user,
                        "author": "",
                        "description": "",
                        "tags": "",
                        "transcript": "",
                    }
                    for item in bulk
                ],
            ]
            session.execute(
                text(
                    """
                    INSERT INTO search_index(audio_id, title, author, description, tags, transcript)
                    VALUES (:audio_id, :title, :author, :description, :tags, :transcript)
                    """
                ),
                rows,
            )
            session.commit()
            title_match_id = title_match.id
            transcript_match_id = transcript_match.id

        ranked = self.get("/audio-items?q=rankword&limit=10")
        assert ranked.status_code == 200
        assert [item["id"] for item in ranked.json()["items"]] == [
            title_match_id,
            transcript_match_id,
        ]

        first = self.get("/audio-items?q=needle&limit=100")
        assert first.status_code == 200
        assert first.json()["total"] == 232
        assert first.json()["has_more"] is True
        assert first.json()["search_limited"] is False

        last = self.get("/audio-items?q=needle&limit=100&offset=200")
        assert last.status_code == 200
        assert len(last.json()["items"]) == 32
        assert last.json()["has_more"] is False

    def test_multi_tag_and_or_exclusion_and_facets(self):
        root = self.add_library_root(self.root_path / "tags")
        first = self.add_audio(self.root_path / "tags" / "first.mp3", root_id=root.id)
        second = self.add_audio(self.root_path / "tags" / "second.mp3", root_id=root.id)
        third = self.add_audio(self.root_path / "tags" / "third.mp3", root_id=root.id)
        root_id = root.id
        first_id = first.id
        second_id = second.id
        third_id = third.id
        with Session(self.engine) as session:
            work = Tag(name="work")
            review = Tag(name="review")
            session.add_all([work, review])
            session.commit()
            session.refresh(work)
            session.refresh(review)
            session.add_all([
                AudioTag(audio_id=first_id, tag_id=work.id),
                AudioTag(audio_id=second_id, tag_id=work.id),
                AudioTag(audio_id=second_id, tag_id=review.id),
                AudioTag(audio_id=third_id, tag_id=review.id),
            ])
            session.commit()
            work_id = work.id
            review_id = review.id

        both = self.get(f"/audio-items?tag_ids={work_id}&tag_ids={review_id}&tag_mode=and")
        assert [item["id"] for item in both.json()["items"]] == [second_id]

        either = self.get(f"/audio-items?tag_ids={work_id}&tag_ids={review_id}&tag_mode=or")
        assert {item["id"] for item in either.json()["items"]} == {first_id, second_id, third_id}
        facet_counts = {item["name"]: item["count"] for item in either.json()["facets"]["tags"]}
        assert facet_counts == {"review": 2, "work": 2}
        assert either.json()["facets"]["roots"] == [{"id": root_id, "path": str((self.root_path / "tags").resolve()), "count": 3}]

        excluded = self.get(f"/audio-items?tag_ids={work_id}&excluded_tag_ids={review_id}")
        assert [item["id"] for item in excluded.json()["items"]] == [first_id]

    def test_import_starts_scan_and_activity_feed_uses_titles(self, monkeypatch):
        async def skip_scan(_root_id, _task_id):
            return None

        monkeypatch.setattr(
            "app.routes.library_routes.scan_library_root_task",
            skip_scan,
        )
        folder = self.root_path / "new-library"
        folder.mkdir()
        response = self.client.post(
            "/library-roots/import",
            headers=self.auth_headers(include_client=True),
            json={"path": str(folder)},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["root"]["path"] == str(folder.resolve())
        scan_id = payload["scan_task"]["id"]

        audio = self.add_audio(folder / "named.mp3", root_id=payload["root"]["id"])
        with Session(self.engine) as session:
            row = session.get(AudioItem, audio.id)
            row.title_user = "Named activity"
            session.add(row)
            session.add(AITask(audio_id=audio.id, task_type="transcribe", status="pending"))
            session.commit()

        feed = self.get("/activities")
        assert feed.status_code == 200
        items = feed.json()["items"]
        assert any(item["id"] == f"scan:{scan_id}" for item in items)
        assert any(item["title"] == "Named activity" and item["kind"] == "transcribe" for item in items)
        assert feed.json()["active_count"] >= 1
