import asyncio
import json
import math
import shutil
import subprocess
import tempfile
import unicodedata
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
from .silero_vad_service import (
    SileroVadCanceled,
    SileroVadError,
    detect_silence_intervals,
    get_vad_status,
)


MAX_NORMALIZED_OVERLAP_CHARACTERS = 2000
OVERLAP_CONTEXT_SOURCE_CHARACTERS = 8000
SEGMENT_TIMESTAMP_TOLERANCE_SECONDS = 0.75


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


def get_preprocessing_status() -> dict:
    ffmpeg_status = get_ffmpeg_status()
    vad_status = get_vad_status()
    missing = list(ffmpeg_status["missing"])
    if not vad_status["available"]:
        missing.append("silero_vad")
    return {
        **ffmpeg_status,
        "available": ffmpeg_status["available"] and vad_status["available"],
        "missing": missing,
        "vad_available": vad_status["available"],
        "vad_model_available": vad_status["model_available"],
        "vad_runtime_version": vad_status["runtime_version"],
        "vad_provider": vad_status["provider"],
        "vad_model": vad_status["model"],
        "vad_error": vad_status["error"],
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


def plan_audio_chunks(
    duration: float,
    maximum_seconds: float,
    overlap_seconds: float,
    silence_intervals: list[tuple[float, float]],
) -> list[AudioChunk]:
    if duration <= maximum_seconds:
        return [AudioChunk(0.0, duration)]

    silence_points = sorted(
        (clipped_start + clipped_end) / 2
        for start, end in silence_intervals
        if (clipped_start := max(0.0, start))
        < (clipped_end := min(duration, end))
        and clipped_end > 0
        and clipped_start < duration
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

        # A greedy hard cut can leave only a few seconds for the final request.
        # Short tail chunks have little context and tend to repeat or hallucinate.
        # Prefer an earlier silence when possible, otherwise balance the last two
        # chunks while preserving both the overlap and the maximum duration.
        tail_duration = duration - max(0.0, end - overlap_seconds)
        if tail_duration < minimum_advance:
            safe_silences = [
                point
                for point in eligible
                if duration - max(0.0, point - overlap_seconds)
                >= minimum_advance
            ]
            if safe_silences:
                end = safe_silences[-1]
            else:
                balanced_end = (start + duration + overlap_seconds) / 2
                end = min(
                    hard_end,
                    max(start + minimum_advance, balanced_end),
                )
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


def _fold_alphanumeric(value: str) -> tuple[str, list[int]]:
    folded_characters: list[str] = []
    source_indexes: list[int] = []
    for source_index, character in enumerate(value):
        folded = unicodedata.normalize("NFKC", character).casefold()
        for folded_character in folded:
            if folded_character.isalnum():
                folded_characters.append(folded_character)
                source_indexes.append(source_index)
    return "".join(folded_characters), source_indexes


def _is_ascii_word_character(value: str) -> bool:
    return bool(value) and value.isascii() and (value.isalnum() or value == "_")


def _is_overlap_boundary(
    previous: str,
    current: str,
    previous_start: int,
    current_end: int,
) -> bool:
    if (
        previous_start > 0
        and _is_ascii_word_character(previous[previous_start - 1])
        and _is_ascii_word_character(previous[previous_start])
    ):
        return False
    if (
        current_end + 1 < len(current)
        and _is_ascii_word_character(current[current_end])
        and _is_ascii_word_character(current[current_end + 1])
    ):
        return False
    return True


def _trim_leading_characters(
    value: str,
    character_count: int,
) -> tuple[str, int, int]:
    value = value.strip()
    _, source_indexes = _fold_alphanumeric(value)
    total = len(source_indexes)
    removed = min(max(0, character_count), total)
    if removed == 0:
        return value, 0, total
    if removed == total:
        return "", removed, total

    cut_index = source_indexes[removed - 1] + 1
    while cut_index < len(value):
        category = unicodedata.category(value[cut_index])
        if not value[cut_index].isspace() and not category.startswith("P"):
            break
        cut_index += 1
    return value[cut_index:].lstrip(), removed, total


def _trim_overlap(previous: str, current: str) -> tuple[str, int, int]:
    previous = previous.strip()
    current = current.strip()
    previous_folded, previous_indexes = _fold_alphanumeric(previous)
    current_folded, current_indexes = _fold_alphanumeric(current)
    maximum = min(
        len(previous_folded),
        len(current_folded),
        MAX_NORMALIZED_OVERLAP_CHARACTERS,
    )

    for size in range(maximum, 1, -1):
        matched = current_folded[:size]
        contains_non_ascii = any(not character.isascii() for character in matched)
        minimum = 2 if contains_non_ascii else 4
        if size < minimum or (not contains_non_ascii and size < 4):
            continue
        if previous_folded[-size:] != matched:
            continue

        previous_start = previous_indexes[len(previous_folded) - size]
        current_end = current_indexes[size - 1]
        if not _is_overlap_boundary(
            previous,
            current,
            previous_start,
            current_end,
        ):
            continue

        trimmed, _, _ = _trim_leading_characters(current, size)
        return trimmed, size, len(current_folded)

    return current, 0, len(current_folded)


def _remove_overlap(previous: str, current: str) -> str:
    return _trim_overlap(previous, current)[0]


def merge_chunk_results(
    chunks: list[AudioChunk],
    results: list[dict],
    timestamp_policy: str,
) -> dict:
    text_parts: list[str] = []
    text_context = ""
    segments: list[dict] = []
    language = None
    model_name = None

    for chunk_index, (chunk, result) in enumerate(
        zip(chunks, results, strict=True)
    ):
        raw_text = str(result.get("full_text") or "").strip()
        previous_text = text_context
        text = _remove_overlap(previous_text, raw_text) if text_parts else raw_text
        if text:
            text_parts.append(text)
            text_context = f"{text_context}\n{text}"[
                -OVERLAP_CONTEXT_SOURCE_CHARACTERS:
            ].lstrip()
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
            overlap_characters = 0
            overlap_duration = max(0.0, non_overlap_start - chunk.start_seconds)
            first_segment_start = chunk.start_seconds + float(
                chunk_segments[0]["start_seconds"]
            )
            deduplication_end = non_overlap_start + min(
                overlap_duration,
                SEGMENT_TIMESTAMP_TOLERANCE_SECONDS,
            )
            if chunk_index > 0 and first_segment_start < deduplication_end:
                segment_text = " ".join(
                    str(segment["text"]).strip()
                    for segment in chunk_segments
                )
                _, overlap_characters, _ = _trim_overlap(
                    previous_text,
                    segment_text,
                )

            for segment in chunk_segments:
                raw_start_seconds = chunk.start_seconds + float(
                    segment["start_seconds"]
                )
                end_seconds = min(
                    chunk.end_seconds,
                    chunk.start_seconds + float(segment["end_seconds"]),
                )
                segment_text = str(segment["text"]).strip()
                segment_text, removed, character_count = _trim_leading_characters(
                    segment_text,
                    overlap_characters,
                )
                overlap_characters -= removed
                if removed and character_count:
                    raw_start_seconds += (
                        (end_seconds - raw_start_seconds)
                        * removed
                        / character_count
                    )

                if end_seconds <= non_overlap_start:
                    continue
                start_seconds = max(non_overlap_start, raw_start_seconds)
                if end_seconds <= start_seconds:
                    continue
                if not segment_text:
                    continue
                segments.append(
                    {
                        "segment_index": len(segments),
                        "start_seconds": start_seconds,
                        "end_seconds": end_seconds,
                        "text": segment_text,
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
    vad_threshold: float,
    minimum_silence_ms: int,
    is_canceled: Callable[[], bool],
) -> dict:
    ffmpeg, ffprobe = _require_ffmpeg()
    if is_canceled():
        raise ExternalAsrCanceled()

    duration = await _probe_duration(ffprobe, file_path)
    silence_intervals: list[tuple[float, float]] = []
    if prefer_silence and duration > maximum_seconds:
        try:
            silence_intervals = await detect_silence_intervals(
                ffmpeg=ffmpeg,
                file_path=file_path,
                duration_seconds=duration,
                threshold=vad_threshold,
                minimum_silence_ms=minimum_silence_ms,
                is_canceled=is_canceled,
            )
        except SileroVadCanceled as error:
            raise ExternalAsrCanceled() from error
        except SileroVadError as error:
            raise ServiceError(
                500,
                str(error),
                code="asr.vad_failed",
            ) from error
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
