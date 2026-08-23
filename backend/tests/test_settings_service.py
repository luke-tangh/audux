from collections.abc import Iterator

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine

from app.models import Setting
from app.services.errors import ServiceError
from app.services.settings_service import update_settings_section


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


def llm_values(**overrides: str) -> dict[str, str]:
    values = {
        "llm.endpoint": "http://127.0.0.1:1234/v1",
        "llm.model_name": "local-model",
        "llm.api_key": "",
        "llm.timeout": "60",
        "llm.max_tokens": "800",
        "llm.temperature": "0.2",
        "llm.allow_remote_endpoint": "false",
        "ai.output_language": "auto",
    }
    values.update(overrides)
    return values


def asr_values(**overrides: str) -> dict[str, str]:
    values = {
        "asr.provider": "faster_whisper",
        "asr.model_name": "small",
        "asr.device": "cpu",
        "asr.compute_type": "int8",
        "asr.beam_size": "5",
        "asr.external.endpoint": "",
        "asr.external.model_name": "",
        "asr.external.api_key": "",
        "asr.external.language": "auto",
        "asr.external.timestamp_policy": "preferred",
        "asr.external.timeout": "3600",
        "asr.external.allow_remote_endpoint": "false",
        "asr.external.chunking_enabled": "false",
        "asr.external.chunk_seconds": "28",
        "asr.external.chunk_overlap_seconds": "1",
        "asr.external.chunk_concurrency": "1",
        "asr.external.prefer_silence": "true",
        "asr.external.vad_threshold": "0.5",
        "asr.external.minimum_silence_ms": "400",
        "asr.external.formatting_enabled": "true",
        "asr.external.case_glossary": "I\nMr\n",
    }
    values.update(overrides)
    return values


class TestSettingsSectionUpdate:
    def test_updates_the_complete_section_with_one_timestamp(
        self, settings_session: Session
    ):
        rows = update_settings_section(settings_session, "llm", llm_values())

        assert len(rows) == 8
        assert len({row.updated_at for row in rows}) == 1
        assert settings_session.get(Setting, "llm.model_name").value == "local-model"

    def test_invalid_section_does_not_partially_update_existing_values(
        self, settings_session: Session
    ):
        update_settings_section(settings_session, "llm", llm_values())

        with pytest.raises(ServiceError) as error:
            update_settings_section(
                settings_session,
                "llm",
                llm_values(
                    **{
                        "llm.model_name": "changed-model",
                        "llm.temperature": "not-a-number",
                    }
                ),
            )

        assert error.value.code == "settings.invalid_value"
        assert settings_session.get(Setting, "llm.model_name").value == "local-model"
        assert settings_session.get(Setting, "llm.temperature").value == "0.2"

    def test_remote_consent_is_validated_from_the_same_atomic_payload(
        self, settings_session: Session
    ):
        remote = asr_values(
            **{
                "asr.provider": "external",
                "asr.external.endpoint": "https://asr.example.test/v1",
                "asr.external.model_name": "remote-model",
            }
        )

        with pytest.raises(ServiceError) as error:
            update_settings_section(settings_session, "asr", remote)
        assert error.value.code == "security.remote_asr_not_allowed"
        assert settings_session.get(Setting, "asr.provider") is None

        remote["asr.external.allow_remote_endpoint"] = "true"
        update_settings_section(settings_session, "asr", remote)
        assert settings_session.get(Setting, "asr.provider").value == "external"

    def test_requires_the_complete_known_key_set(self, settings_session: Session):
        incomplete = llm_values()
        incomplete.pop("llm.api_key")

        with pytest.raises(ServiceError) as error:
            update_settings_section(settings_session, "llm", incomplete)

        assert error.value.code == "settings.invalid_payload"
        assert settings_session.get(Setting, "llm.endpoint") is None

    def test_rejects_malformed_llm_urls_as_validation_errors(
        self, settings_session: Session
    ):
        with pytest.raises(ServiceError) as error:
            update_settings_section(
                settings_session,
                "llm",
                llm_values(**{"llm.endpoint": "http://[invalid"}),
            )

        assert error.value.code == "settings.invalid_value"
        assert settings_session.get(Setting, "llm.endpoint") is None
