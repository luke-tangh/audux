import asyncio
import json
import math
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from ..asr_client import transcribe_external_audio
from ..asr_config import (
    ASR_TIMESTAMP_OFF,
    ASR_TIMESTAMP_PREFERRED,
    ASR_TIMESTAMP_REQUIRED,
)
from .common import ServiceError


SILENCE_START_RE = re.compile(r"silence_start:\s*([0-9]+(?:\.[0-9]+)?)")
SILENCE_END_RE = re.compile(r"silence_end:\s*([0-9]+(?:\.[0-9]+)?)")


class ExternalAsrCanceled(Exception):
    pass


@dataclass(frozen=True)
class AudioChunk:
    start_seconds: float
    end_seconds: float


def get_ffmpeg_status() -> dict:
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    missing = [
        name
        for name, executable in (("ffmpeg", ffmpeg), ("ffprobe", ffprobe))
        if not executable
    ]
    return {
        "available": not missing,
        "ffmpeg_available": bool(ffmpeg),
        "ffprobe_available": bool(ffprobe),
        "missing": missing,
    }


def _require_ffmpeg() -> tuple[str, str]:
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        raise ServiceError(
            400,
            "System FFmpeg and ffprobe are required for external ASR chunking.",
            code="asr.ffmpeg_missing",
        )
    return ffmpeg, ffprobe


def _run_command(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=False,
        encoding="utf-8",
        errors="replace",
    )


async def _run_checked(command: list[str], phase: str) -> subprocess.CompletedProcess[str]:
    result = await asyncio.to_thread(_run_command, command)
    if result.returncode != 0:
        raise ServiceError(
            500,
            f"FFmpeg failed while {phase} external ASR audio.",
            code="asr.ffmpeg_failed",
            params={"phase": phase},
        )
    return result


async def _probe_duration(ffprobe: str, file_path: str) -> float:
    result = await _run_checked(
        [
            ffprobe,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            file_path,
        ],
        "probing",
    )
    try:
        payload = json.loads(result.stdout)
        duration = float(payload["format"]["duration"])
    except Exception as error:
        raise ServiceError(
            500,
            "FFprobe returned an invalid audio duration.",
            code="asr.ffprobe_invalid",
        ) from error
    if not math.isfinite(duration) or duration <= 0:
        raise ServiceError(
            400,
            "Audio duration must be greater than zero for external ASR chunking.",
            code="asr.audio_duration_invalid",
        )
    return duration


def parse_silence_intervals(stderr: str, duration: float) -> list[tuple[float, float]]:
    intervals: list[tuple[float, float]] = []
    silence_start: float | None = None
    for line in stderr.splitlines():
        start_match = SILENCE_START_RE.search(line)
        if start_match:
            silence_start = max(0.0, float(start_match.group(1)))
        end_match = SILENCE_END_RE.search(line)
        if end_match and silence_start is not None:
            silence_end = min(duration, float(end_match.group(1)))
            if silence_end > silence_start:
                intervals.append((silence_start, silence_end))
            silence_start = None
    if silence_start is not None and duration > silence_start:
        intervals.append((silence_start, duration))
    return intervals


async def _detect_silences(
    ffmpeg: str,
    file_path: str,
    duration: float,
    threshold_db: float,
    minimum_silence_ms: int,
) -> list[tuple[float, float]]:
    result = await _run_checked(
        [
            ffmpeg,
            "-hide_banner",
            "-nostdin",
            "-i",
            file_path,
            "-af",
            (
                f"silencedetect=noise={threshold_db:g}dB:"
                f"d={minimum_silence_ms / 1000:g}"
            ),
            "-f",
            "null",
            "-",
        ],
        "detecting silence in",
    )
    return parse_silence_intervals(result.stderr, duration)


def plan_audio_chunks(
    duration: float,
    maximum_seconds: float,
    overlap_seconds: float,
    silence_intervals: list[tuple[float, float]],
) -> list[AudioChunk]:
    if duration <= maximum_seconds:
        return [AudioChunk(0.0, duration)]

    silence_points = sorted(
        (start + end) / 2
        for start, end in silence_intervals
        if 0 < start < duration and start < end
    )
    minimum_advance = max(1.0, maximum_seconds * 0.5)
    chunks: list[AudioChunk] = []
    start = 0.0

    while start < duration:
        hard_end = min(duration, start + maximum_seconds)
        if hard_end >= duration:
            chunks.append(AudioChunk(start, duration))
            break

        eligible = [
            point
            for point in silence_points
            if start + minimum_advance <= point <= hard_end
        ]
        end = eligible[-1] if eligible else hard_end
        chunks.append(AudioChunk(start, end))

        next_start = max(0.0, end - overlap_seconds)
        if next_start <= start:
            next_start = end
        start = next_start

    return chunks


