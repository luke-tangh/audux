from collections.abc import Iterator

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine

from app.asr_config import (
    ASR_PROVIDER_EXTERNAL,
    ASR_PROVIDER_FASTER_WHISPER,
    build_asr_task_payload,
    get_external_asr_api_key,
    normalize_asr_task_config,
    parse_task_input_payload,
    resolve_asr_task_config,
)
from app.models import Setting


@pytest.fixture
def settings_session() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)

    with Session(engine) as session:
        yield session

    engine.dispose()


class TestASRConfig:
    def test_normalizes_external_config(self):
        config = normalize_asr_task_config(
            {
                "provider": "EXTERNAL",
                "endpoint": "http://127.0.0.1:8000/v1/",
                "model_name": "qwen3-asr-1.7b",
                "language": "",
                "timestamp_policy": "REQUIRED",
                "timeout": "1200",
            }
        )

        assert config["provider"] == ASR_PROVIDER_EXTERNAL
        assert config["endpoint"] == "http://127.0.0.1:8000/v1"
        assert config["language"] == "auto"
        assert config["timestamp_policy"] == "required"
        assert config["timeout"] == 1200
        assert config["chunking_enabled"] is False
        assert config["chunk_seconds"] == 28
        assert config["chunk_overlap_seconds"] == 1
        assert config["prefer_silence"] is True
        assert config["vad_threshold"] == 0.5
        assert config["minimum_silence_ms"] == 400
        assert config["formatting_enabled"] is True
        assert config["case_glossary"] == ""

    def test_normalizes_external_chunking_config(self):
        config = normalize_asr_task_config(
            {
                "provider": "external",
                "endpoint": "http://127.0.0.1:8000/v1",
                "model_name": "ark-asr",
                "chunking_enabled": "true",
                "chunk_seconds": "25",
                "chunk_overlap_seconds": "1.5",
                "prefer_silence": "false",
                "vad_threshold": "0.65",
                "minimum_silence_ms": "650",
                "formatting_enabled": "false",
                "case_glossary": "ark asr=ARK-ASR",
            }
        )

        assert config["chunking_enabled"] is True
        assert config["chunk_seconds"] == 25
        assert config["chunk_overlap_seconds"] == 1.5
        assert config["prefer_silence"] is False
        assert config["vad_threshold"] == 0.65
        assert config["minimum_silence_ms"] == 650
        assert config["formatting_enabled"] is False
        assert config["case_glossary"] == "ark asr=ARK-ASR"

    def test_rejects_invalid_case_glossary(self):
        with pytest.raises(ValueError, match="case glossary line 1 is incomplete"):
            normalize_asr_task_config(
                {
                    "provider": "external",
                    "endpoint": "http://127.0.0.1:8000/v1",
                    "model_name": "ark-asr",
                    "case_glossary": "broken=",
                }
            )

    def test_ignores_case_glossary_while_formatting_is_disabled(self):
        config = normalize_asr_task_config(
            {
                "provider": "external",
                "endpoint": "http://127.0.0.1:8000/v1",
                "model_name": "ark-asr",
                "formatting_enabled": "false",
                "case_glossary": "broken=",
            }
        )

        assert config["formatting_enabled"] is False
        assert config["case_glossary"] == "broken="

    @pytest.mark.parametrize(
        ("field", "value", "message"),
        [
            ("chunk_seconds", "4", "chunk_seconds"),
            ("chunk_overlap_seconds", "15", "chunk_overlap_seconds"),
            ("vad_threshold", "0.95", "vad_threshold"),
            ("minimum_silence_ms", "99", "minimum_silence_ms"),
        ],
    )
    def test_rejects_invalid_external_chunking_config(
        self,
        field: str,
        value: str,
        message: str,
    ):
        with pytest.raises(ValueError, match=message):
            normalize_asr_task_config(
                {
                    "provider": "external",
                    "endpoint": "http://127.0.0.1:8000/v1",
                    "model_name": "ark-asr",
                    field: value,
                }
            )

    def test_normalizes_faster_whisper_defaults(self):
        config = normalize_asr_task_config(
            {
                "provider": ASR_PROVIDER_FASTER_WHISPER,
            }
        )

        assert config["model_name"] == "small"
        assert config["device"] == "cpu"
        assert config["compute_type"] == "int8"
        assert config["beam_size"] == 5

    def test_external_config_requires_valid_endpoint(self):
        with pytest.raises(ValueError, match="valid http/https URL"):
            normalize_asr_task_config(
                {
                    "provider": ASR_PROVIDER_EXTERNAL,
                    "endpoint": "not-a-url",
                    "model_name": "model",
                }
            )

    def test_external_config_requires_model(self):
        with pytest.raises(ValueError, match="model_name is required"):
            normalize_asr_task_config(
                {
                    "provider": ASR_PROVIDER_EXTERNAL,
                    "endpoint": "http://127.0.0.1:8000/v1",
                }
            )

    @pytest.mark.parametrize(
        "endpoint",
        [
            "http://user:secret@127.0.0.1:8000/v1",
            "http://127.0.0.1:8000/v1?api_key=secret",
        ],
    )
    def test_external_endpoint_rejects_embedded_credentials_or_query(
        self,
        endpoint: str,
    ):
        with pytest.raises(ValueError, match="must not contain"):
            normalize_asr_task_config(
                {
                    "provider": ASR_PROVIDER_EXTERNAL,
                    "endpoint": endpoint,
                    "model_name": "model",
                }
            )

    def test_rejects_unknown_provider(self):
        with pytest.raises(ValueError, match="Unsupported ASR provider"):
            normalize_asr_task_config({"provider": "unknown"})

    @pytest.mark.parametrize("payload", ["not-json", "[]", None])
    def test_invalid_task_payload_is_treated_as_empty(self, payload: str | None):
        assert parse_task_input_payload(payload) == {}

    def test_task_snapshot_excludes_secret_and_preserves_provider_config(
        self,
        settings_session: Session,
    ):
        for key, value in {
            "asr.provider": "external",
            "asr.external.endpoint": "http://127.0.0.1:8000/v1",
            "asr.external.model_name": "qwen3-asr-1.7b",
            "asr.external.api_key": "secret-value",
            "asr.external.language": "zh",
            "asr.external.timestamp_policy": "required",
            "asr.external.timeout": "900",
            "asr.external.chunking_enabled": "true",
            "asr.external.chunk_seconds": "26",
            "asr.external.chunk_overlap_seconds": "2",
            "asr.external.prefer_silence": "true",
            "asr.external.vad_threshold": "0.6",
            "asr.external.minimum_silence_ms": "500",
            "asr.external.formatting_enabled": "true",
            "asr.external.case_glossary": "ark asr=ARK-ASR",
        }.items():
            settings_session.add(Setting(key=key, value=value))
        settings_session.commit()

        payload = build_asr_task_payload(settings_session)
        assert "api_key" not in payload["asr"]
        assert get_external_asr_api_key(settings_session) == "secret-value"

        endpoint = settings_session.get(Setting, "asr.external.endpoint")
        assert endpoint is not None
        endpoint.value = "http://127.0.0.1:9000/v1"
        settings_session.add(endpoint)
        settings_session.commit()

        resolved = resolve_asr_task_config(settings_session, payload)
        assert resolved["endpoint"] == "http://127.0.0.1:8000/v1"
        assert resolved["model_name"] == "qwen3-asr-1.7b"
        assert resolved["chunking_enabled"] is True
        assert resolved["chunk_seconds"] == 26
        assert resolved["chunk_overlap_seconds"] == 2
        assert resolved["prefer_silence"] is True
        assert resolved["vad_threshold"] == 0.6
        assert resolved["formatting_enabled"] is True
        assert resolved["case_glossary"] == "ark asr=ARK-ASR"
