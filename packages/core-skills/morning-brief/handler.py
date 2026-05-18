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


def build_prompt(
    date_str: str,
    watchlist: list[str] | None = None,
    live_data_block: str = "",
    screener_unscored: list[str] | None = None,
) -> str:
    """Render the morning-brief prompt for a given date and watchlist.

    Args:
        date_str: Today's date in MYT (e.g. "2026-05-19 Monday").
        watchlist: Personal watchlist tickers.
        live_data_block: Pre-fetched CNN Fear & Greed + live prices block.
        screener_unscored: TV screener tickers that have no auto-score yet;
            Claude will score these using the trader-lens framework and emit
            them in `screenerScores` inside the StructuredBrief JSON.
    """
    if watchlist is None:
        watchlist = DEFAULT_WATCHLIST
    watchlist_str = ", ".join(watchlist)
    screener_str = (
        ", ".join(screener_unscored) if screener_unscored else "none (all screener tickers already scored)"
    )
    return (
        _PROMPT
        .replace("{date_str}", date_str)
        .replace("{watchlist_str}", watchlist_str)
        .replace("{live_data_block}", live_data_block or "(none pre-fetched — use web search)")
        .replace("{screener_unscored_str}", screener_str)
    )
