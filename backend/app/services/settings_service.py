import math
from urllib.parse import urlparse

from sqlmodel import Session, select

from ..asr_config import (
    ASR_PROVIDER_EXTERNAL,
    normalize_asr_task_config,
)
from ..local_security import _asr_privacy_warning, _llm_privacy_warning
from ..models import Setting, now_iso
from .errors import ServiceError


ASR_SETTING_KEYS = frozenset(
    {
        "asr.provider",
        "asr.model_name",
        "asr.device",
        "asr.compute_type",
        "asr.beam_size",
        "asr.external.endpoint",
        "asr.external.model_name",
        "asr.external.api_key",
        "asr.external.language",
        "asr.external.timestamp_policy",
        "asr.external.timeout",
        "asr.external.allow_remote_endpoint",
        "asr.external.chunking_enabled",
        "asr.external.chunk_seconds",
        "asr.external.chunk_overlap_seconds",
        "asr.external.chunk_concurrency",
        "asr.external.prefer_silence",
        "asr.external.vad_threshold",
        "asr.external.minimum_silence_ms",
        "asr.external.formatting_enabled",
        "asr.external.case_glossary",
    }
)

LLM_SETTING_KEYS = frozenset(
    {
        "llm.endpoint",
        "llm.model_name",
        "llm.api_key",
        "llm.timeout",
        "llm.max_tokens",
        "llm.temperature",
        "llm.allow_remote_endpoint",
        "ai.output_language",
    }
)


