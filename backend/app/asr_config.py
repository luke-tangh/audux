import json
from urllib.parse import urlparse

from sqlmodel import Session

from .models import Setting
from .services.transcript_format_service import parse_case_glossary


ASR_PROVIDER_FASTER_WHISPER = "faster_whisper"
ASR_PROVIDER_EXTERNAL = "external"
SUPPORTED_ASR_PROVIDERS = {
    ASR_PROVIDER_FASTER_WHISPER,
    ASR_PROVIDER_EXTERNAL,
}

ASR_TIMESTAMP_OFF = "off"
ASR_TIMESTAMP_PREFERRED = "preferred"
ASR_TIMESTAMP_REQUIRED = "required"
SUPPORTED_ASR_TIMESTAMP_POLICIES = {
    ASR_TIMESTAMP_OFF,
    ASR_TIMESTAMP_PREFERRED,
    ASR_TIMESTAMP_REQUIRED,
}

EXTERNAL_CHUNK_SECONDS_DEFAULT = 28.0
EXTERNAL_CHUNK_OVERLAP_SECONDS_DEFAULT = 1.0
EXTERNAL_CHUNK_CONCURRENCY_DEFAULT = 1
EXTERNAL_VAD_THRESHOLD_DEFAULT = 0.5
EXTERNAL_MINIMUM_SILENCE_MS_DEFAULT = 400
# Public preset mirrored by frontend settingsUtils.ts. The formatter itself has
# no hidden entries, so every active replacement remains visible to the user.
DEFAULT_CASE_GLOSSARY = """I
Mr
Mrs
Dr
"""


def _get_setting(session: Session, key: str, default: str = "") -> str:
    row = session.get(Setting, key)
    return row.value if row else default


def _get_positive_int_setting(
    session: Session,
    key: str,
    default: int,
) -> int:
    raw = _get_setting(session, key, str(default)).strip()

    try:
        value = int(raw)
    except Exception as e:
        raise ValueError(f"{key} must be an integer") from e

    if value <= 0:
        raise ValueError(f"{key} must be greater than 0")

    return value


def _setting_truthy(value: object) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _finite_float(value: object, key: str) -> float:
    try:
        result = float(value)
    except Exception as e:
        raise ValueError(f"{key} must be a number") from e
    if result != result or result in {float("inf"), float("-inf")}:
        raise ValueError(f"{key} must be finite")
    return result


def _validate_external_endpoint(endpoint: str) -> str:
    value = endpoint.strip().rstrip("/")
    parsed = urlparse(value)

    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("asr.external.endpoint must be a valid http/https URL")

    try:
        parsed.port
    except ValueError as e:
        raise ValueError("asr.external.endpoint has an invalid port") from e

    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError(
            "asr.external.endpoint must not contain credentials, query or fragment"
        )

    return value


def normalize_asr_task_config(config: dict) -> dict:
    provider = str(config.get("provider") or ASR_PROVIDER_FASTER_WHISPER).strip().lower()
    if provider not in SUPPORTED_ASR_PROVIDERS:
        raise ValueError(f"Unsupported ASR provider: {provider}")

    if provider == ASR_PROVIDER_EXTERNAL:
        endpoint = _validate_external_endpoint(str(config.get("endpoint") or ""))
        model_name = str(config.get("model_name") or "").strip()
        if not model_name:
            raise ValueError("asr.external.model_name is required")

        language = str(config.get("language") or "auto").strip() or "auto"
        timestamp_policy = (
            str(config.get("timestamp_policy") or ASR_TIMESTAMP_PREFERRED)
            .strip()
            .lower()
        )
        if timestamp_policy not in SUPPORTED_ASR_TIMESTAMP_POLICIES:
            raise ValueError(
                "asr.external.timestamp_policy must be off, preferred or required"
            )

        try:
            timeout = int(config.get("timeout") or 3600)
        except Exception as e:
            raise ValueError("asr.external.timeout must be an integer") from e

        if timeout <= 0:
            raise ValueError("asr.external.timeout must be greater than 0")

        chunking_enabled = _setting_truthy(config.get("chunking_enabled"))
        chunk_seconds = _finite_float(
            config.get("chunk_seconds") or EXTERNAL_CHUNK_SECONDS_DEFAULT,
            "asr.external.chunk_seconds",
        )
        if chunk_seconds < 5 or chunk_seconds > 600:
            raise ValueError("asr.external.chunk_seconds must be between 5 and 600")

        raw_chunk_overlap_seconds = config.get("chunk_overlap_seconds")
        chunk_overlap_seconds = _finite_float(
            raw_chunk_overlap_seconds
            if raw_chunk_overlap_seconds is not None
            and raw_chunk_overlap_seconds != ""
            else EXTERNAL_CHUNK_OVERLAP_SECONDS_DEFAULT,
            "asr.external.chunk_overlap_seconds",
        )
        if (
            chunk_overlap_seconds < 0
            or chunk_overlap_seconds > 10
            or chunk_overlap_seconds >= chunk_seconds / 2
        ):
            raise ValueError(
                "asr.external.chunk_overlap_seconds must be at least 0, at most 10, "
                "and less than half the chunk duration"
            )

        try:
            chunk_concurrency = int(
                config.get("chunk_concurrency")
                or EXTERNAL_CHUNK_CONCURRENCY_DEFAULT
            )
        except Exception as e:
            raise ValueError(
                "asr.external.chunk_concurrency must be an integer"
            ) from e
        if chunk_concurrency < 1 or chunk_concurrency > 4:
            raise ValueError(
                "asr.external.chunk_concurrency must be between 1 and 4"
            )

        prefer_silence = _setting_truthy(config.get("prefer_silence", True))
        raw_vad_threshold = config.get("vad_threshold")
        vad_threshold = _finite_float(
            raw_vad_threshold
            if raw_vad_threshold is not None and raw_vad_threshold != ""
            else EXTERNAL_VAD_THRESHOLD_DEFAULT,
            "asr.external.vad_threshold",
        )
        if vad_threshold < 0.1 or vad_threshold > 0.9:
            raise ValueError(
                "asr.external.vad_threshold must be between 0.1 and 0.9"
            )

        try:
            minimum_silence_ms = int(
                config.get("minimum_silence_ms")
                or EXTERNAL_MINIMUM_SILENCE_MS_DEFAULT
            )
        except Exception as e:
            raise ValueError(
                "asr.external.minimum_silence_ms must be an integer"
            ) from e
        if minimum_silence_ms < 100 or minimum_silence_ms > 5000:
            raise ValueError(
                "asr.external.minimum_silence_ms must be between 100 and 5000"
            )

        formatting_enabled = _setting_truthy(
            config.get("formatting_enabled", True)
        )
        raw_case_glossary = config.get("case_glossary")
        case_glossary = (
            DEFAULT_CASE_GLOSSARY
            if raw_case_glossary is None
            else str(raw_case_glossary)
        )
        if formatting_enabled:
            parse_case_glossary(case_glossary)

        return {
            "provider": ASR_PROVIDER_EXTERNAL,
            "endpoint": endpoint,
            "model_name": model_name,
            "language": language,
            "timestamp_policy": timestamp_policy,
            "timeout": timeout,
            "chunking_enabled": chunking_enabled,
            "chunk_seconds": chunk_seconds,
            "chunk_overlap_seconds": chunk_overlap_seconds,
            "chunk_concurrency": chunk_concurrency,
            "prefer_silence": prefer_silence,
            "vad_threshold": vad_threshold,
            "minimum_silence_ms": minimum_silence_ms,
            "formatting_enabled": formatting_enabled,
            "case_glossary": case_glossary,
        }

    try:
        beam_size = int(config.get("beam_size") or 5)
    except Exception:
        beam_size = 5

    return {
        "provider": ASR_PROVIDER_FASTER_WHISPER,
        "model_name": str(config.get("model_name") or "small").strip() or "small",
        "device": str(config.get("device") or "cpu").strip() or "cpu",
        "compute_type": (
            str(config.get("compute_type") or "int8").strip() or "int8"
        ),
        "beam_size": beam_size,
    }


