import asyncio
from pathlib import Path
import shutil
import wave

import pytest

from app.services import silero_vad_service
from app.services.silero_vad_service import (
    FRAME_SAMPLES,
    SAMPLE_RATE,
    SileroVadRunner,
    SpeechInterval,
    detect_silence_intervals,
    get_vad_status,
    probabilities_to_speech_intervals,
    speech_to_silence_intervals,
)

np = silero_vad_service.np


class FakeSession:
    def __init__(self):
        self.feeds: list[dict] = []

    def run(self, output_names, feed):
        self.feeds.append(feed)
        state = np.ones((2, 1, 128), dtype=np.float32)
        return np.asarray([[0.75]], dtype=np.float32), state


def test_runner_supplies_context_state_and_sample_rate():
    session = FakeSession()
    runner = SileroVadRunner(session)  # type: ignore[arg-type]

    assert runner.predict(np.zeros(FRAME_SAMPLES, dtype=np.float32)) == 0.75
    assert session.feeds[0]["input"].shape == (1, 576)
    assert session.feeds[0]["state"].shape == (2, 1, 128)
    assert session.feeds[0]["sr"].item() == SAMPLE_RATE

    runner.predict(np.ones(FRAME_SAMPLES, dtype=np.float32))
    assert np.all(session.feeds[1]["state"] == 1)


def test_probabilities_are_converted_to_speech_with_silence_hysteresis():
    probabilities = [0.01] * 10 + [0.8] * 20 + [0.01] * 15

    intervals = probabilities_to_speech_intervals(
        probabilities,
        sample_count=len(probabilities) * FRAME_SAMPLES,
        threshold=0.5,
        minimum_silence_ms=400,
    )

    assert intervals == [SpeechInterval(0.32, 0.96)]


def test_short_false_positive_is_not_treated_as_speech():
    probabilities = [0.01] * 5 + [0.9] * 2 + [0.01] * 15

    assert probabilities_to_speech_intervals(
        probabilities,
        sample_count=len(probabilities) * FRAME_SAMPLES,
        threshold=0.5,
    ) == []


def test_speech_intervals_are_inverted_to_chunking_silence_intervals():
    assert speech_to_silence_intervals(
        [SpeechInterval(1.0, 3.0), SpeechInterval(4.0, 6.0)],
        7.0,
    ) == [(0.0, 1.0), (3.0, 4.0), (6.0, 7.0)]


def test_bundled_model_checksum_and_cpu_runtime_are_available():
    status = get_vad_status()

    assert status["available"] is True
    assert status["model_available"] is True
    assert status["provider"] == "CPUExecutionProvider"
    assert status["runtime_version"] == "1.29.0"
    assert Path(silero_vad_service.MODEL_PATH).stat().st_size > 1_000_000


def test_runner_rejects_wrong_frame_size():
    runner = SileroVadRunner(FakeSession())  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="512"):
        runner.predict(np.zeros(100, dtype=np.float32))


def test_bundled_model_processes_ffmpeg_pcm_end_to_end(tmp_path: Path):
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        pytest.skip("system FFmpeg is unavailable")

    source = tmp_path / "silence.wav"
    with wave.open(str(source), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(SAMPLE_RATE)
        output.writeframes(b"\0\0" * SAMPLE_RATE)

    intervals = asyncio.run(
        detect_silence_intervals(
            ffmpeg=ffmpeg,
            file_path=str(source),
            duration_seconds=1.0,
            threshold=0.5,
            minimum_silence_ms=400,
            is_canceled=lambda: False,
        )
    )

    assert intervals == [(0.0, 1.0)]
