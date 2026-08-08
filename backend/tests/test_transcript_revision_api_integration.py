import unittest
from unittest.mock import patch

from sqlmodel import Session, select

from app.models import AudioItem, Transcript, TranscriptSegment
from app.schemas import TranscriptSegmentUpdate
from app.search import search_audio_ids
from app.services import transcript_service
from tests.api_test_support import ApiIntegrationTestCase


class TestTranscriptRevisionApi(ApiIntegrationTestCase, unittest.TestCase):
    def setUp(self):
        super().setUp()
        library = self.root_path / "library"
        root = self.add_library_root(library)
        self.audio = self.add_audio(library / "segments.mp3", root_id=root.id)

        saved = self.client.post(
            f"/audio-items/{self.audio.id}/transcript",
            headers=self.auth_headers(include_client=True),
            json={
                "language": "zh",
                "full_text": "开场内容 中间旧内容 收尾内容",
                "model_name": "test-model",
                "segments": [
                    {
                        "segment_index": 0,
                        "start_seconds": 0,
                        "end_seconds": 2,
                        "text": "开场内容",
                    },
                    {
                        "segment_index": 1,
                        "start_seconds": 2,
                        "end_seconds": 5,
                        "text": "中间旧内容",
                    },
                    {
                        "segment_index": 2,
                        "start_seconds": 5,
                        "end_seconds": 8,
                        "text": "收尾内容",
                    },
                ],
            },
        )
        self.assertEqual(saved.status_code, 200, saved.text)
        self.before = self.client.get(
            f"/audio-items/{self.audio.id}/transcript",
            headers=self.auth_headers(),
        ).json()

    def test_segment_revision_preserves_timeline_and_updates_exports_and_search(self):
        middle = self.before["segments"][1]
        response = self.client.request(
            "PATCH",
            f"/audio-items/{self.audio.id}/transcript/segments",
            headers=self.auth_headers(include_client=True),
            json={
                "expected_updated_at": self.before["transcript"]["updated_at"],
                "segments": [{"id": middle["id"], "text": "  中间新关键词  "}],
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["updated_segments"], 1)
        self.assertEqual(
            body["transcript"]["full_text"],
            "开场内容\n中间新关键词\n收尾内容",
        )
        self.assertNotEqual(
            body["transcript"]["updated_at"],
            self.before["transcript"]["updated_at"],
        )
        self.assertEqual(
            [
                (segment["segment_index"], segment["start_seconds"], segment["end_seconds"])
                for segment in body["segments"]
            ],
            [
                (segment["segment_index"], segment["start_seconds"], segment["end_seconds"])
                for segment in self.before["segments"]
            ],
        )
        self.assertEqual(
            [segment["text"] for segment in body["segments"]],
            ["开场内容", "中间新关键词", "收尾内容"],
        )

        txt_export = self.client.get(
            f"/audio-items/{self.audio.id}/transcript/export?format=txt",
            headers=self.auth_headers(),
        )
        self.assertEqual(txt_export.status_code, 200, txt_export.text)
        self.assertEqual(txt_export.text, "开场内容\n中间新关键词\n收尾内容")

        json_export = self.client.get(
            f"/audio-items/{self.audio.id}/transcript/export?format=json",
            headers=self.auth_headers(),
        ).json()
        self.assertEqual(json_export["segments"][1]["text"], "中间新关键词")

        with Session(self.engine) as session:
            self.assertEqual(search_audio_ids(session, "中间新关键词"), [self.audio.id])
            self.assertEqual(search_audio_ids(session, "中间旧内容"), [])

        search_response = self.client.get(
            "/audio-items?q=中间新关键词",
            headers=self.auth_headers(),
        )
        self.assertEqual(search_response.status_code, 200, search_response.text)
        transcript_hit = next(
            hit
            for hit in search_response.json()["items"][0]["search_hits"]
            if hit["field"] == "transcript"
        )
        self.assertEqual(transcript_hit["start_seconds"], 2)
        self.assertEqual(transcript_hit["segment_index"], 1)
        self.assertEqual(transcript_hit["context_before"], "开场内容")
        self.assertEqual(transcript_hit["context_after"], "收尾内容")

    def test_stale_segment_revision_is_rejected_without_overwriting(self):
        middle = self.before["segments"][1]
        first = self.client.request(
            "PATCH",
            f"/audio-items/{self.audio.id}/transcript/segments",
            headers=self.auth_headers(include_client=True),
            json={
                "expected_updated_at": self.before["transcript"]["updated_at"],
                "segments": [{"id": middle["id"], "text": "先保存的版本"}],
            },
        )
        self.assertEqual(first.status_code, 200, first.text)

        stale = self.client.request(
            "PATCH",
            f"/audio-items/{self.audio.id}/transcript/segments",
            headers=self.auth_headers(include_client=True),
            json={
                "expected_updated_at": self.before["transcript"]["updated_at"],
                "segments": [{"id": middle["id"], "text": "过期覆盖"}],
            },
        )
        self.assertEqual(stale.status_code, 409, stale.text)

        current = self.client.get(
            f"/audio-items/{self.audio.id}/transcript",
            headers=self.auth_headers(),
        ).json()
        self.assertEqual(current["segments"][1]["text"], "先保存的版本")
        self.assertNotIn("过期覆盖", current["transcript"]["full_text"])

    def test_segment_revision_is_blocked_while_transcription_is_active(self):
        middle = self.before["segments"][1]
        with Session(self.engine) as session:
            audio = session.get(AudioItem, self.audio.id)
            audio.transcript_status = "running"
            session.add(audio)
            session.commit()

        blocked = self.client.request(
            "PATCH",
            f"/audio-items/{self.audio.id}/transcript/segments",
            headers=self.auth_headers(include_client=True),
            json={
                "expected_updated_at": self.before["transcript"]["updated_at"],
                "segments": [{"id": middle["id"], "text": "不应保存"}],
            },
        )
        self.assertEqual(blocked.status_code, 409, blocked.text)

        current = self.client.get(
            f"/audio-items/{self.audio.id}/transcript",
            headers=self.auth_headers(),
        ).json()
        self.assertEqual(current["segments"][1]["text"], "中间旧内容")

    def test_segment_revision_rolls_back_when_index_update_fails(self):
        middle = self.before["segments"][1]

        with self.assertRaises(RuntimeError):
            with Session(self.engine) as session:
                with patch.object(
                    transcript_service,
                    "rebuild_audio_search_index",
                    side_effect=RuntimeError("index failed"),
                ):
                    transcript_service.update_transcript_segments(
                        session,
                        self.audio.id,
                        [
                            TranscriptSegmentUpdate(
                                id=middle["id"],
                                text="不应留下的修订",
                            )
                        ],
                        self.before["transcript"]["updated_at"],
                    )

        with Session(self.engine) as session:
            transcript = session.exec(
                select(Transcript).where(Transcript.audio_id == self.audio.id)
            ).one()
            segments = session.exec(
                select(TranscriptSegment)
                .where(TranscriptSegment.transcript_id == transcript.id)
                .order_by(TranscriptSegment.segment_index)
            ).all()
            self.assertEqual(transcript.full_text, "开场内容 中间旧内容 收尾内容")
            self.assertEqual(segments[1].text, "中间旧内容")
            self.assertEqual(
                search_audio_ids(session, "不应留下的修订"),
                [],
            )


if __name__ == "__main__":
    unittest.main()
