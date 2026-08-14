import math
import mimetypes
from pathlib import Path
from typing import Any

import httpx

from .asr_config import ASR_TIMESTAMP_OFF, ASR_TIMESTAMP_REQUIRED


def _number(value: Any, field: str) -> float:
    try:
        result = float(value)
    except Exception as e:
        raise ValueError(f"External ASR segment {field} must be a number") from e

    if not math.isfinite(result):
        raise ValueError(f"External ASR segment {field} must be finite")

    return result


def normalize_external_asr_response(
    response: dict,
    configured_model_name: str,
    timestamp_policy: str,
) -> dict:
    if not isinstance(response, dict):
        raise ValueError("External ASR response must be a JSON object")

    full_text = response.get("text")
    if not isinstance(full_text, str):
        raise ValueError("External ASR response must contain string field 'text'")

    raw_segments = response.get("segments") or []
    if not isinstance(raw_segments, list):
        raise ValueError("External ASR response field 'segments' must be an array")

    segments: list[dict] = []
    for index, item in enumerate(raw_segments):
        if not isinstance(item, dict):
            raise ValueError("External ASR segments must be JSON objects")

        start_value = item.get("start")
        end_value = item.get("end")
        text = item.get("text")

        if start_value is None or end_value is None or not isinstance(text, str):
            raise ValueError(
                "External ASR segment requires start, end and string text fields"
            )

        start = _number(start_value, "start")
        end = _number(end_value, "end")
        if start < 0 or end < start:
            raise ValueError("External ASR segment has an invalid time range")

        segments.append(
            {
                "segment_index": index,
                "start_seconds": start,
                "end_seconds": end,
                "text": text.strip(),
            }
        )

    if timestamp_policy == ASR_TIMESTAMP_REQUIRED and not segments:
        raise ValueError(
            "External ASR did not return segments while timestamps are required"
        )

    model_name = response.get("model") or configured_model_name
    language = response.get("language")

    return {
        "language": str(language) if language is not None else None,
        "model_name": str(model_name),
        "full_text": full_text.strip(),
        "segments": segments,
    }


async def transcribe_external_audio(
    file_path: str,
    endpoint: str,
    model_name: str,
    api_key: str | None = None,
    language: str = "auto",
    timestamp_policy: str = "preferred",
    timeout: int = 3600,
) -> dict:
    path = Path(file_path)
    if not path.exists() or not path.is_file():
        raise FileNotFoundError(f"Audio file not found: {file_path}")

    headers: dict[str, str] = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    data: dict[str, str] = {
        "model": model_name,
        "response_format": "verbose_json",
    }
    normalized_language = language.strip()
    if normalized_language and normalized_language.lower() != "auto":
        data["language"] = normalized_language
    if timestamp_policy != ASR_TIMESTAMP_OFF:
        data["timestamp_granularities[]"] = "segment"

    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    url = endpoint.rstrip("/") + "/audio/transcriptions"

    with path.open("rb") as audio_file:
        files = {
            "file": (path.name, audio_file, content_type),
        }
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                url,
                headers=headers,
                data=data,
                files=files,
            )
            response.raise_for_status()

    try:
        payload = response.json()
    except Exception as e:
        raise ValueError("External ASR response is not valid JSON") from e

    return normalize_external_asr_response(
        payload,
        configured_model_name=model_name,
        timestamp_policy=timestamp_policy,
    )
