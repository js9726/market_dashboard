"""
agent-moderator skill — Python handler.

v0: same single-call simulation as handler.ts. Pure prompt builder; caller owns
the LLM invocation (Anthropic / OpenAI / Gemini / DeepSeek), JSON parse, and
persistence.
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Literal, Optional, TypedDict


AgentMode = Literal["trade", "stock"]


class SnapshotInput(TypedDict, total=False):
    currentPrice: Optional[float]
    changePctIntraday: Optional[float]
    changePct5d: Optional[float]
    changePct20d: Optional[float]
    atrPct: Optional[float]
    rsi14: Optional[float]
    macdSignal: Optional[str]      # "bullish" | "bearish" | "neutral"
    emaHierarchy: Optional[str]    # "bullish" | "bearish" | "mixed"
    adx: Optional[float]
    volumeRatio: Optional[float]
    marketCapTier: Optional[str]   # "Large" | "Mid" | "Small" | "Micro"
    sector: Optional[str]
    industry: Optional[str]
    earningsDays: Optional[float]
    halts90d: Optional[float]


class TradeInput(TypedDict, total=False):
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


class ModeratorPromptInput(TypedDict):
    mode: AgentMode
    ticker: str
    snapshot: SnapshotInput
    trade: Optional[TradeInput]


SYSTEM_PROMPT = "\n".join([
    "You are running a 5-agent analysis pipeline. You will play four specialist roles (Data, Technical, Chart, Risk) and then act as the Moderator who synthesizes them into a final verdict.",
    "",
    "## Agent roles",
    "",
    "**Data Agent** — objective numeric facts only. No interpretation. Required reads: price, % change (intraday + 5d + 20d), volume vs 20-day average, ATR%, market cap tier, sector / industry, days to next earnings, halts in last 90 days.",
    "",
    "**Technical Agent** — momentum and trend reads. Apply these thresholds:",
    "- RSI(14): <30 oversold | 30-45 weak | 45-55 neutral | 55-70 strong | >70 overbought",
    "- MACD: bullish if MACD > signal line and rising; bearish if below and falling",
    "- EMA hierarchy: bullish if EMA20 > EMA50 > EMA200; bearish if reverse; mixed otherwise",
    "- ADX: <20 weak trend | 20-25 emerging | 25-40 strong | >40 extreme",
    "- Volume vs 20-day avg: 1.5x+ high | <0.5x low",
    "",
    "**Chart Agent** — pattern recognition. Look for: range breakout/breakdown, flag/pennant, cup-and-handle, double top/bottom, head-and-shoulders, gap fill, support/resistance levels, volatility contraction, 21-day MA structure (advancing vs flat).",
    "",
    "**Risk Agent** — consumes Data + Technical + Chart. Rules:",
    "- Position size cap: 5% breakouts | 7.5% proven trends | 2% speculative/small-cap",
    "- Risk per trade: target 1% account; never exceed 2%; stop <= ATR x 1.5 from entry",
    "- R/R: >=1:2 approve | 1:1.5 warn | <1:1.5 reject",
    "- Earnings <=7 days: downgrade size 50% or reject",
    "- Any halt in last 90 days: warn or reject by cause",
    "",
    "**Moderator** — final synthesis:",
    "- BUY: >=3 of 4 feeders bullish AND Risk = approved",
    "- SELL: >=3 of 4 feeders bearish",
    "- HOLD: mixed signals OR Risk = reject",
    "Confidence 0-10: start 5; +1 per bullish feeder beyond third (max +1); +1 if Risk approved with R/R >= 1:2.5; +1 if clean structural breakout; +1 if volume > 1.5x avg; -1 per contraindication. Cap [0, 10].",
    "Entry / stop / target MUST come from the Chart Agent's structural levels — do not invent.",
    "",
    "## Output discipline",
    "Return ONLY valid JSON. No markdown fences, no commentary outside the JSON. Numbers as numbers, not strings. Use null for unknown. Keep summary and reasoning short (1-3 sentences).",
])


def _fmt_num(v: Optional[float], digits: int = 2, suffix: str = "") -> str:
    if v is None:
        return "N/A"
    return f"{v:.{digits}f}{suffix}"


def _snapshot_block(s: SnapshotInput) -> str:
    lines = [
        f"- Current price: {_fmt_num(s.get('currentPrice'))}",
        f"- Change: intraday {_fmt_num(s.get('changePctIntraday'), 2, '%')}, 5d {_fmt_num(s.get('changePct5d'), 2, '%')}, 20d {_fmt_num(s.get('changePct20d'), 2, '%')}",
        f"- ATR%: {_fmt_num(s.get('atrPct'), 2, '%')}",
        f"- RSI(14): {_fmt_num(s.get('rsi14'), 1)}",
        f"- MACD signal: {s.get('macdSignal') or 'N/A'}",
        f"- EMA hierarchy: {s.get('emaHierarchy') or 'N/A'}",
        f"- ADX: {_fmt_num(s.get('adx'), 1)}",
        f"- Volume vs 20-day avg: {_fmt_num(s.get('volumeRatio'), 2, 'x')}",
        f"- Market cap tier: {s.get('marketCapTier') or 'N/A'}",
        f"- Sector / industry: {s.get('sector') or 'N/A'} / {s.get('industry') or 'N/A'}",
        f"- Days to next earnings: {s.get('earningsDays') if s.get('earningsDays') is not None else 'N/A'}",
        f"- Halts in last 90d: {s.get('halts90d') or 0}",
    ]
    return "\n".join(lines)


def _trade_section(trade: Optional[TradeInput]) -> str:
    if not trade:
        return ""
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
            date_str = datetime.fromisoformat(str(trade["tradeDate"]).replace("Z", "+00:00")).strftime("%-m/%-d/%Y")
        except Exception:
            date_str = str(trade["tradeDate"])
    lines = [
        "",
        "## Trade",
        f"- State: {'OPEN' if is_open else 'CLOSED'}",
        f"- Entry date: {date_str}",
        f"- Side: {trade.get('side') or 'Long'}",
        f"- Buy price: ${buy:.2f}" if buy == buy else "- Buy price: N/A",  # NaN check
        f"- Exit price: {f'${exit_price:.2f}' if exit_price is not None else 'Still open'}",
        f"- Quantity: {trade.get('quantity') or 'N/A'}",
        f"- P&L: {f'${pnl:+.2f}' if pnl is not None else 'Open position'}",
        f"- Planned entry / stop / target: {trade.get('proposedEntry') or 'N/A'} / {trade.get('proposedSL') or 'N/A'} / {trade.get('proposedTP') or 'N/A'}",
        f"- Notes: {trade.get('notes') or 'None'}",
    ]
    return "\n".join(lines)


def _schema_example(ticker: str, mode: AgentMode) -> str:
    example: dict[str, Any] = {
        "ticker": ticker,
        "agents": {
            "data": {"summary": "<1-2 factual sentences>", "facts": {"price": 0, "volumeRatio": 0}},
            "technical": {"summary": "<1-2 sentences>", "indicators": {"rsi14": 0, "macdSignal": "bullish", "emaHierarchy": "bullish", "adx": 0}},
            "chart": {"summary": "<1-2 sentences>", "pattern": "<pattern label>", "levels": {"support": 0, "resistance": 0, "breakoutLevel": 0}},
            "risk": {"summary": "<1-2 sentences>", "suggested_size_pct": 0, "rr": 0, "stop_distance_pct": 0, "var_1d_pct": 0, "status": "approved"},
        },
        "moderator": {
            "signal": "BUY",
            "confidence": 0,
            "consensus": "X/4",
            "entry": 0,
            "stop": 0,
            "target": 0,
            "reasoning": "<<=3 sentences synthesizing the 4 feeders>",
            "lesson": "<<=2 sentences for the journal>" if mode == "trade" else None,
        },
    }
    return json.dumps(example, indent=2)


def build_prompt(payload: ModeratorPromptInput) -> str:
    mode = payload["mode"]
    ticker = payload["ticker"]
    snapshot = payload.get("snapshot", {})
    trade = payload.get("trade")

    template = "\n".join([
        "## Mode",
        "{mode}",
        "",
        "## Ticker",
        "{ticker}",
        "",
        "## Snapshot",
        "{snapshot_block}",
        "{trade_section}",
        "",
        "## Task",
        "Produce one JSON object with these top-level keys: `ticker`, `agents`, `moderator`.",
        "",
        "Steps:",
        "1. Run the Data Agent on the snapshot.",
        "2. Run the Technical Agent on the snapshot.",
        "3. Run the Chart Agent.",
        "4. Run the Risk Agent consuming the three outputs above.",
        "5. Run the Moderator. Apply BUY/SELL/HOLD voting. Set confidence per the rubric. Take entry/stop/target from the Chart Agent.{lesson_directive}",
        "",
        "## Output schema (example shape)",
        "{schema_example}",
        "",
        "Return ONLY the JSON.",
    ])

    replacements = {
        "{mode}": mode,
        "{ticker}": ticker,
        "{snapshot_block}": _snapshot_block(snapshot),
        "{trade_section}": _trade_section(trade) if mode == "trade" else "",
        "{lesson_directive}": (
            " Also produce a 1-2 sentence `lesson` field — be honest if the trade was a mistake."
            if mode == "trade"
            else ""
        ),
        "{schema_example}": _schema_example(ticker, mode),
    }
    out = template
    for k, v in replacements.items():
        out = out.replace(k, v)
    return out
