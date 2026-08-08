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
