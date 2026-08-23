import asyncio
from types import SimpleNamespace

import pytest

from app.services import ai_service
from app.services.errors import ServiceError


def test_discovers_llm_models_with_unsaved_endpoint_config(
    monkeypatch: pytest.MonkeyPatch,
):
    captured: dict = {}

    async def fake_list_models(**kwargs):
        captured.update(kwargs)
        return ["model-a", "model-b"]

    monkeypatch.setattr(ai_service, "list_openai_compatible_models", fake_list_models)

    result = asyncio.run(
        ai_service.discover_llm_models(
            SimpleNamespace(
                endpoint=" http://127.0.0.1:1234/v1 ",
                api_key="secret",
                timeout=30,
            )
        )
    )

    assert result["models"] == ["model-a", "model-b"]
    assert result["is_local_endpoint"] is True
    assert captured == {
        "endpoint": "http://127.0.0.1:1234/v1",
        "api_key": "secret",
        "timeout": 30,
    }


def test_model_discovery_wraps_endpoint_errors(monkeypatch: pytest.MonkeyPatch):
    async def fail(**kwargs):
        raise RuntimeError("service unavailable")

    monkeypatch.setattr(ai_service, "list_openai_compatible_models", fail)

    with pytest.raises(ServiceError) as captured:
        asyncio.run(
            ai_service.discover_llm_models(
                SimpleNamespace(
                    endpoint="http://localhost:11434/v1",
                    api_key=None,
                    timeout=60,
                )
            )
        )

    assert captured.value.code == "ai.model_discovery_failed"
    assert captured.value.params == {"error": "service unavailable"}
