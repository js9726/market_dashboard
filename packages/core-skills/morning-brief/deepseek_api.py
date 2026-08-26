"""Small, testable DeepSeek Responses API boundary.

All Python callers share this module so model retirement, web-search syntax,
JSON mode, response extraction, and error handling cannot drift independently.
No fallback provider is selected here.
"""
from __future__ import annotations

import json
import os
import urllib.request
from typing import Callable

DEEPSEEK_MODEL_ID = "deepseek-v4-flash"
DEEPSEEK_RESPONSES_URL = "https://api.deepseek.com/responses"


def build_response_payload(
    prompt: str,
    *,
    instructions: str | None = None,
    web_search: bool = False,
    max_output_tokens: int = 8000,
) -> dict:
    payload: dict = {
        "model": DEEPSEEK_MODEL_ID,
        "input": prompt,
        "max_output_tokens": max_output_tokens,
        "text": {"format": {"type": "json_object"}},
    }
    if instructions:
        payload["instructions"] = instructions
    if web_search:
        payload["tools"] = [{"type": "web_search"}]
        payload["tool_choice"] = "auto"
    return payload


def extract_output_text(response: dict) -> str:
    if response.get("status") not in (None, "completed"):
        detail = response.get("incomplete_details") or response.get("error") or {}
        raise RuntimeError(f"DeepSeek response status={response.get('status')}: {detail}")
    chunks: list[str] = []
    for item in response.get("output", []):
        if item.get("type") != "message":
            continue
        for content in item.get("content", []):
            if content.get("type") == "output_text" and content.get("text"):
                chunks.append(content["text"])
    text = "".join(chunks).strip()
    if not text:
        raise RuntimeError("DeepSeek returned no output_text message")
    return text


def call_deepseek_json(
    prompt: str,
    *,
    instructions: str | None = None,
    web_search: bool = False,
    max_output_tokens: int = 8000,
    api_key: str | None = None,
    urlopen: Callable = urllib.request.urlopen,
) -> str:
    key = (api_key if api_key is not None else os.environ.get("DEEPSEEK_API_KEY", "")).strip()
    if not key:
        raise RuntimeError("DEEPSEEK_API_KEY is not set; no provider fallback was used")
    request = urllib.request.Request(
        DEEPSEEK_RESPONSES_URL,
        data=json.dumps(
            build_response_payload(
                prompt,
                instructions=instructions,
                web_search=web_search,
                max_output_tokens=max_output_tokens,
            )
        ).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
    )
    with urlopen(request, timeout=180) as response:
        data = json.loads(response.read().decode("utf-8"))
    return extract_output_text(data)
