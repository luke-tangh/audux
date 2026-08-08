from pathlib import Path

import pytest

from app.transcriber import transcribe_audio, transcribe_audio_stub


class TestTranscriber:
    def test_transcribe_audio_missing_file_raises_before_loading_model(
        self,
        tmp_path: Path,
    ):
        missing = tmp_path / "missing.mp3"

        with pytest.raises(FileNotFoundError):
            transcribe_audio(str(missing))

    def test_transcribe_audio_stub_shape(self):
        result = transcribe_audio_stub("/tmp/demo.mp3")

        assert result["language"] == "unknown"
        assert result["model_name"] == "stub"
        assert "full_text" in result
        assert isinstance(result["segments"], list)
        assert len(result["segments"]) >= 1

        first_segment = result["segments"][0]
        assert first_segment["segment_index"] == 0
        assert "start_seconds" in first_segment
        assert "end_seconds" in first_segment
        assert "text" in first_segment
