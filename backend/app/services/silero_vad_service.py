import asyncio
import hashlib
import math
import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

# NumPy's BLAS defaults can reserve every CPU even though VAD only performs
# element-wise conversion around an ONNX model. Keep enough thread capacity for
# asyncio cancellation, FFmpeg orchestration, and the rest of the sidecar.
for _thread_env in (
    "OPENBLAS_NUM_THREADS",
    "OMP_NUM_THREADS",
    "MKL_NUM_THREADS",
    "NUMEXPR_NUM_THREADS",
):
    os.environ[_thread_env] = "1"

# Audux is local-first. ONNX Runtime 1.29 enables POSIX telemetry in official
# builds, so opt out before importing it; doing this later can already create a
# persistent device identifier and a ``*.ses`` file in the working directory.
os.environ["ORT_DISABLE_TELEMETRY"] = "1"

import numpy as np
import onnxruntime as ort


SAMPLE_RATE = 16_000
FRAME_SAMPLES = 512
CONTEXT_SAMPLES = 64
MODEL_FILE_NAME = "silero_vad_16k_op15.onnx"
MODEL_PATH = Path(__file__).resolve().parents[1] / "assets" / MODEL_FILE_NAME
MODEL_CHECKSUM_PATH = MODEL_PATH.with_suffix(f"{MODEL_PATH.suffix}.sha256")

_session: ort.InferenceSession | None = None
_session_lock = threading.Lock()


class SileroVadError(Exception):
    pass


class SileroVadCanceled(Exception):
    pass


@dataclass(frozen=True)
class SpeechInterval:
    start_seconds: float
    end_seconds: float


class SileroVadRunner:
    """Stateful NumPy-only wrapper for the bundled 16 kHz Silero model."""

    def __init__(self, session: ort.InferenceSession):
        self._session = session
        self._state = np.zeros((2, 1, 128), dtype=np.float32)
        self._context = np.zeros((1, CONTEXT_SAMPLES), dtype=np.float32)

    def predict(self, frame: np.ndarray) -> float:
        if frame.shape != (FRAME_SAMPLES,):
            raise ValueError(f"Silero VAD frames must contain {FRAME_SAMPLES} samples")

        model_input = np.concatenate((self._context, frame.reshape(1, -1)), axis=1)
        output, self._state = self._session.run(
            ["output", "stateN"],
            {
                "input": model_input,
                "state": self._state,
                "sr": np.asarray(SAMPLE_RATE, dtype=np.int64),
            },
        )
        self._context = model_input[:, -CONTEXT_SAMPLES:]
        return float(output[0][0])


def _verify_model_checksum() -> None:
    if not MODEL_PATH.is_file():
        raise SileroVadError(f"Bundled Silero VAD model is missing: {MODEL_FILE_NAME}")
    if not MODEL_CHECKSUM_PATH.is_file():
        raise SileroVadError("Bundled Silero VAD model checksum is missing")

    checksum_parts = MODEL_CHECKSUM_PATH.read_text(encoding="utf-8").split()
    if not checksum_parts or len(checksum_parts[0]) != 64:
        raise SileroVadError("Bundled Silero VAD model checksum is invalid")

    digest = hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest()
    if digest.lower() != checksum_parts[0].lower():
        raise SileroVadError("Bundled Silero VAD model checksum does not match")


def get_session() -> ort.InferenceSession:
    global _session

    if _session is not None:
        return _session

    with _session_lock:
        if _session is not None:
            return _session
        try:
            _verify_model_checksum()
            session_options = ort.SessionOptions()
            # VAD handles one 32 ms frame at a time. A large ONNX thread pool
            # adds overhead and can starve asyncio's worker thread in constrained
            # sidecar/test environments.
            session_options.intra_op_num_threads = 1
            session_options.inter_op_num_threads = 1
            session_options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
            _session = ort.InferenceSession(
                str(MODEL_PATH),
                sess_options=session_options,
                providers=["CPUExecutionProvider"],
            )
        except Exception as error:
            if isinstance(error, SileroVadError):
                raise
            raise SileroVadError(f"Unable to load bundled Silero VAD model: {error}") from error

    return _session


def get_vad_status() -> dict:
    try:
        session = get_session()
    except Exception as error:
        return {
            "available": False,
            "model_available": MODEL_PATH.is_file(),
            "runtime_version": ort.__version__,
            "provider": None,
            "model": MODEL_FILE_NAME,
            "error": str(error),
        }

    return {
        "available": True,
        "model_available": True,
        "runtime_version": ort.__version__,
        "provider": session.get_providers()[0],
        "model": MODEL_FILE_NAME,
        "error": None,
    }


