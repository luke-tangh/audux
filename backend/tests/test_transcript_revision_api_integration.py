import pytest
from sqlmodel import Session, select

from app.models import AudioItem, Transcript, TranscriptSegment
from app.schemas import TranscriptSegmentUpdate
from app.search import search_audio_ids
from app.services import transcript_service
from tests.api_test_support import ApiIntegrationTest


class TestTranscriptRevisionApi(ApiIntegrationTest):
    @pytest.fixture(autouse=True)
    def setup_transcript(self, api_test_context):
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
        assert saved.status_code == 200, saved.text
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
        assert response.status_code == 200, response.text
        body = response.json()
        assert body['updated_segments'] == 1
        assert body['transcript']['full_text'] == '开场内容\n中间新关键词\n收尾内容'
        assert body['transcript']['updated_at'] != self.before['transcript']['updated_at']
        assert [
            (
                segment["segment_index"],
                segment["start_seconds"],
                segment["end_seconds"],
            )
            for segment in body["segments"]
        ] == [
            (
                segment["segment_index"],
                segment["start_seconds"],
                segment["end_seconds"],
            )
            for segment in self.before["segments"]
        ]
        assert [segment['text'] for segment in body['segments']] == ['开场内容', '中间新关键词', '收尾内容']

        txt_export = self.client.get(
            f"/audio-items/{self.audio.id}/transcript/export?format=txt",
            headers=self.auth_headers(),
        )
        assert txt_export.status_code == 200, txt_export.text
        assert txt_export.text == '开场内容\n中间新关键词\n收尾内容'

        json_export = self.client.get(
            f"/audio-items/{self.audio.id}/transcript/export?format=json",
            headers=self.auth_headers(),
        ).json()
        assert json_export['segments'][1]['text'] == '中间新关键词'

        with Session(self.engine) as session:
            assert search_audio_ids(session, '中间新关键词') == [self.audio.id]
            assert search_audio_ids(session, '中间旧内容') == []

        search_response = self.client.get(
            "/audio-items?q=中间新关键词",
            headers=self.auth_headers(),
        )
        assert search_response.status_code == 200, search_response.text
        transcript_hit = next(
            hit
            for hit in search_response.json()["items"][0]["search_hits"]
            if hit["field"] == "transcript"
        )
        assert transcript_hit['start_seconds'] == 2
        assert transcript_hit['segment_index'] == 1
        assert transcript_hit['context_before'] == '开场内容'
        assert transcript_hit['context_after'] == '收尾内容'

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
        assert first.status_code == 200, first.text

        stale = self.client.request(
            "PATCH",
            f"/audio-items/{self.audio.id}/transcript/segments",
            headers=self.auth_headers(include_client=True),
            json={
                "expected_updated_at": self.before["transcript"]["updated_at"],
                "segments": [{"id": middle["id"], "text": "过期覆盖"}],
            },
        )
        assert stale.status_code == 409, stale.text

        current = self.client.get(
            f"/audio-items/{self.audio.id}/transcript",
            headers=self.auth_headers(),
        ).json()
        assert current['segments'][1]['text'] == '先保存的版本'
        assert '过期覆盖' not in current['transcript']['full_text']

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
        assert blocked.status_code == 409, blocked.text

        current = self.client.get(
            f"/audio-items/{self.audio.id}/transcript",
            headers=self.auth_headers(),
        ).json()
        assert current['segments'][1]['text'] == '中间旧内容'

    def test_segment_revision_rolls_back_when_index_update_fails(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        middle = self.before["segments"][1]

        def fail_index_update(*args, **kwargs):
            raise RuntimeError("index failed")

        monkeypatch.setattr(
            transcript_service,
            "rebuild_audio_search_index",
            fail_index_update,
        )
        with pytest.raises(RuntimeError):
            with Session(self.engine) as session:
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
            assert transcript.full_text == '开场内容 中间旧内容 收尾内容'
            assert segments[1].text == '中间旧内容'
            assert search_audio_ids(session, '不应留下的修订') == []