def build_asr_task_config(session: Session) -> dict:
    provider = (
        _get_setting(session, "asr.provider", ASR_PROVIDER_FASTER_WHISPER)
        .strip()
        .lower()
        or ASR_PROVIDER_FASTER_WHISPER
    )

    if provider == ASR_PROVIDER_EXTERNAL:
        config = {
            "provider": provider,
            "endpoint": _get_setting(session, "asr.external.endpoint"),
            "model_name": _get_setting(session, "asr.external.model_name"),
            "language": _get_setting(session, "asr.external.language", "auto"),
            "timestamp_policy": _get_setting(
                session,
                "asr.external.timestamp_policy",
                ASR_TIMESTAMP_PREFERRED,
            ),
            "timeout": _get_positive_int_setting(
                session,
                "asr.external.timeout",
                3600,
            ),
            "chunking_enabled": _get_setting(
                session,
                "asr.external.chunking_enabled",
                "false",
            ),
            "chunk_seconds": _get_setting(
                session,
                "asr.external.chunk_seconds",
                str(EXTERNAL_CHUNK_SECONDS_DEFAULT),
            ),
            "chunk_overlap_seconds": _get_setting(
                session,
                "asr.external.chunk_overlap_seconds",
                str(EXTERNAL_CHUNK_OVERLAP_SECONDS_DEFAULT),
            ),
            "chunk_concurrency": _get_setting(
                session,
                "asr.external.chunk_concurrency",
                str(EXTERNAL_CHUNK_CONCURRENCY_DEFAULT),
            ),
            "prefer_silence": _get_setting(
                session,
                "asr.external.prefer_silence",
                "true",
            ),
            "vad_threshold": _get_setting(
                session,
                "asr.external.vad_threshold",
                str(EXTERNAL_VAD_THRESHOLD_DEFAULT),
            ),
            "minimum_silence_ms": _get_setting(
                session,
                "asr.external.minimum_silence_ms",
                str(EXTERNAL_MINIMUM_SILENCE_MS_DEFAULT),
            ),
            "formatting_enabled": _get_setting(
                session,
                "asr.external.formatting_enabled",
                "true",
            ),
            "case_glossary": _get_setting(
                session,
                "asr.external.case_glossary",
                DEFAULT_CASE_GLOSSARY,
            ),
        }
    else:
        config = {
            "provider": provider,
            "model_name": _get_setting(session, "asr.model_name", "small"),
            "device": _get_setting(session, "asr.device", "cpu"),
            "compute_type": _get_setting(session, "asr.compute_type", "int8"),
            "beam_size": _get_setting(session, "asr.beam_size", "5"),
        }

    return normalize_asr_task_config(config)


def build_asr_task_payload(session: Session) -> dict:
    return {"asr": build_asr_task_config(session)}


def parse_task_input_payload(value: str | None) -> dict:
    if not value:
        return {}

    try:
        payload = json.loads(value)
    except Exception:
        return {}

    return payload if isinstance(payload, dict) else {}


def resolve_asr_task_config(input_payload: dict) -> dict:
    config = input_payload.get("asr")
    if not isinstance(config, dict):
        raise ValueError("Transcription task does not contain an ASR configuration")
    return normalize_asr_task_config(config)


def get_external_asr_api_key(session: Session) -> str:
    # Secrets are intentionally not copied into AITask.input_payload.
    return _get_setting(session, "asr.external.api_key")
