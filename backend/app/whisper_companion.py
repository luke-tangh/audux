import json
import sys
from typing import Any

from .transcriber import transcribe_audio


PROTOCOL_VERSION = 1


def _required_string(payload: dict[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{key} must be a non-empty string")
    return value.strip()


def handle_request(payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("protocol_version") != PROTOCOL_VERSION:
        raise ValueError("Unsupported Whisper companion protocol version")
    if payload.get("action") != "transcribe":
        raise ValueError("Unsupported Whisper companion action")

    try:
        beam_size = int(payload.get("beam_size", 5))
    except (TypeError, ValueError) as error:
        raise ValueError("beam_size must be an integer") from error
    if beam_size <= 0:
        raise ValueError("beam_size must be greater than 0")

    result = transcribe_audio(
        file_path=_required_string(payload, "file_path"),
        model_name=_required_string(payload, "model_name"),
        device=_required_string(payload, "device"),
        compute_type=_required_string(payload, "compute_type"),
        beam_size=beam_size,
        download_root=_required_string(payload, "model_cache_dir"),
    )
    return {
        "protocol_version": PROTOCOL_VERSION,
        "ok": True,
        "result": result,
    }


def main() -> int:
    try:
        raw = sys.stdin.buffer.read()
        payload = json.loads(raw.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("Whisper companion request must be a JSON object")
        response = handle_request(payload)
        exit_code = 0
    except Exception as error:
        response = {
            "protocol_version": PROTOCOL_VERSION,
            "ok": False,
            "error": str(error),
        }
        exit_code = 1

    sys.stdout.write(json.dumps(response, ensure_ascii=False))
    sys.stdout.flush()
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
