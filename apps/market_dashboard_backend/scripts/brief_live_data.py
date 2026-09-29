"""Build the morning-brief prompt's live data block from the files this run just fetched.

morning_brief.py used to call build_prompt(date) with no data, telling the model to "use
web search". DeepSeek's run then had nothing to work from: on 2026-09-25 it returned a
brief of nulls ("DATA UNAVAILABLE") and on 2026-09-28 a text tool call instead of JSON.
The same workflow run has already fetched the market data, so it is handed over here:

- snapshot.json (build_data.py): indices, sector ETFs, industries, breadth, Fear & Greed
- index_technicals.json (compute_index_technicals.py) from THIS run's data folder only
  (the skill folder holds an old local copy that must never be used)
- tv_screeners.json (tv_screener_fetch.py): top hits per screener
- events.json: economic calendar, when present
- broker protection: CI has no broker access, so the block says so without turning that
  into a daily "no new entries" block (the model must still never claim protection)

Every section states when its data was built. Section formats reuse cli_run.py's helpers
so both brief paths read the same way. Nothing here calls the network.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

_SKILL_DIR = Path(__file__).resolve().parents[3] / "packages" / "core-skills" / "morning-brief"
if str(_SKILL_DIR) not in sys.path:
    sys.path.insert(0, str(_SKILL_DIR))

MAX_SCREENER_HITS = 5
MAX_CHARS = 14000


def _load(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _num(v, fmt="{:+.2f}"):
    try:
        return fmt.format(float(v))
    except (TypeError, ValueError):
        return "n/a"


def technicals_section(tech: dict) -> list[str]:
    lines = ["  INDEX TECHNICALS (daily bars from this run - copy verbatim into `technicals`):"]
    for sym, t in tech.items():
        if not isinstance(t, dict):
            continue
        flags = [f for f, k in (("OVERBOUGHT", "overbought"), ("MACD-CURVING-DOWN", "curving_down"),
                                ("BEAR-CROSS-NEAR", "bear_cross_imminent")) if t.get(k)]
        lines.append(
            "    {}: close {} (bar {})  ATR {}  21EMA dist {}ATR  50EMA dist {}ATR  RSI {}  MACD {}  "
            "ENTRY_RISK={}{}".format(
                sym, _num(t.get("close"), "{:.2f}"), str(t.get("date", ""))[:10], _num(t.get("atr14"), "{:.2f}"),
                _num(t.get("dist_21_atr")), _num(t.get("dist_50_atr")), _num(t.get("rsi14"), "{:.1f}"),
                t.get("macd_dir", "n/a"), t.get("entry_risk", "n/a"),
                " [{}]".format(",".join(flags)) if flags else ""))
    return lines


def screener_section(tv: dict) -> list[str]:
    lines = ["  TV SCREENER HITS (fetched {}; market_open={}; top {} per screener):".format(
        tv.get("fetched_at", "unknown"), tv.get("market_was_open"), MAX_SCREENER_HITS)]
    for s in tv.get("screeners") or []:
        hits = s.get("hits") or []
        if not hits:
            continue
        lines.append("    {} ({} hits):".format(s.get("name") or s.get("id"), len(hits)))
        for h in hits[:MAX_SCREENER_HITS]:
            score = h.get("ai_score", h.get("score"))
            lines.append("      {} {}  chg {}%  RVOL {}  {}{}".format(
                h.get("ticker"), _num(h.get("close"), "{:.2f}"), _num(h.get("change")),
                _num(h.get("relative_volume_10d_calc"), "{:.2f}"), h.get("industry") or "",
                "  score {}".format(score) if score is not None else ""))
    return lines


def industries_section(perf: dict) -> list[str]:
    lines = []
    for key, title in (("top5", "Top industries"), ("bottom5", "Bottom industries")):
        rows = perf.get(key) or []
        if rows:
            lines.append("  {} (Finviz, 1D / 1W / 1M):".format(title))
            for r in rows:
                lines.append("    {}: {} / {} / {}".format(r.get("industry"), r.get("perf_1d"), r.get("perf_1w"),
                                                        r.get("perf_1m")))
    return lines


def build_live_data_block(data_dir: str | os.PathLike) -> str:
    data = Path(data_dir)
    import cli_run  # the skill's CLI runner; only its pure formatters are used

    lines: list[str] = []
    snapshot = _load(data / "snapshot.json")
    if isinstance(snapshot, dict):
        lines.append("  DATA AS OF {} (UTC) - the last completed US session. No pre-market prices are in this "
                     "block; web-search futures and pre-market movers.".format(snapshot.get("built_at", "unknown")))
        fg = snapshot.get("fear_greed") or {}
        if fg.get("status") == "ok" and fg.get("value") is not None:
            lines.append("  Fear & Greed Index: {:.0f}/100 ({}) as of {}".format(float(fg["value"]), fg.get("label"),
                                                                                fg.get("as_of")))
        b = snapshot.get("breadth") or {}
        if b:
            lines.append("  Breadth (snapshot sample of {}): {}% above 200SMA, {}% near 52w high".format(
                b.get("tickers_sampled"), b.get("above_200sma_pct"), b.get("near_52w_high_pct")))
        lines.append(cli_run._format_snapshot_section(snapshot))
        lines.extend(industries_section(snapshot.get("industry_performance") or {}))
    tech = _load(data / "index_technicals.json")
    if isinstance(tech, dict) and tech:
        lines.extend(technicals_section(tech))
    tv = _load(data / "tv_screeners.json")
    if isinstance(tv, dict) and tv.get("screeners"):
        lines.extend(screener_section(tv))
    events = _load(data / "events.json")
    if isinstance(events, list) and events:
        lines.append(cli_run._format_events_section(events))
    lines.append("  BROKER PROTECTION: not available in this run (it has no broker access). Say nothing about "
                 "whether any holding is protected; this is NOT a signal and NOT a reason to block new entries.")
    if len(lines) <= 2:
        return ""
    block = "\n".join(line for line in lines if line)
    if len(block) > MAX_CHARS:
        block = block[:MAX_CHARS].rsplit("\n", 1)[0] + "\n  (block truncated at {} characters)".format(MAX_CHARS)
    return block
