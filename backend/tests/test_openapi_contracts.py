from app.main import app


def _response_schema(path: str, method: str, status: str = "200") -> dict:
    operation = app.openapi()["paths"][path][method]
    return operation["responses"][status]["content"]["application/json"]["schema"]


def test_frontend_facing_routes_publish_explicit_response_contracts() -> None:
    routes = [
        ("/audio-items", "get", "200"),
        ("/audio-items/{audio_id}", "get", "200"),
        ("/audio-items/batch/transcribe", "post", "200"),
        ("/audio-items/{audio_id}/transcript", "get", "200"),
        ("/audio-items/{audio_id}/transcript", "patch", "200"),
        ("/ai-tasks", "get", "200"),
        ("/settings", "get", "200"),
        ("/settings/{section}", "put", "200"),
        ("/asr/whisper-component", "get", "200"),
    ]

    for path, method, status in routes:
        schema = _response_schema(path, method, status)
        assert schema, f"{method.upper()} {path} has an empty response schema"
        assert schema != {}, f"{method.upper()} {path} still exposes an untyped object"


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
