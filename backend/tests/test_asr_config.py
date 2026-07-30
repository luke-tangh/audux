import unittest

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


class TestASRConfig(unittest.TestCase):
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

        self.assertEqual(config["provider"], ASR_PROVIDER_EXTERNAL)
        self.assertEqual(config["endpoint"], "http://127.0.0.1:8000/v1")
        self.assertEqual(config["language"], "auto")
        self.assertEqual(config["timestamp_policy"], "required")
        self.assertEqual(config["timeout"], 1200)

    def test_normalizes_faster_whisper_defaults(self):
        config = normalize_asr_task_config(
            {
                "provider": ASR_PROVIDER_FASTER_WHISPER,
            }
        )

        self.assertEqual(config["model_name"], "small")
        self.assertEqual(config["device"], "cpu")
        self.assertEqual(config["compute_type"], "int8")
        self.assertEqual(config["beam_size"], 5)

    def test_external_config_requires_valid_endpoint(self):
        with self.assertRaisesRegex(ValueError, "valid http/https URL"):
            normalize_asr_task_config(
                {
                    "provider": ASR_PROVIDER_EXTERNAL,
                    "endpoint": "not-a-url",
                    "model_name": "model",
                }
            )

    def test_external_config_requires_model(self):
        with self.assertRaisesRegex(ValueError, "model_name is required"):
            normalize_asr_task_config(
                {
                    "provider": ASR_PROVIDER_EXTERNAL,
                    "endpoint": "http://127.0.0.1:8000/v1",
                }
            )

    def test_external_endpoint_rejects_embedded_credentials_or_query(self):
        for endpoint in [
            "http://user:secret@127.0.0.1:8000/v1",
            "http://127.0.0.1:8000/v1?api_key=secret",
        ]:
            with self.subTest(endpoint=endpoint):
                with self.assertRaisesRegex(ValueError, "must not contain"):
                    normalize_asr_task_config(
                        {
                            "provider": ASR_PROVIDER_EXTERNAL,
                            "endpoint": endpoint,
                            "model_name": "model",
                        }
                    )

    def test_rejects_unknown_provider(self):
        with self.assertRaisesRegex(ValueError, "Unsupported ASR provider"):
            normalize_asr_task_config({"provider": "unknown"})

    def test_invalid_task_payload_is_treated_as_empty(self):
        self.assertEqual(parse_task_input_payload("not-json"), {})
        self.assertEqual(parse_task_input_payload("[]"), {})
        self.assertEqual(parse_task_input_payload(None), {})

    def test_task_snapshot_excludes_secret_and_preserves_provider_config(self):
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        SQLModel.metadata.create_all(engine)

        with Session(engine) as session:
            for key, value in {
                "asr.provider": "external",
                "asr.external.endpoint": "http://127.0.0.1:8000/v1",
                "asr.external.model_name": "qwen3-asr-1.7b",
                "asr.external.api_key": "secret-value",
                "asr.external.language": "zh",
                "asr.external.timestamp_policy": "required",
                "asr.external.timeout": "900",
            }.items():
                session.add(Setting(key=key, value=value))
            session.commit()

            payload = build_asr_task_payload(session)
            self.assertNotIn("api_key", payload["asr"])
            self.assertEqual(get_external_asr_api_key(session), "secret-value")

            endpoint = session.get(Setting, "asr.external.endpoint")
            self.assertIsNotNone(endpoint)
            endpoint.value = "http://127.0.0.1:9000/v1"
            session.add(endpoint)
            session.commit()

            resolved = resolve_asr_task_config(session, payload)
            self.assertEqual(
                resolved["endpoint"],
                "http://127.0.0.1:8000/v1",
            )
            self.assertEqual(resolved["model_name"], "qwen3-asr-1.7b")


if __name__ == "__main__":
    unittest.main()