def _setting_truthy(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _invalid_value(reason: str) -> ServiceError:
    return ServiceError(
        400,
        f"Invalid settings value: {reason}",
        "settings.invalid_value",
        {"reason": reason},
    )


def _require_exact_keys(
    section: str,
    values: dict[str, str],
    expected: frozenset[str],
) -> None:
    actual = set(values)
    if actual == expected:
        return

    missing = sorted(expected - actual)
    unexpected = sorted(actual - expected)
    reasons = []
    if missing:
        reasons.append(f"missing keys: {', '.join(missing)}")
    if unexpected:
        reasons.append(f"unexpected keys: {', '.join(unexpected)}")
    raise ServiceError(
        400,
        f"Invalid {section} settings payload: {'; '.join(reasons)}",
        "settings.invalid_payload",
        {"section": section},
    )


def _validate_asr_values(values: dict[str, str]) -> dict[str, str]:
    _require_exact_keys("ASR", values, ASR_SETTING_KEYS)
    provider = values["asr.provider"].strip().lower()

    config = {
        "provider": provider,
        "model_name": values["asr.model_name"],
        "device": values["asr.device"],
        "compute_type": values["asr.compute_type"],
        "beam_size": values["asr.beam_size"],
    }
    if provider == ASR_PROVIDER_EXTERNAL:
        config = {
            "provider": provider,
            "endpoint": values["asr.external.endpoint"],
            "model_name": values["asr.external.model_name"],
            "language": values["asr.external.language"],
            "timestamp_policy": values["asr.external.timestamp_policy"],
            "timeout": values["asr.external.timeout"],
            "chunking_enabled": values["asr.external.chunking_enabled"],
            "chunk_seconds": values["asr.external.chunk_seconds"],
            "chunk_overlap_seconds": values[
                "asr.external.chunk_overlap_seconds"
            ],
            "chunk_concurrency": values["asr.external.chunk_concurrency"],
            "prefer_silence": values["asr.external.prefer_silence"],
            "vad_threshold": values["asr.external.vad_threshold"],
            "minimum_silence_ms": values[
                "asr.external.minimum_silence_ms"
            ],
            "formatting_enabled": values["asr.external.formatting_enabled"],
            "case_glossary": values["asr.external.case_glossary"],
        }

    try:
        normalized = normalize_asr_task_config(config)
    except ValueError as error:
        raise _invalid_value(str(error)) from error

    if normalized["provider"] != ASR_PROVIDER_EXTERNAL:
        if normalized["beam_size"] <= 0:
            raise _invalid_value("asr.beam_size must be greater than 0")
    elif (
        _asr_privacy_warning(normalized["endpoint"])
        and not _setting_truthy(values["asr.external.allow_remote_endpoint"])
    ):
        raise ServiceError(
            400,
            "The non-local ASR endpoint has not been explicitly allowed.",
            "security.remote_asr_not_allowed",
        )

    result = dict(values)
    result["asr.provider"] = normalized["provider"]
    if normalized["provider"] == ASR_PROVIDER_EXTERNAL:
        result["asr.external.endpoint"] = values["asr.external.endpoint"].strip()
        result["asr.external.model_name"] = normalized["model_name"]
        result["asr.external.language"] = normalized["language"]
        result["asr.external.timestamp_policy"] = normalized["timestamp_policy"]
        result["asr.external.timeout"] = values["asr.external.timeout"].strip()
    else:
        result["asr.model_name"] = normalized["model_name"]
        result["asr.device"] = normalized["device"]
        result["asr.compute_type"] = normalized["compute_type"]
        result["asr.beam_size"] = str(normalized["beam_size"])
    return result


def _validate_llm_endpoint(endpoint: str) -> str:
    value = endpoint.strip()
    if not value:
        return ""

    try:
        parsed = urlparse(value)
        hostname = parsed.hostname
        parsed.port
    except ValueError as error:
        raise _invalid_value("llm.endpoint must be a valid http/https URL") from error
    if parsed.scheme not in {"http", "https"} or not hostname:
        raise _invalid_value("llm.endpoint must be a valid http/https URL")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise _invalid_value(
            "llm.endpoint must not contain credentials, query or fragment"
        )
    return value


def _validate_llm_values(values: dict[str, str]) -> dict[str, str]:
    _require_exact_keys("LLM", values, LLM_SETTING_KEYS)
    endpoint = _validate_llm_endpoint(values["llm.endpoint"])

    try:
        timeout = int(values["llm.timeout"])
    except ValueError as error:
        raise _invalid_value("llm.timeout must be an integer") from error
    if timeout < 1 or timeout > 3600:
        raise _invalid_value("llm.timeout must be between 1 and 3600")

    try:
        max_tokens = int(values["llm.max_tokens"])
    except ValueError as error:
        raise _invalid_value("llm.max_tokens must be an integer") from error
    if max_tokens <= 0:
        raise _invalid_value("llm.max_tokens must be greater than 0")

    try:
        temperature = float(values["llm.temperature"])
    except ValueError as error:
        raise _invalid_value("llm.temperature must be a number") from error
    if not math.isfinite(temperature) or temperature < 0 or temperature > 2:
        raise _invalid_value("llm.temperature must be between 0 and 2")

    output_language = values["ai.output_language"]
    if output_language not in {"auto", "zh-CN", "en"}:
        raise _invalid_value("ai.output_language is not supported")
    if (
        _llm_privacy_warning(endpoint)
        and not _setting_truthy(values["llm.allow_remote_endpoint"])
    ):
        raise ServiceError(
            400,
            "The non-local LLM endpoint has not been explicitly allowed.",
            "security.remote_llm_not_allowed",
        )

    result = dict(values)
    result["llm.endpoint"] = endpoint
    result["llm.model_name"] = values["llm.model_name"].strip()
    result["llm.timeout"] = values["llm.timeout"].strip()
    result["llm.max_tokens"] = values["llm.max_tokens"].strip()
    result["llm.temperature"] = values["llm.temperature"].strip()
    result["llm.allow_remote_endpoint"] = (
        "true"
        if _setting_truthy(values["llm.allow_remote_endpoint"])
        else "false"
    )
    return result


def list_settings(session: Session) -> list[Setting]:
    return session.exec(select(Setting)).all()


def upsert_setting(session: Session, key: str, value: str) -> Setting:
    row = session.get(Setting, key)

    if row:
        row.value = value
        row.updated_at = now_iso()
    else:
        row = Setting(key=key, value=value)

    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def update_settings_section(
    session: Session,
    section: str,
    values: dict[str, str],
) -> list[Setting]:
    if section == "asr":
        normalized_values = _validate_asr_values(values)
    elif section == "llm":
        normalized_values = _validate_llm_values(values)
    else:
        raise ServiceError(404, "Unknown settings section")

    updated_at = now_iso()
    rows: list[Setting] = []
    try:
        for key, value in normalized_values.items():
            row = session.get(Setting, key)
            if row:
                row.value = value
                row.updated_at = updated_at
            else:
                row = Setting(key=key, value=value, updated_at=updated_at)
            session.add(row)
            rows.append(row)
        session.commit()
    except Exception:
        session.rollback()
        raise

    for row in rows:
        session.refresh(row)
    return rows
