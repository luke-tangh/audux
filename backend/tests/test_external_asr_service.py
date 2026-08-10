from pathlib import Path

import pytest

from app.services import external_asr_service
from app.services.common import ServiceError
from app.services.external_asr_service import (
    AudioChunk,
    ExternalAsrCanceled,
    merge_chunk_results,
    plan_audio_chunks,
    transcribe_external_audio_chunked,
)


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def test_ffmpeg_status_lists_missing_tools(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        external_asr_service.shutil,
        "which",
        lambda name: "/usr/bin/ffmpeg" if name == "ffmpeg" else None,
    )

    assert external_asr_service.get_ffmpeg_status() == {
        "available": False,
        "ffmpeg_available": True,
        "ffprobe_available": False,
        "missing": ["ffprobe"],
    }
    with pytest.raises(ServiceError) as caught:
        external_asr_service._require_ffmpeg()
    assert caught.value.code == "asr.ffmpeg_missing"


def test_preprocessing_status_requires_ffmpeg_and_bundled_vad(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(
        external_asr_service,
        "get_ffmpeg_status",
        lambda: {
            "available": True,
            "ffmpeg_available": True,
            "ffprobe_available": True,
            "missing": [],
        },
    )
    monkeypatch.setattr(
        external_asr_service,
        "get_vad_status",
        lambda: {
            "available": False,
            "model_available": False,
            "runtime_version": "1.23.2",
            "provider": None,
            "model": "silero_vad_16k_op15.onnx",
            "error": "missing",
        },
    )

    status = external_asr_service.get_preprocessing_status()

    assert status["available"] is False
    assert status["vad_available"] is False
    assert status["missing"] == ["silero_vad"]


def test_plans_chunks_at_silence_with_hard_cut_fallback():
    chunks = plan_audio_chunks(
        duration=70,
        maximum_seconds=30,
        overlap_seconds=1,
        silence_intervals=[(25, 27), (54, 56)],
    )

    assert chunks == [
        AudioChunk(0, 26),
        AudioChunk(25, 55),
        AudioChunk(54, 70),
    ]
    assert plan_audio_chunks(70, 30, 1, []) == [
        AudioChunk(0, 30),
        AudioChunk(29, 50),
        AudioChunk(49, 70),
    ]


def test_planner_uses_an_earlier_silence_to_avoid_a_short_tail():
    assert plan_audio_chunks(70, 30, 1, [(48, 50), (57, 59)]) == [
        AudioChunk(0, 30),
        AudioChunk(29, 49),
        AudioChunk(48, 70),
    ]


def test_merges_text_overlap_and_offsets_segments():
    result = merge_chunk_results(
        [AudioChunk(0, 30), AudioChunk(29, 50)],
        [
            {
                "full_text": "hello world",
                "language": "en",
                "model_name": "ark",
                "segments": [
                    {"start_seconds": 1, "end_seconds": 2, "text": "hello"}
                ],
            },
            {"full_text": "world again", "segments": []},
        ],
        "preferred",
    )

    assert result["full_text"] == "hello world\nagain"
    assert result["language"] == "en"
    assert result["model_name"] == "ark"
    assert result["segments"] == [
        {
            "segment_index": 0,
            "start_seconds": 1,
            "end_seconds": 2,
            "text": "hello",
        },
        {
            "segment_index": 1,
            "start_seconds": 30,
            "end_seconds": 50,
            "text": "again",
        },
    ]


def test_merge_normalizes_punctuation_case_and_cjk_overlap():
    result = merge_chunk_results(
        [AudioChunk(0, 30), AudioChunk(29, 50)],
        [
            {
                "full_text": "Hello, WORLD! 你好，世界。",
                "segments": [
                    {
                        "start_seconds": 1,
                        "end_seconds": 29,
                        "text": "Hello, WORLD! 你好，世界。",
                    }
                ],
            },
            {
                "full_text": "world 你好世界！今天继续",
                "segments": [
                    {
                        "start_seconds": 0.2,
                        "end_seconds": 4.2,
                        "text": "world 你好世界，今天继续",
                    }
                ],
            },
        ],
        "preferred",
    )

    assert result["full_text"] == "Hello, WORLD! 你好，世界。\n今天继续"
    assert [segment["text"] for segment in result["segments"]] == [
        "Hello, WORLD! 你好，世界。",
        "今天继续",
    ]
    assert result["segments"][1]["start_seconds"] == pytest.approx(31.969, abs=0.001)
    assert result["segments"][1]["end_seconds"] == 33.2


def test_merge_does_not_remove_partial_ascii_words():
    result = merge_chunk_results(
        [AudioChunk(0, 30), AudioChunk(29, 50)],
        [
            {"full_text": "an important action", "segments": []},
            {"full_text": "tion station", "segments": []},
        ],
        "preferred",
    )

    assert result["full_text"] == "an important action\ntion station"


def test_merge_removes_overlap_spanning_multiple_timeline_segments():
    result = merge_chunk_results(
        [AudioChunk(0, 30), AudioChunk(29, 50)],
        [
            {
                "full_text": "alpha beta gamma",
                "segments": [
                    {"start_seconds": 1, "end_seconds": 29, "text": "alpha beta gamma"}
                ],
            },
            {
                "full_text": "beta gamma delta",
                "segments": [
                    {"start_seconds": 0.1, "end_seconds": 1.1, "text": "beta"},
                    {"start_seconds": 1, "end_seconds": 2, "text": "gamma"},
                    {"start_seconds": 2, "end_seconds": 3, "text": "delta"},
                ],
            },
        ],
        "preferred",
    )

    assert result["full_text"] == "alpha beta gamma\ndelta"
    assert [segment["text"] for segment in result["segments"]] == [
        "alpha beta gamma",
        "delta",
    ]
    assert result["segments"][1]["start_seconds"] == 31


@pytest.mark.anyio
async def test_short_audio_is_uploaded_directly_and_required_gets_coarse_timeline(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    source = tmp_path / "source.mp3"
    source.write_bytes(b"audio")
    calls: list[dict] = []

    monkeypatch.setattr(external_asr_service, "_require_ffmpeg", lambda: ("ffmpeg", "ffprobe"))
    monkeypatch.setattr(external_asr_service, "_probe_duration", _async_value(12.5))

    async def fail_extract(*args, **kwargs):
        raise AssertionError("short audio must not be re-encoded")

    async def fake_transcribe(**kwargs):
        calls.append(kwargs)
        return {"full_text": "short result", "segments": []}

    monkeypatch.setattr(external_asr_service, "_extract_chunk", fail_extract)
    monkeypatch.setattr(external_asr_service, "transcribe_external_audio", fake_transcribe)

    result = await _transcribe(source, timestamp_policy="required")

    assert calls[0]["file_path"] == str(source)
    assert calls[0]["timestamp_policy"] == "preferred"
    assert result["segments"][0]["start_seconds"] == 0
    assert result["segments"][0]["end_seconds"] == 12.5


@pytest.mark.anyio
async def test_long_audio_extracts_and_uploads_chunks_sequentially(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    source = tmp_path / "source.mp3"
    source.write_bytes(b"audio")
    extracted: list[AudioChunk] = []
    uploads: list[str] = []

    monkeypatch.setattr(external_asr_service, "_require_ffmpeg", lambda: ("ffmpeg", "ffprobe"))
    monkeypatch.setattr(external_asr_service, "_probe_duration", _async_value(65))
    monkeypatch.setattr(
        external_asr_service,
        "detect_silence_intervals",
        _async_value([(27, 29)]),
    )

    async def fake_extract(ffmpeg, source_path, destination_path, chunk):
        extracted.append(chunk)
        Path(destination_path).write_bytes(b"wav")

    async def fake_transcribe(**kwargs):
        uploads.append(kwargs["file_path"])
        return {"full_text": f"part {len(uploads)}", "segments": []}

    monkeypatch.setattr(external_asr_service, "_extract_chunk", fake_extract)
    monkeypatch.setattr(external_asr_service, "transcribe_external_audio", fake_transcribe)

    result = await _transcribe(source)

    assert extracted == [
        AudioChunk(0, 28),
        AudioChunk(27, 46.5),
        AudioChunk(45.5, 65),
    ]
    assert len(uploads) == 3
    assert result["full_text"] == "part 1\npart 2\npart 3"


@pytest.mark.anyio
async def test_cancellation_is_checked_before_ffprobe(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    source = tmp_path / "source.mp3"
    source.write_bytes(b"audio")
    monkeypatch.setattr(external_asr_service, "_require_ffmpeg", lambda: ("ffmpeg", "ffprobe"))

    with pytest.raises(ExternalAsrCanceled):
        await _transcribe(source, is_canceled=lambda: True)


def _async_value(value):
    async def result(*args, **kwargs):
        return value

    return result


async def _transcribe(
    source: Path,
    *,
    timestamp_policy: str = "preferred",
    is_canceled=lambda: False,
):
    return await transcribe_external_audio_chunked(
        file_path=str(source),
        endpoint="http://127.0.0.1:8025/v1",
        model_name="ark-asr",
        api_key=None,
        language="zh",
        timestamp_policy=timestamp_policy,
        timeout=60,
        maximum_seconds=30,
        overlap_seconds=1,
        prefer_silence=True,
        vad_threshold=0.5,
        minimum_silence_ms=400,
        is_canceled=is_canceled,
    )
