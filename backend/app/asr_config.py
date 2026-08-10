import json
from urllib.parse import urlparse

from sqlmodel import Session

from .models import Setting


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
EXTERNAL_SILENCE_THRESHOLD_DB_DEFAULT = -35.0
EXTERNAL_MINIMUM_SILENCE_MS_DEFAULT = 400


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

        prefer_silence = _setting_truthy(config.get("prefer_silence", True))
        raw_silence_threshold_db = config.get("silence_threshold_db")
        silence_threshold_db = _finite_float(
            raw_silence_threshold_db
            if raw_silence_threshold_db is not None
            and raw_silence_threshold_db != ""
            else EXTERNAL_SILENCE_THRESHOLD_DB_DEFAULT,
            "asr.external.silence_threshold_db",
        )
        if silence_threshold_db < -80 or silence_threshold_db > -5:
            raise ValueError(
                "asr.external.silence_threshold_db must be between -80 and -5"
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
            "prefer_silence": prefer_silence,
            "silence_threshold_db": silence_threshold_db,
            "minimum_silence_ms": minimum_silence_ms,
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
            "prefer_silence": _get_setting(
                session,
                "asr.external.prefer_silence",
                "true",
            ),
            "silence_threshold_db": _get_setting(
                session,
                "asr.external.silence_threshold_db",
                str(EXTERNAL_SILENCE_THRESHOLD_DB_DEFAULT),
            ),
            "minimum_silence_ms": _get_setting(
                session,
                "asr.external.minimum_silence_ms",
                str(EXTERNAL_MINIMUM_SILENCE_MS_DEFAULT),
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


def resolve_asr_task_config(session: Session, input_payload: dict) -> dict:
    config = input_payload.get("asr")
    if isinstance(config, dict):
        return normalize_asr_task_config(config)

    # Tasks created by older versions have an empty payload. Preserve retry and
    # interrupted-task compatibility by resolving those against current settings.
    return build_asr_task_config(session)


def get_external_asr_api_key(session: Session) -> str:
    # Secrets are intentionally not copied into AITask.input_payload.
    return _get_setting(session, "asr.external.api_key")
