import json
from typing import Optional

import httpx

from .providers import LLMCapabilities


async def list_openai_compatible_models(
    endpoint: str,
    api_key: Optional[str] = None,
    timeout: int = 60,
) -> list[str]:
    url = endpoint.rstrip("/") + "/models"
    headers = {"Accept": "application/json"}

    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.get(url, headers=headers)
        response.raise_for_status()
        payload = response.json()

    rows = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise ValueError("Invalid OpenAI-compatible models response schema")

    model_ids: list[str] = []
    seen: set[str] = set()
    for row in rows:
        model_id = row.get("id") if isinstance(row, dict) else None
        if not isinstance(model_id, str):
            continue
        model_id = model_id.strip()
        if not model_id or model_id in seen:
            continue
        seen.add(model_id)
        model_ids.append(model_id)

    return model_ids


async def call_openai_compatible_chat(
    endpoint: str,
    model_name: str,
    messages: list[dict],
    api_key: Optional[str] = None,
    timeout: int = 60,
    max_tokens: Optional[int] = 800,
    temperature: Optional[float] = 0.2,
    tools: Optional[list[dict]] = None,
    tool_choice: Optional[dict | str] = None,
) -> dict:
    url = endpoint.rstrip("/") + "/chat/completions"

    headers = {
        "Content-Type": "application/json",
    }

    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    payload = {
        "model": model_name,
        "messages": messages,
    }

    if temperature is not None:
        payload["temperature"] = temperature

    if max_tokens is not None:
        payload["max_tokens"] = max_tokens

    if tools is not None:
        payload["tools"] = tools

    if tool_choice is not None:
        payload["tool_choice"] = tool_choice

    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(url, headers=headers, json=payload)
        resp.raise_for_status()
    return resp.json()


async def probe_openai_compatible_capabilities(
    endpoint: str,
    model_name: str,
    api_key: Optional[str] = None,
    timeout: int = 60,
) -> LLMCapabilities:
    """Probe optional features independently; an unsupported probe is not a connection failure."""
    url = endpoint.rstrip("/") + "/chat/completions"
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    base = {
        "model": model_name,
        "messages": [{"role": "user", "content": "Return a minimal test result."}],
        "temperature": 0,
        "max_tokens": 32,
    }
    tool = {
        "type": "function",
        "function": {
            "name": "capability_probe",
            "description": "Return the probe value.",
            "parameters": {
                "type": "object",
                "properties": {"value": {"type": "string"}},
                "required": ["value"],
                "additionalProperties": False,
            },
        },
    }
    structured_output = False
    tool_calling = False
    streaming_tool_calling = False

    probe_timeout = max(1, min(timeout, 10))
    async with httpx.AsyncClient(timeout=probe_timeout) as client:
        try:
            response = await client.post(
                url,
                headers=headers,
                json={
                    **base,
                    "messages": [
                        {"role": "user", "content": 'Return JSON: {"ok":true}'}
                    ],
                    "response_format": {"type": "json_object"},
                },
            )
            response.raise_for_status()
            content = get_ai_message_content(response.json())
            structured_output = isinstance(json.loads(content), dict)
        except Exception:
            structured_output = False

        tool_payload = {
            **base,
            "tools": [tool],
            "tool_choice": {"type": "function", "function": {"name": "capability_probe"}},
        }
        try:
            response = await client.post(url, headers=headers, json=tool_payload)
            response.raise_for_status()
            message = response.json()["choices"][0]["message"]
            tool_calling = bool(message.get("tool_calls"))
        except Exception:
            tool_calling = False

        if tool_calling:
            try:
                response = await client.post(
                    url,
                    headers=headers,
                    json={**tool_payload, "stream": True},
                )
                response.raise_for_status()
                streaming_tool_calling = '"tool_calls"' in response.text
            except Exception:
                streaming_tool_calling = False

    return LLMCapabilities(
        structured_output=structured_output,
        tool_calling=tool_calling,
        streaming_tool_calling=streaming_tool_calling,
    )


def get_ai_message_content(response: dict) -> str:
    try:
        return response["choices"][0]["message"]["content"]
    except Exception as e:
        raise ValueError(f"Invalid OpenAI-compatible response schema: {e}")


def parse_ai_json_content(content: str) -> dict:
    try:
        return json.loads(content)
    except Exception:
        start = content.find("{")
        end = content.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(content[start : end + 1])
            except Exception:
                pass

        raise ValueError("LLM response is not valid JSON")


def parse_ai_json_response(response: dict) -> dict:
    content = get_ai_message_content(response)
    return parse_ai_json_content(content)