def probabilities_to_speech_intervals(
    probabilities: list[float],
    sample_count: int,
    *,
    threshold: float,
    minimum_speech_ms: int = 250,
    minimum_silence_ms: int = 400,
) -> list[SpeechInterval]:
    if sample_count <= 0:
        return []

    negative_threshold = max(0.01, threshold - 0.15)
    minimum_speech_samples = minimum_speech_ms * SAMPLE_RATE / 1000
    minimum_silence_samples = minimum_silence_ms * SAMPLE_RATE / 1000
    speech: list[tuple[int, int]] = []
    speech_start: int | None = None
    silence_start: int | None = None

    for frame_index, probability in enumerate(probabilities):
        frame_start = frame_index * FRAME_SAMPLES
        frame_end = min(sample_count, frame_start + FRAME_SAMPLES)

        if probability >= threshold:
            if speech_start is None:
                speech_start = frame_start
            silence_start = None
            continue

        if speech_start is None or probability >= negative_threshold:
            continue

        if silence_start is None:
            silence_start = frame_start
        if frame_end - silence_start < minimum_silence_samples:
            continue

        if silence_start - speech_start >= minimum_speech_samples:
            speech.append((speech_start, silence_start))
        speech_start = None
        silence_start = None

    if speech_start is not None and sample_count - speech_start >= minimum_speech_samples:
        speech.append((speech_start, sample_count))

    return [
        SpeechInterval(start / SAMPLE_RATE, end / SAMPLE_RATE)
        for start, end in speech
        if end > start
    ]


def speech_to_silence_intervals(
    speech_intervals: list[SpeechInterval],
    duration_seconds: float,
) -> list[tuple[float, float]]:
    if duration_seconds <= 0:
        return []

    silence: list[tuple[float, float]] = []
    cursor = 0.0
    for interval in speech_intervals:
        start = min(duration_seconds, max(cursor, interval.start_seconds))
        end = min(duration_seconds, max(start, interval.end_seconds))
        if start > cursor:
            silence.append((cursor, start))
        cursor = max(cursor, end)
    if cursor < duration_seconds:
        silence.append((cursor, duration_seconds))
    return silence


async def _read_frame(stream: asyncio.StreamReader) -> bytes:
    expected = FRAME_SAMPLES * 2
    chunks: list[bytes] = []
    remaining = expected
    while remaining:
        chunk = await stream.read(remaining)
        if not chunk:
            break
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


async def _stop_process(process: asyncio.subprocess.Process) -> None:
    if process.returncode is not None:
        return
    process.terminate()
    try:
        await asyncio.wait_for(process.wait(), timeout=2)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()


async def detect_silence_intervals(
    *,
    ffmpeg: str,
    file_path: str,
    duration_seconds: float,
    threshold: float,
    minimum_silence_ms: int,
    is_canceled: Callable[[], bool],
) -> list[tuple[float, float]]:
    runner = SileroVadRunner(get_session())
    process = await asyncio.create_subprocess_exec(
        *[
            ffmpeg,
            "-hide_banner",
            "-nostdin",
            "-loglevel",
            "error",
            "-i",
            file_path,
            "-vn",
            "-sn",
            "-dn",
            "-ac",
            "1",
            "-ar",
            str(SAMPLE_RATE),
            "-f",
            "s16le",
            "-c:a",
            "pcm_s16le",
            "pipe:1",
        ],
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    if process.stdout is None or process.stderr is None:
        process.kill()
        await process.wait()
        raise SileroVadError("FFmpeg did not expose audio decoding pipes")

    stderr_task = asyncio.create_task(process.stderr.read())
    probabilities: list[float] = []
    sample_count = 0
    try:
        while True:
            if is_canceled():
                raise SileroVadCanceled()
            pcm = await _read_frame(process.stdout)
            if not pcm:
                break
            samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32)
            sample_count += len(samples)
            if len(samples) < FRAME_SAMPLES:
                samples = np.pad(samples, (0, FRAME_SAMPLES - len(samples)))
            samples /= 32768.0
            probabilities.append(runner.predict(samples))

            if len(probabilities) % 50 == 0:
                await asyncio.sleep(0)

        stderr = (await stderr_task).decode("utf-8", errors="replace")
        return_code = await process.wait()
        if return_code != 0:
            detail = stderr.strip().splitlines()[-1] if stderr.strip() else "unknown error"
            raise SileroVadError(f"FFmpeg failed while decoding audio for VAD: {detail}")
    except SileroVadCanceled:
        await _stop_process(process)
        await stderr_task
        raise
    except BaseException:
        await _stop_process(process)
        await stderr_task
        raise

    if not probabilities or sample_count <= 0:
        raise SileroVadError("FFmpeg produced no audio samples for VAD")

    speech = probabilities_to_speech_intervals(
        probabilities,
        sample_count,
        threshold=threshold,
        minimum_silence_ms=minimum_silence_ms,
    )
    decoded_duration = sample_count / SAMPLE_RATE
    effective_duration = min(duration_seconds, decoded_duration)
    if not math.isfinite(effective_duration) or effective_duration <= 0:
        raise SileroVadError("Decoded audio duration is invalid for VAD")
    return speech_to_silence_intervals(speech, effective_duration)
