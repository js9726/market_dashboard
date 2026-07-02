"""
trader-primetrading skill — Python handler.

The user explicitly asked for a Python skill — this is the primary handler.
Pure prompt builder + system prompt. Caller invokes the LLM (Anthropic,
DeepSeek, OpenAI, Gemini), parses JSON, and persists.

Knowledge body lives in knowledge.md (committed runtime artifact). SYSTEM_PROMPT
mirrors it for cases where you don't want to do file IO at runtime; the wiki
mirror at jie_wiki/wiki/persona-primetrading.md is for browsing only.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal, Optional, TypedDict


class SnapshotInput(TypedDict, total=False):
    currentPrice: Optional[float]
    distanceTo21dmaAtr: Optional[float]
    ema21Slope: Optional[Literal["rising", "flat", "falling"]]
    wma10Slope: Optional[Literal["rising", "flat", "falling"]]
    rsCompositeRank: Optional[float]
    atrPct: Optional[float]
    dailyClosingRangePct: Optional[float]
    contractionLast5d: Optional[bool]
    earningsDays: Optional[float]
    marketCapTier: Optional[Literal["Large", "Mid", "Small", "Micro"]]


class TradeInput(TypedDict, total=False):
    ticker: str
    tradeDate: Optional[str]
    side: Optional[str]
    buyPrice: str
    exitPrice: Optional[str]
    quantity: Optional[str]
    pnl: Optional[str]
    notes: Optional[str]
    proposedEntry: Optional[str]
    proposedSL: Optional[str]
    proposedTP: Optional[str]
    snapshot: Optional[SnapshotInput]


HERE = os.path.dirname(os.path.abspath(__file__))
KNOWLEDGE_PATH = os.path.join(HERE, "knowledge.md")


def load_system_prompt() -> str:
    """Read knowledge.md as the system prompt. Falls back to the inlined
    SYSTEM_PROMPT_INLINE if the file is missing (e.g., in a packaged
    deployment that ships only handler.py)."""
    try:
        with open(KNOWLEDGE_PATH, encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return SYSTEM_PROMPT_INLINE


SYSTEM_PROMPT_INLINE = "\n".join([
    "You are Alex Desjardins (@PrimeTrading_) reviewing a single trade. Apply only his published methodology — momentum + price action with the 21dma-structure as the primary anchor.",
    "",
    "## Universe filter",
    "- Liquid leaders only — concentrated basket of 30-40 names.",
    "- Top-RS composite (multi-timeframe blended rank).",
    "- Universe is filtered before any setup is considered.",
    "",
    "## Setup recognition — 4 core 21dma behaviors",
    "1. Pullback into rising 21dma — primary entry signal.",
    "2. Reclaim & Backtest.",
    "3. Reject & Higher Low.",
    "4. Reject & Lower Low.",
    "Breakouts and extended entries are NOT his game.",
    "",
    "## Entry criteria",
    "- Within 0-1x ATR of the 21dma.",
    "- 21ema and 10wma advancing.",
    "- Daily closing range > 10%.",
    "- Contraction last 5 days.",
    "- Earnings 7+ days away.",
    "",
    "## Stops & exits",
    "- Soft structural stops — close-below-21dma logic, never fixed percent.",
    "",
    "## Position sizing",
    "- Concentrated basket of 30-40 liquid leaders; sizing scales with conviction.",
    "",
    "## Market timing",
    "- MCO + MCSI for breadth/trend; QQQE preferred over QQQ.",
    "",
    "## Anti-patterns",
    "- Breakout chasing.",
    "- Extended entries >1x ATR above 21dma.",
    "- Holding through earnings within 7 days.",
    "- Illiquid or non-leader names.",
    "- Fixed-percent stops.",
    "- Averaging down on losers.",
    "",
    "## Scoring rubric",
    "- Entry Quality (0-4): within ATR of rising 21dma, closing range >10%, contraction, earnings clear, liquid+top-RS.",
    "- Risk Management (0-3): structural stop full marks; fixed-percent zero.",
    "- Setup Alignment (0-3): pullback full marks; rejection marginal; breakout chase zero.",
    "",
    "Verdict: GREAT ENTRY >=9 | GOOD ENTRY 7-8 | ACCEPTABLE 5-6 | POOR ENTRY 3-4 | MISTAKE <=2.",
    "",
    "Return ONLY valid JSON. No markdown fences.",
])


def _fmt_num(v: Optional[float], digits: int = 2, suffix: str = "") -> str:
    return "N/A" if v is None else f"{v:.{digits}f}{suffix}"


def _fmt_bool(v: Optional[bool]) -> str:
    return "N/A" if v is None else ("yes" if v else "no")


def _snapshot_block(s: Optional[SnapshotInput]) -> str:
    if not s:
        return "(no snapshot — infer from general knowledge of the ticker around the trade date)"
    return "\n".join([
        f"- Current price: {_fmt_num(s.get('currentPrice'))}",
        f"- Distance to 21dma (xATR): {_fmt_num(s.get('distanceTo21dmaAtr'), 2)}",
        f"- 21ema slope: {s.get('ema21Slope') or 'N/A'}",
        f"- 10wma slope: {s.get('wma10Slope') or 'N/A'}",
        f"- RS composite rank: {_fmt_num(s.get('rsCompositeRank'), 0)}",
        f"- ATR%: {_fmt_num(s.get('atrPct'), 2, '%')}",
        f"- Daily closing range: {_fmt_num(s.get('dailyClosingRangePct'), 1, '%')}",
        f"- Contraction last 5d: {_fmt_bool(s.get('contractionLast5d'))}",
        f"- Earnings days: {s.get('earningsDays') if s.get('earningsDays') is not None else 'N/A'}",
        f"- Market cap tier: {s.get('marketCapTier') or 'N/A'}",
    ])


def _schema_example(ticker: str) -> str:
    return json.dumps({
        "handle": "@PrimeTrading_",
        "ticker": ticker,
        "entry_score": "<0-4>",
        "risk_score": "<0-3>",
        "setup_score": "<0-3>",
        "total_score": "<0-10>",
        "verdict": "<GREAT ENTRY | GOOD ENTRY | ACCEPTABLE | POOR ENTRY | MISTAKE>",
        "note": "<2-3 sentences from Alex's perspective citing rules he applies>",
        "flags": ["<violation 1>", "<violation 2>"],
    }, indent=2)


def build_prompt(trade: TradeInput) -> str:
    try:
        buy = float(trade["buyPrice"])
    except (KeyError, ValueError):
        buy = float("nan")
    exit_price = float(trade["exitPrice"]) if trade.get("exitPrice") else None
    pnl = float(trade["pnl"]) if trade.get("pnl") else None
    is_open = pnl is None
    date_str = "N/A"
    if trade.get("tradeDate"):
        try:
            date_str = datetime.fromisoformat(str(trade["tradeDate"]).replace("Z", "+00:00")).strftime("%m/%d/%Y")
        except Exception:
            date_str = str(trade["tradeDate"])

    template = "\n".join([
        "## Trade to score",
        "- Ticker: {ticker}",
        "- Trade date: {trade_date}",
        "- Side: {side}",
        "- Entry price: {entry_price}",
        "- Exit price: {exit_price}",
        "- P&L: {pnl_summary}",
        "- Quantity: {quantity}",
        "- Planned entry / stop / target: {planned_entry} / {planned_sl} / {planned_tp}",
        "- Notes: {notes}",
        "",
        "## Snapshot",
        "{snapshot_block}",
        "",
        "## Task",
        "Score this trade through Alex's lens. Apply the rubric verbatim from your system context.",
        "",
        "Return ONLY valid JSON in this shape:",
        "{schema_example}",
    ])

    pnl_summary = "Open position" if is_open else f"${pnl:+.2f}"
    entry_price = f"${buy:.2f}" if buy == buy else "N/A"
    exit_str = f"${exit_price:.2f}" if exit_price is not None else "Still open"

    replacements = {
        "{ticker}": trade.get("ticker", ""),
        "{trade_date}": date_str,
        "{side}": trade.get("side") or "Long",
        "{entry_price}": entry_price,
        "{exit_price}": exit_str,
        "{pnl_summary}": pnl_summary,
        "{quantity}": trade.get("quantity") or "N/A",
        "{planned_entry}": trade.get("proposedEntry") or "N/A",
        "{planned_sl}": trade.get("proposedSL") or "N/A",
        "{planned_tp}": trade.get("proposedTP") or "N/A",
        "{notes}": trade.get("notes") or "None",
        "{snapshot_block}": _snapshot_block(trade.get("snapshot")),
        "{schema_example}": _schema_example(trade.get("ticker", "")),
    }
    out = template
    for k, v in replacements.items():
        out = out.replace(k, v)
    return out


# ─── Convenience runner (CLI) ─────────────────────────────────────────────────
# Intended for: `python -m packages.core-skills.trader-primetrading.handler <tradeJSON>`
# but typical use is to import build_prompt + load_system_prompt from this file.

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: handler.py <tradeJSON>", file=sys.stderr)
        sys.exit(1)
    trade_json = sys.argv[1]
    if os.path.exists(trade_json):
        with open(trade_json, encoding="utf-8") as f:
            trade = json.load(f)
    else:
        trade = json.loads(trade_json)

    print("=== SYSTEM ===")
    print(load_system_prompt())
    print("\n=== USER ===")
    print(build_prompt(trade))
