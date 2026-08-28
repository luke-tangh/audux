from app.main import app


def _response_schema(path: str, method: str, status: str = "200") -> dict:
    operation = app.openapi()["paths"][path][method]
    return operation["responses"][status]["content"]["application/json"]["schema"]


def test_frontend_facing_routes_publish_explicit_response_contracts() -> None:
    missing_contracts: list[str] = []

    for path, path_item in app.openapi()["paths"].items():
        for method, operation in path_item.items():
            if method not in {"get", "post", "put", "patch", "delete"}:
                continue
            for status, response in operation["responses"].items():
                if not status.startswith("2"):
                    continue
                json_response = response.get("content", {}).get("application/json")
                if json_response is not None and not json_response.get("schema"):
                    missing_contracts.append(f"{method.upper()} {path} ({status})")

    assert missing_contracts == []


def test_openapi_contains_shared_audio_and_transcript_models() -> None:
    schemas = app.openapi()["components"]["schemas"]

    assert "AudioItemResponse" in schemas
    assert "PaginatedAudioItemsResponse" in schemas
    assert "TranscriptResponse" in schemas
    assert "AITaskResponse" in schemas


def test_audio_delete_contract_cannot_request_source_file_deletion() -> None:
    operation = app.openapi()["paths"]["/audio-items/{audio_id}"]["delete"]
    parameters = operation.get("parameters", [])

    assert {parameter["name"] for parameter in parameters} == {"audio_id"}
    assert _response_schema("/audio-items/{audio_id}", "delete") == {
        "$ref": "#/components/schemas/OkResponse"
    }
