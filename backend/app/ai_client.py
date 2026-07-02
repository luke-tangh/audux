import json
import httpx
from typing import Optional


async def call_openai_compatible_chat(
    endpoint: str,
    model_name: str,
    messages: list[dict],
    api_key: Optional[str] = None,
    timeout: int = 60,
    max_tokens: Optional[int] = 800,
    temperature: Optional[float] = 0.2,
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
        "temperature": temperature,
    }

    if max_tokens:
        payload["max_tokens"] = max_tokens

    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(url, headers=headers, json=payload)
        resp.raise_for_status()
        return resp.json()


def parse_ai_json_response(response: dict) -> dict:
    content = response["choices"][0]["message"]["content"]

    try:
        return json.loads(content)
    except Exception:
        start = content.find("{")
        end = content.rfind("}")
        if start >= 0 and end > start:
            return json.loads(content[start : end + 1])
        raise ValueError("LLM response is not valid JSON")
