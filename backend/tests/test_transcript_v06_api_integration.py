from sqlmodel import Session, select

from app.models import AudioItem, Transcript, TranscriptChapter, TranscriptSegment
from tests.api_test_support import ApiIntegrationTest


class TestTranscriptV06Api(ApiIntegrationTest):
    def setup_method(self):
        self.library = self.root_path / "library" if hasattr(self, "root_path") else None

    def _audio(self):
        library = self.root_path / "library"
        root = self.add_library_root(library)
        audio = self.add_audio(library / "v06.mp3", root_id=root.id)
        with Session(self.engine) as session:
            stored = session.get(AudioItem, audio.id)
            stored.duration_seconds = 10
            session.add(stored)
            session.commit()
        return audio

    def _save(self, audio_id: int, *, text: str = "开场\n结尾", segments=None):
        return self.client.post(
            f"/audio-items/{audio_id}/transcript",
            headers=self.auth_headers(include_client=True),
            json={
                "language": "zh",
                "full_text": text,
                "model_name": "fixture-model",
                "provider_name": "fixture-asr",
                "task_config_summary": {
                    "beam_size": 5,
                    "api_key": "must-not-be-stored",
                },
                "glossary_version": "terms-v1",
                "quality_metrics": {
                    "average_confidence": 0.4,
                    "suspect_segments": [{"segment_index": 0, "reason": "low_logprob"}],
                },
                "segments": segments
                or [
                    {"segment_index": 0, "start_seconds": 0, "end_seconds": 2, "text": "开场"},
                    {"segment_index": 1, "start_seconds": 2, "end_seconds": 4, "text": "结尾"},
                ],
            },
        )

    def test_revisions_preserve_history_and_never_return_old_anchors_as_current(self):
        audio = self._audio()
        first = self._save(audio.id)
        assert first.status_code == 200, first.text
        first_body = first.json()
        first_segment_ids = [row["id"] for row in first_body["segments"]]
        assert first_body["transcript"]["revision_number"] == 1
        assert first_body["transcript"]["task_config_summary"]["api_key"] == "[redacted]"

        chapter = self.client.post(
            f"/audio-items/{audio.id}/transcript/chapters",
            headers=self.auth_headers(include_client=True),
            json={
                "expected_revision_id": first_body["transcript"]["id"],
                "title": "完整章节",
                "start_seconds": 0,
                "end_seconds": 4,
            },
        )
        assert chapter.status_code == 200, chapter.text

        second = self._save(audio.id, text="新内容", segments=[
            {"segment_index": 0, "start_seconds": 0, "end_seconds": 3, "text": "新内容"}
        ])
        assert second.status_code == 200, second.text
        second_body = second.json()
        assert second_body["transcript"]["revision_number"] == 2
        assert second_body["transcript"]["parent_revision_id"] == first_body["transcript"]["id"]
        assert second_body["chapters"] == []
        assert not first_segment_ids == [row["id"] for row in second_body["segments"]]

        history = self.client.get(
            f"/audio-items/{audio.id}/transcript/revisions",
            headers=self.auth_headers(),
        )
        assert [row["revision_number"] for row in history.json()] == [2, 1]
        old = self.client.get(
            f"/audio-items/{audio.id}/transcript/revisions/{first_body['transcript']['id']}",
            headers=self.auth_headers(),
        ).json()
        assert [row["id"] for row in old["segments"]] == first_segment_ids
        assert len(old["chapters"]) == 1

    def test_validator_emits_stable_codes_and_issue_lifecycle(self):
        audio = self._audio()
        response = self._save(
            audio.id,
            text="与分段不同",
            segments=[
                {"segment_index": 0, "start_seconds": 0, "end_seconds": 3, "text": "first"},
                {"segment_index": 1, "start_seconds": 2, "end_seconds": 1, "text": ""},
                {"segment_index": 2, "start_seconds": 9, "end_seconds": 12, "text": "last"},
            ],
        )
        assert response.status_code == 200, response.text
        body = response.json()
        codes = {issue["code"] for issue in body["issues"]}
        assert {
            "timeline.reversed",
            "timeline.overlap",
            "timeline.out_of_bounds",
            "segment.empty",
            "transcript.full_text_mismatch",
            "review.low_confidence",
            "review.required",
        }.issubset(codes)

        issue = body["issues"][0]
        closed = self.client.request(
            "PATCH",
            f"/audio-items/{audio.id}/transcript/issues/{issue['id']}",
            headers=self.auth_headers(include_client=True),
            json={"status": "dismissed", "closed_reason": "fixture_reviewed"},
        )
        assert closed.status_code == 200, closed.text
        assert closed.json()["closed_reason"] == "fixture_reviewed"

    def test_chapter_edit_merge_delete_and_transcript_delete_invalidate_current_data(self):
        audio = self._audio()
        assert self._save(audio.id).status_code == 200
        current_revision_id = self.client.get(
            f"/audio-items/{audio.id}/transcript",
            headers=self.auth_headers(),
        ).json()["transcript"]["id"]
        chapter_ids = []
        for title, start, end in [("A", 0, 2), ("B", 2, 4)]:
            response = self.client.post(
                f"/audio-items/{audio.id}/transcript/chapters",
                headers=self.auth_headers(include_client=True),
                json={
                    "expected_revision_id": current_revision_id,
                    "title": title,
                    "start_seconds": start,
                    "end_seconds": end,
                },
            )
            assert response.status_code == 200, response.text
            chapter_ids.append(response.json()["id"])

        merged = self.client.post(
            f"/audio-items/{audio.id}/transcript/chapters/merge",
            headers=self.auth_headers(include_client=True),
            json={"chapter_ids": chapter_ids, "title": "AB"},
        )
        assert merged.status_code == 200, merged.text
        assert merged.json()["start_seconds"] == 0
        assert merged.json()["end_seconds"] == 4

        deleted = self.client.request(
            "DELETE",
            f"/audio-items/{audio.id}/transcript",
            headers=self.auth_headers(include_client=True),
        )
        assert deleted.status_code == 200, deleted.text
        assert self.client.get(
            f"/audio-items/{audio.id}/transcript",
            headers=self.auth_headers(),
        ).status_code == 404
        with Session(self.engine) as session:
            assert session.exec(select(Transcript).where(Transcript.audio_id == audio.id)).all() == []
            assert session.exec(select(TranscriptSegment)).all() == []
            assert session.exec(select(TranscriptChapter)).all() == []
