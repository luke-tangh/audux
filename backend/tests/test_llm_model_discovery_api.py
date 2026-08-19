import pytest

from app.services import ai_service
from tests.api_test_support import ApiIntegrationTest


class TestLLMModelDiscoveryApi(ApiIntegrationTest):
    def test_discovers_models_without_requiring_a_model_name(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        async def fake_discover(payload):
            assert payload.endpoint == "http://127.0.0.1:1234/v1"
            assert payload.api_key == "test-key"
            assert payload.timeout == 20
            return {
                "models": ["model-a", "model-b"],
                "is_local_endpoint": True,
                "privacy_warning": None,
                "privacy_warning_code": None,
            }

        monkeypatch.setattr(ai_service, "discover_llm_models", fake_discover)

        response = self.client.post(
            "/ai/models",
            headers=self.auth_headers(include_client=True),
            json={
                "endpoint": "http://127.0.0.1:1234/v1",
                "api_key": "test-key",
                "timeout": 20,
            },
        )

        assert response.status_code == 200
        assert response.json()["models"] == ["model-a", "model-b"]
