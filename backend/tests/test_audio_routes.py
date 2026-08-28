import asyncio

from app.routes import audio_routes
from app.services import audio_media_service


def test_cover_upload_reads_at_most_the_limit_plus_one(monkeypatch):
    class BoundedUpload:
        filename = "cover.png"
        content_type = "image/png"
        requested_size = None

        async def read(self, size: int):
            self.requested_size = size
            return b"cover"

    upload = BoundedUpload()
    captured = {}

    def store_cover(**kwargs):
        captured.update(kwargs)
        return "stored"

    monkeypatch.setattr(audio_media_service, "upload_audio_cover_data", store_cover)

    result = asyncio.run(audio_routes.upload_audio_cover(7, upload, session="session"))

    assert result == "stored"
    assert upload.requested_size == audio_media_service.MAX_COVER_BYTES + 1
    assert captured["data"] == b"cover"
