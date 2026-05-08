"""
trader-scorer-market skill — Python handler.

Renders the daily market-verdict prompt. Provider invocation
(Gemini / Claude / OpenAI without web search) stays in the CLI
caller because the routing logic + rule-based fallback live there.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).parent
_PROMPT = (ROOT / "prompt.md").read_text(encoding="utf-8")
SCHEMA = json.loads((ROOT / "schema.json").read_text(encoding="utf-8"))

# Bring in the shared trader-profiles loader.
_SHARED = Path(__file__).parents[1] / "_shared"
if str(_SHARED) not in sys.path:
    sys.path.insert(0, str(_SHARED))

from prompt_loader import load_trader_profiles  # noqa: E402


def _render_profiles_block(profiles: list[dict]) -> str:
    """Cleaner per-profile block: '### @handle — Name\\n<styleLong>'."""
    return "\n\n".join(
        f"### {p['handle']} — {p['name']}\n{p['styleLong']}"
        for p in profiles
    )


def _schema_example(date_str: str) -> str:
    return json.dumps({
        "date": date_str,
        "traders": [
            {"handle": "@markminervini", "verdict": "YES", "note": "One or two sentences explaining why, in this trader's voice."},
            {"handle": "@Clement_Ang17", "verdict": "SELECTIVE", "note": "..."},
        ],
        "open_positions": [],
        "planning_entries": [],
    }, indent=2)


def build_prompt(date_str: str, market_context: str) -> str:
    """Render the daily market-verdict prompt."""
    profiles = load_trader_profiles()
    return (
        _PROMPT
        .replace("{date_str}", date_str)
        .replace("{market_context}", market_context)
        .replace("{trader_profiles_block}", _render_profiles_block(profiles))
        .replace("{handles_list}", ", ".join(p["handle"] for p in profiles))
        .replace("{schema_example}", _schema_example(date_str))
    )


def required_handles() -> set[str]:
    """Set of handles the validator expects to see in the LLM output."""
    return {p["handle"] for p in load_trader_profiles()}
