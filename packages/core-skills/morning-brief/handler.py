"""
morning-brief skill — Python handler.

Renders the morning-brief prompt template. Provider invocation
(Gemini / OpenAI / Claude with web-search tools) stays in the CLI
caller because each SDK has bespoke tool wiring.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).parent
_PROMPT = (ROOT / "prompt.md").read_text(encoding="utf-8")
SCHEMA = json.loads((ROOT / "schema.json").read_text(encoding="utf-8"))

DEFAULT_WATCHLIST = [
    "NVDA", "TSLA", "AAPL", "MSFT", "AMZN", "META",
    "GOOGL", "AMD", "SMCI", "PLTR", "CRWD", "MSTR",
]


def build_prompt(date_str: str, watchlist: list[str] | None = None) -> str:
    """Render the morning-brief prompt for a given date and watchlist."""
    if watchlist is None:
        watchlist = DEFAULT_WATCHLIST
    watchlist_str = ", ".join(watchlist)
    return (
        _PROMPT
        .replace("{date_str}", date_str)
        .replace("{watchlist_str}", watchlist_str)
    )