async def _extract_chunk(
    ffmpeg: str,
    source_path: str,
    destination_path: str,
    chunk: AudioChunk,
) -> None:
    await _run_checked(
        [
            ffmpeg,
            "-hide_banner",
            "-nostdin",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            f"{chunk.start_seconds:.3f}",
            "-t",
            f"{chunk.end_seconds - chunk.start_seconds:.3f}",
            "-i",
            source_path,
            "-map_metadata",
            "-1",
            "-vn",
            "-sn",
            "-dn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            destination_path,
        ],
        "extracting",
    )


def _remove_overlap(previous: str, current: str) -> str:
    previous = previous.strip()
    current = current.strip()
    maximum = min(len(previous), len(current), 160)
    previous_folded = previous.casefold()
    current_folded = current.casefold()
    for size in range(maximum, 3, -1):
        if previous_folded[-size:] == current_folded[:size]:
            return current[size:].lstrip()
    return current


def merge_chunk_results(
    chunks: list[AudioChunk],
    results: list[dict],
    timestamp_policy: str,
) -> dict:
    text_parts: list[str] = []
    segments: list[dict] = []
    previous_raw_text = ""
    language = None
    model_name = None

    for chunk_index, (chunk, result) in enumerate(
        zip(chunks, results, strict=True)
    ):
        raw_text = str(result.get("full_text") or "").strip()
        text = _remove_overlap(previous_raw_text, raw_text) if text_parts else raw_text
        if text:
            text_parts.append(text)
        previous_raw_text = raw_text
        language = language or result.get("language")
        model_name = model_name or result.get("model_name")

        if timestamp_policy == ASR_TIMESTAMP_OFF:
            continue

        chunk_segments = result.get("segments") or []
        non_overlap_start = (
            chunks[chunk_index - 1].end_seconds
            if chunk_index > 0
            else chunk.start_seconds
        )
        if chunk_segments:
            for segment in chunk_segments:
                start_seconds = max(
                    non_overlap_start,
                    chunk.start_seconds + float(segment["start_seconds"]),
                )
                end_seconds = min(
                    chunk.end_seconds,
                    chunk.start_seconds + float(segment["end_seconds"]),
                )
                if end_seconds <= start_seconds:
                    continue
                segments.append(
                    {
                        "segment_index": len(segments),
                        "start_seconds": start_seconds,
                        "end_seconds": end_seconds,
                        "text": str(segment["text"]).strip(),
                    }
                )
        elif text:
            segments.append(
                {
                    "segment_index": len(segments),
                    "start_seconds": non_overlap_start,
                    "end_seconds": chunk.end_seconds,
                    "text": text,
                }
            )

    return {
        "language": language,
        "model_name": model_name,
        "full_text": "\n".join(text_parts),
        "segments": segments,
    }


async def transcribe_external_audio_chunked(
    *,
    file_path: str,
    endpoint: str,
    model_name: str,
    api_key: str | None,
    language: str,
    timestamp_policy: str,
    timeout: int,
    maximum_seconds: float,
    overlap_seconds: float,
    prefer_silence: bool,
    silence_threshold_db: float,
    minimum_silence_ms: int,
    is_canceled: Callable[[], bool],
) -> dict:
    ffmpeg, ffprobe = _require_ffmpeg()
    if is_canceled():
        raise ExternalAsrCanceled()

    duration = await _probe_duration(ffprobe, file_path)
    silence_intervals: list[tuple[float, float]] = []
    if prefer_silence and duration > maximum_seconds:
        silence_intervals = await _detect_silences(
            ffmpeg,
            file_path,
            duration,
            silence_threshold_db,
            minimum_silence_ms,
        )
    chunks = plan_audio_chunks(
        duration,
        maximum_seconds,
        overlap_seconds,
        silence_intervals,
    )
    request_timestamp_policy = (
        ASR_TIMESTAMP_PREFERRED
        if timestamp_policy == ASR_TIMESTAMP_REQUIRED
        else timestamp_policy
    )

    results: list[dict] = []
    if len(chunks) == 1:
        if is_canceled():
            raise ExternalAsrCanceled()
        result = await transcribe_external_audio(
            file_path=file_path,
            endpoint=endpoint,
            model_name=model_name,
            api_key=api_key,
            language=language,
            timestamp_policy=request_timestamp_policy,
            timeout=timeout,
        )
        return merge_chunk_results(chunks, [result], timestamp_policy)

    with tempfile.TemporaryDirectory(prefix="local-audio-asr-chunks-") as tmp_dir:
        for index, chunk in enumerate(chunks):
            if is_canceled():
                raise ExternalAsrCanceled()
            chunk_path = str(Path(tmp_dir) / f"chunk-{index:05d}.wav")
            await _extract_chunk(ffmpeg, file_path, chunk_path, chunk)
            if is_canceled():
                raise ExternalAsrCanceled()
            result = await transcribe_external_audio(
                file_path=chunk_path,
                endpoint=endpoint,
                model_name=model_name,
                api_key=api_key,
                language=language,
                timestamp_policy=request_timestamp_policy,
                timeout=timeout,
            )
            results.append(result)

    return merge_chunk_results(chunks, results, timestamp_policy)
