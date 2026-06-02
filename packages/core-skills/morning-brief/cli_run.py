"""
cli_run.py
==========
End-to-end CLI morning-brief runner.

Generates a StructuredBrief using an AI provider (DeepSeek / Gemini / OpenAI /
Claude) then optionally POSTs the result to the dashboard's Postgres cache.

Reads the prompt from `prompt.md` (same directory).  Feeds in the trader-style
framework, date, and watchlist. If `--post` is set it pipes the output to
`ingest_to_dashboard.py` automatically.

Usage:
    python cli_run.py                       # DeepSeek, no push
    python cli_run.py --provider gemini     # Gemini, no push
    python cli_run.py --provider deepseek --post   # generate + push to dashboard
    python cli_run.py --out brief.json      # save JSON to file

Required env vars per provider:
    deepseek  → DEEPSEEK_API_KEY
    gemini    → GEMINI_API_KEY
    openai    → OPENAI_API_KEY
    claude    → ANTHROPIC_API_KEY

For --post, also set:
    VERCEL_INGEST_URL
    BRIEF_INGEST_KEY

Optional:
    WATCHLIST   comma-separated list of tickers (overrides hardcoded default)
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

# Load .env / .env.local before anything touches os.environ
from _env_loader import load_env as _load_env
_load_env()

# ── same as ingest_to_dashboard.py (inline to keep CLI standalone) ───────────
import hashlib


def _hash(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()[:16]


def _stored_provider(provider: str) -> str:
    return "deepseek" if provider == "deepseek-search" else provider


def _push(structured_json: object, provider: str) -> dict:
    base = os.environ.get("VERCEL_INGEST_URL", "").rstrip("/")
    key = os.environ.get("BRIEF_INGEST_KEY", "")
    if not base or not key:
        print("VERCEL_INGEST_URL and BRIEF_INGEST_KEY must be set for --post.", file=sys.stderr)
        sys.exit(2)
    url = f"{base}/api/morning-verdict/ingest"
    payload_str = json.dumps(structured_json)
    ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M")
    stored_provider = _stored_provider(provider)
    body = json.dumps(
        {
            "provider": stored_provider,
            "htmlBody": "",
            "structuredJson": structured_json,
            "verdictJson": structured_json,
            "generatedBy": f"cli_run:{provider}:{ts}",
            "inputHash": _hash(payload_str),
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"Ingest HTTP {e.code}: {e.read().decode()}", file=sys.stderr)
        sys.exit(1)


# ── prompt loading ────────────────────────────────────────────────────────────
ROOT = Path(__file__).parent


def _fetch_fear_and_greed() -> tuple[int | None, str | None]:
    """
    Fetch CNN Fear & Greed Index.
    Returns (score, label) or (None, None) on failure.

    CNN's dataviz endpoint requires browser-like headers or it returns 418.
    We send a realistic Accept/Referer header set to pass the bot check.
    """
    url = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://edition.cnn.com/markets/fear-and-greed",
        "Origin": "https://edition.cnn.com",
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read().decode("utf-8"))
        fg = data.get("fear_and_greed", {})
        score = fg.get("score")
        label = fg.get("rating")
        if score is not None:
            return round(float(score)), str(label) if label else None
    except Exception as e:
        print(f"[cli_run] Fear & Greed fetch failed ({e})", file=sys.stderr)
    return None, None


def _fetch_live_prices_opend(
    tickers: list[str],
    host: str = "127.0.0.1",
    port: int = 11111,
) -> dict[str, dict]:
    """
    Fetch real-time prices from moomoo OpenD.
    Returns {TICKER: {price, changePct, rvol, prePrice, preChangePct, afterPrice, afterChangePct}}.
    Preferred over yfinance: pre-market aware, RVOL, no bot detection.
    """
    if not tickers:
        return {}
    try:
        from fetch_opend_live import fetch_snapshots
    except ImportError:
        return {}

    rows = fetch_snapshots(tickers, host=host, port=port)
    if not rows:
        return {}

    result: dict[str, dict] = {}
    for r in rows:
        t = r["ticker"]
        result[t] = {
            "price":        r["last"],
            "changePct":    r["change_pct"],
            "rvol":         r["rvol"],
            "prePrice":     r["pre_price"],
            "preChangePct": r["pre_chg"],
            "afterPrice":   r["after_price"],
            "afterChangePct": r["after_chg"],
        }

    found = sum(1 for v in result.values() if v.get("price") is not None)
    print(f"[cli_run] OpenD live prices: {found}/{len(tickers)} resolved", file=sys.stderr)
    return result


def _fetch_live_prices(tickers: list[str]) -> dict[str, dict]:
    """
    Fetch current price + change% — tries OpenD first (pre-market aware, RVOL),
    falls back to yfinance (GitHub Actions / no OpenD).
    Returns {TICKER: {price: float|None, changePct: float|None, ...}}.
    """
    if not tickers:
        return {}

    # Try OpenD first
    opend_host = os.environ.get("OPEND_HOST", "127.0.0.1")
    opend_port = int(os.environ.get("OPEND_PORT", "11111"))
    try:
        result = _fetch_live_prices_opend(tickers, host=opend_host, port=opend_port)
        if result:
            return result
    except Exception as e:
        print(f"[cli_run] OpenD fetch failed ({e}), falling back to yfinance", file=sys.stderr)

    # yfinance fallback (used in CI / when OpenD is not running)
    try:
        import yfinance as yf  # optional dep; installed in the GH Actions runner
    except ImportError:
        print("[cli_run] yfinance not installed — skipping live price fetch", file=sys.stderr)
        return {}

    results: dict[str, dict] = {}
    batch = tickers[:25]
    try:
        # Batch download is faster than per-ticker calls.
        # yfinance returns a DataFrame for multiple tickers and a Series-indexed
        # DataFrame for a single ticker — handle both cases.
        raw = yf.download(batch, period="2d", interval="1d", progress=False, auto_adjust=True)
        closes = raw["Close"]
        # For a single ticker yf returns closes as a plain Series; wrap it.
        import pandas as pd
        if isinstance(closes, pd.Series):
            closes = closes.to_frame(name=batch[0])
        for ticker in batch:
            try:
                if ticker not in closes.columns:
                    results[ticker] = {"price": None, "changePct": None}
                    continue
                vals = closes[ticker].dropna()
                if len(vals) >= 2:
                    prev, curr = float(vals.iloc[-2]), float(vals.iloc[-1])
                    change_pct = round((curr - prev) / prev * 100, 2)
                    results[ticker] = {"price": round(curr, 2), "changePct": change_pct}
                elif len(vals) == 1:
                    results[ticker] = {"price": round(float(vals.iloc[-1]), 2), "changePct": None}
                else:
                    results[ticker] = {"price": None, "changePct": None}
            except Exception:
                results[ticker] = {"price": None, "changePct": None}
    except Exception as e:
        print(f"[cli_run] yfinance batch download failed ({e})", file=sys.stderr)
        for ticker in batch:
            results[ticker] = {"price": None, "changePct": None}

    found = sum(1 for v in results.values() if v.get("price") is not None)
    print(f"[cli_run] Live prices fetched: {found}/{len(batch)} tickers resolved", file=sys.stderr)
    return results


_PUBLIC_DIR = (
    ROOT.parent.parent.parent / "apps" / "market_dashboard" / "public" / "market-dashboard"
)
_BACKEND_DATA_DIR = ROOT.parent.parent.parent / "apps" / "market_dashboard_backend" / "data"


def _candidate_paths(filename: str) -> list[Path]:
    """Return ordered candidate locations for a data file."""
    return [
        _PUBLIC_DIR / filename,
        _BACKEND_DATA_DIR / filename,
        ROOT / filename,
    ]


def _fetch_breadth_from_disk() -> dict | None:
    """
    Read the latest breadth.json written by breadth_scan.py.
    Returns the full data dict (with market/momentum/sectors/industries keys),
    or None if the file is missing/malformed.
    """
    for path in _candidate_paths("breadth.json"):
        if not path.exists():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and "market" in data:
                return data          # return full dict, not just market sub-dict
        except Exception:
            continue
    return None


def _load_snapshot() -> dict | None:
    """
    Read snapshot.json produced by build_data.py.
    Returns the parsed dict or None if unavailable.
    """
    for path in _candidate_paths("snapshot.json"):
        if not path.exists():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and "groups" in data:
                return data
        except Exception:
            continue
    return None


def _load_events() -> list[dict]:
    """
    Read events.json produced by build_data.py.
    Returns a list of event dicts or [] if unavailable/empty.
    """
    for path in _candidate_paths("events.json"):
        if not path.exists():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return data
        except Exception:
            continue
    return []


def _format_snapshot_section(snapshot: dict) -> str:
    """
    Render a compact snapshot.json summary for the live_data_block.
    Groups: Indices, Sel Sectors (XLK, XLF, etc.), Industries (first 5 by |daily|).
    Format: TICKER  daily%  5d%  20d%  RS  grade
    """
    lines: list[str] = []
    groups = snapshot.get("groups", {})

    def _row(item: dict) -> str:
        t = item.get("ticker", "?")
        d = item.get("daily")
        fd = item.get("5d")
        td = item.get("20d")
        rs = item.get("rs")
        ab = item.get("abc", "")
        d_s  = f"{'+' if d  and d  > 0 else ''}{d:.2f}%"  if d  is not None else "N/A"
        fd_s = f"{'+' if fd and fd > 0 else ''}{fd:.2f}%"  if fd is not None else "N/A"
        td_s = f"{'+' if td and td > 0 else ''}{td:.2f}%"  if td is not None else "N/A"
        rs_s = f"{int(rs)}" if rs is not None else "N/A"
        return f"    {t:<6} daily={d_s}  5d={fd_s}  20d={td_s}  RS={rs_s}  grade={ab}"

    # --- Indices ---
    indices = groups.get("Indices", [])
    if indices:
        lines.append("  Indices (from snapshot.json — authoritative, use these for index levels):")
        for item in indices:
            lines.append(_row(item))

    # --- Sector ETFs ---
    sectors = groups.get("Sel Sectors", [])
    if sectors:
        lines.append("  Sector ETFs (from snapshot.json — authoritative, use for sectorsThemes):")
        for item in sectors:
            lines.append(_row(item))

    # --- Top industry ETFs (sorted by abs daily move) ---
    industries = groups.get("Industries", [])
    if industries:
        top = sorted(industries, key=lambda x: abs(x.get("daily") or 0), reverse=True)[:8]
        lines.append("  Top industry ETFs (from snapshot.json):")
        for item in top:
            lines.append(_row(item))

    built = snapshot.get("built_at", "unknown")
    lines.append(f"  snapshot.json built_at: {built}")
    return "\n".join(lines)


def _format_events_section(events: list[dict]) -> str:
    """Render events.json as a compact calendar block."""
    if not events:
        return ""
    lines = ["  Economic calendar (from events.json — authoritative):"]
    for ev in events[:10]:
        time = ev.get("time") or ev.get("date") or "TBD"
        name = ev.get("name") or ev.get("event") or "?"
        cons = ev.get("consensus") or ev.get("forecast") or ""
        prev = ev.get("previous") or ""
        row = f"    {time}  {name}"
        if cons:
            row += f"  consensus={cons}"
        if prev:
            row += f"  prev={prev}"
        lines.append(row)
    return "\n".join(lines)


def _build_live_block(
    fear_greed: tuple[int | None, str | None],
    live_prices: dict[str, dict],
    breadth: dict | None = None,
    snapshot: dict | None = None,
    events: list[dict] | None = None,
) -> str:
    lines: list[str] = []

    fg_score, fg_label = fear_greed
    if fg_score is not None:
        lines.append(f"  Fear & Greed Index: {fg_score}/100 ({fg_label})")

    # ── Breadth — copy verbatim into breadth.up / breadth.down ───────────────
    if breadth:
        market = breadth.get("market", breadth)   # full dict or already market sub-dict
        lines.append(
            "  Market breadth (from breadth_scan.py — AUTHORITATIVE. "
            "Copy advance→breadth.up, decline→breadth.down EXACTLY. Never invent or web-search these.):"
        )
        lines.append(f"    advance  (→ breadth.up):   {market.get('advance')}")
        lines.append(f"    decline  (→ breadth.down):  {market.get('decline')}")
        lines.append(f"    new_highs: {market.get('new_highs')}  new_lows: {market.get('new_lows')}")
        lines.append(f"    universe_size: {market.get('universe_size')}")
        lines.append(f"    breadth built_at: {breadth.get('built_at', 'unknown')}")

        # Sector % above 50SMA from breadth_scan
        sectors_b = breadth.get("sectors", [])
        if sectors_b:
            lines.append("  Sector % above 50-SMA (breadth_scan universe):")
            for s in sectors_b:
                lines.append(f"    {s.get('sector')}: {s.get('pct_above_50sma')}%  (n={s.get('n')})")

    # ── Index technicals (ATR / RSI / MACD / extension) ──────────────────────
    # Auto-read from index_technicals.json if compute_index_technicals.py was run.
    tech_path = ROOT / "index_technicals.json"
    if tech_path.exists():
        try:
            tech = json.loads(tech_path.read_text(encoding="utf-8"))
            if tech:
                lines.append("  INDEX TECHNICALS (daily bars — copy verbatim into `technicals` field of StructuredBrief):")
                for sym, t in tech.items():
                    flags = []
                    if t.get("overbought"): flags.append("OVERBOUGHT")
                    if t.get("curving_down"): flags.append("MACD-CURVING-DOWN")
                    if t.get("bear_cross_imminent"): flags.append("BEAR-CROSS-NEAR")
                    flag_str = f" [{','.join(flags)}]" if flags else ""
                    lines.append(
                        f"    {sym}: ${t['close']:.2f}  ATR=${t['atr14']:.2f}  "
                        f"21EMA dist={t['dist_21_atr']:+.2f}ATR  50EMA dist={t['dist_50_atr']:+.2f}ATR  "
                        f"RSI={t['rsi14']:.1f}  MACD={t['macd_dir']}  "
                        f"ENTRY_RISK={t['entry_risk']}{flag_str}"
                    )
                lines.append("    (technicals.<symbol> in output schema — write technicalsNarrative interpreting these.)")
        except Exception as e:
            lines.append(f"  (index_technicals.json present but unreadable: {e})")

    # ── Snapshot (indices + sector ETFs) ─────────────────────────────────────
    if snapshot:
        lines.append(_format_snapshot_section(snapshot))

    # ── Economic calendar ────────────────────────────────────────────────────
    if events:
        lines.append(_format_events_section(events))

    # ── Watchlist live prices ─────────────────────────────────────────────────
    if live_prices:
        source = "OpenD (real-time)" if any(d.get("rvol") for d in live_prices.values()) else "yfinance"
        lines.append(f"  Watchlist live prices ({source} — use for watchlist[].level and changePct):")
        for ticker, d in live_prices.items():
            price = d.get("price")
            chg = d.get("changePct")
            if price is not None:
                chg_str = f"{'+' if chg and chg > 0 else ''}{chg:.2f}%" if chg is not None else "N/A"
                row = f"    {ticker}: ${price:.2f} ({chg_str})"
                rvol = d.get("rvol")
                if rvol is not None:
                    row += f"  RVOL={rvol:.1f}x"
                pre_p = d.get("prePrice")
                pre_c = d.get("preChangePct")
                if pre_p and pre_c is not None:
                    pre_str = f"{'+' if pre_c > 0 else ''}{pre_c:.2f}%"
                    row += f"  pre=${pre_p:.2f}({pre_str})"
                aft_p = d.get("afterPrice")
                aft_c = d.get("afterChangePct")
                if aft_p and aft_c is not None:
                    aft_str = f"{'+' if aft_c > 0 else ''}{aft_c:.2f}%"
                    row += f"  aft=${aft_p:.2f}({aft_str})"
                lines.append(row)
            else:
                lines.append(f"    {ticker}: price unavailable")

    if not lines:
        return "  (No pre-fetched data available — rely on web search for all values.)"
    return "\n".join(lines)


def _build_prompt(
    date_str: str,
    watchlist: list[str],
    fear_greed: tuple[int | None, str | None] = (None, None),
    live_prices: dict[str, dict] | None = None,
    breadth: dict | None = None,
    snapshot: dict | None = None,
    events: list[dict] | None = None,
    screener_unscored: list[str] | None = None,
) -> str:
    template = (ROOT / "prompt.md").read_text(encoding="utf-8")
    live_block = _build_live_block(
        fear_greed,
        live_prices or {},
        breadth=breadth,
        snapshot=snapshot,
        events=events,
    )
    unscored_str = (
        ", ".join(screener_unscored) if screener_unscored
        else "none (all screener tickers already scored)"
    )
    return (
        template
        .replace("{date_str}", date_str)
        .replace("{watchlist_str}", ", ".join(watchlist))
        .replace("{live_data_block}", live_block)
        .replace("{screener_unscored_str}", unscored_str)
    )


# ── provider callers ──────────────────────────────────────────────────────────

def _call_deepseek(prompt: str, *, search: bool = False) -> str:
    """
    Calls DeepSeek chat completions.

    model: deepseek-v4-flash (previously deepseek-chat).
    search=True adds search_options to enable web grounding (beta).
    """
    api_key = os.environ.get("DEEPSEEK_API_KEY", "")
    if not api_key:
        print("DEEPSEEK_API_KEY not set.", file=sys.stderr)
        sys.exit(2)
    payload: dict = {
        "model": "deepseek-v4-flash",
        "messages": [{"role": "user", "content": prompt}],
        "response_format": {"type": "json_object"},
        "max_tokens": 8000,
    }
    if search:
        payload["search_options"] = {"search_enabled": True}
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        "https://api.deepseek.com/v1/chat/completions",
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.loads(r.read().decode("utf-8"))
    return data["choices"][0]["message"]["content"]


def _call_deepseek_search(prompt: str) -> str:
    """DeepSeek v4-flash with web search enabled (primary cron provider)."""
    return _call_deepseek(prompt, search=True)


def _call_openai(prompt: str) -> str:
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        print("OPENAI_API_KEY not set.", file=sys.stderr)
        sys.exit(2)
    body = json.dumps(
        {
            "model": "gpt-4o",
            "messages": [{"role": "user", "content": prompt}],
            "response_format": {"type": "json_object"},
            "max_tokens": 8000,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.loads(r.read().decode("utf-8"))
    return data["choices"][0]["message"]["content"]


def _call_gemini(prompt: str) -> str:
    """Calls Gemini via the REST API with JSON-mode response."""
    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        print("GEMINI_API_KEY not set.", file=sys.stderr)
        sys.exit(2)
    model = "gemini-2.5-pro"
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        f"?key={api_key}"
    )
    body = json.dumps(
        {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                # 16 000 gives Gemini 2.5 Pro plenty of headroom for a full
                # StructuredBrief (typical output ~3-5k tokens). 6 000 was
                # cutting responses mid-JSON on large watchlists.
                "maxOutputTokens": 16000,
            },
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        data = json.loads(r.read().decode("utf-8"))
    # Surface finish reason so truncation is visible in logs
    candidate = data["candidates"][0]
    finish = candidate.get("finishReason", "UNKNOWN")
    if finish not in ("STOP", "MAX_TOKENS"):
        print(f"[cli_run] Gemini finishReason={finish}", file=sys.stderr)
    if finish == "MAX_TOKENS":
        print(
            "[cli_run] WARNING: Gemini hit MAX_TOKENS — response may be truncated. "
            "JSON parse will likely fail. Try reducing watchlist size.",
            file=sys.stderr,
        )
    return candidate["content"]["parts"][0]["text"]


def _call_claude(prompt: str) -> str:
    """Calls Claude via the Anthropic Messages API (no streaming)."""
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        print("ANTHROPIC_API_KEY not set.", file=sys.stderr)
        sys.exit(2)
    body = json.dumps(
        {
            "model": "claude-opus-4-5",
            "max_tokens": 6000,
            "messages": [{"role": "user", "content": prompt}],
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.loads(r.read().decode("utf-8"))
    return data["content"][0]["text"]


CALLERS = {
    "deepseek": _call_deepseek,          # deepseek-v4-flash, no search
    "deepseek-search": _call_deepseek_search,  # deepseek-v4-flash + web search (preferred for cron)
    "openai": _call_openai,
    "gemini": _call_gemini,
    "claude": _call_claude,
}

def _fetch_dashboard_watchlist() -> list[str]:
    """Fetch the owner's watchlist from the dashboard API."""
    base = os.environ.get("VERCEL_INGEST_URL", "").rstrip("/")
    key = os.environ.get("BRIEF_INGEST_KEY", "")
    if not base or not key:
        return []
    url = f"{base}/api/watchlist/export"
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {key}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read().decode("utf-8"))
            return data.get("tickers", [])
    except Exception as e:
        print(f"[cli_run] watchlist fetch failed ({e}), will use fallback.", file=sys.stderr)
        return []


_TV_SCREENER_PATHS = [
    ROOT.parent.parent.parent / "apps" / "market_dashboard" / "public" / "market-dashboard" / "tv_screeners.json",
    ROOT / "tv_screeners.json",
]


def _load_tv_screeners() -> dict | None:
    for path in _TV_SCREENER_PATHS:
        if path.exists():
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                pass
    return None


def _top_screener_tickers(max_per_screener: int = 5) -> list[str]:
    """
    Pull the top tickers from the latest tv_screeners.json if available.
    Looks in the project's public/market-dashboard/ folder relative to this script.
    """
    data = _load_tv_screeners()
    if not data:
        return []
    tickers: list[str] = []
    for screener in data.get("screeners", []):
        hits = screener.get("hits", [])
        for hit in hits[:max_per_screener]:
            t = hit.get("ticker")
            if t and t not in tickers:
                tickers.append(t)
    return tickers


def _screener_unscored_tickers() -> list[str]:
    """
    Return screener tickers that were NOT auto-scored by the daily pipeline
    (i.e. hits that have no `score` field). These will be included in the
    StructuredBrief under `screenerScores` so the dashboard can display them.
    """
    data = _load_tv_screeners()
    if not data:
        return []
    tickers: list[str] = []
    for screener in data.get("screeners", []):
        for hit in screener.get("hits", []):
            if hit.get("score") is None:
                t = hit.get("ticker")
                if t and t not in tickers:
                    tickers.append(t)
    return tickers


def _parse_tickers(raw: str) -> list[str]:
    """Split a comma/space/newline-separated string into clean uppercase tickers."""
    return [t.strip().upper() for t in raw.replace("\n", ",").split(",") if t.strip()]


def _build_watchlist(cli_override: str | None, tv_tickers: list[str] | None = None) -> list[str]:
    """
    Build the final watchlist for the morning brief.

    Layer 1 — Personal watchlist (your curated holds + watchlist)
    ---------------------------------------------------------------
    Priority:
      a) --watchlist flag (manual one-off override)
      b) --tv-watchlist tickers extracted from Chrome MCP (passed via tv_tickers)
      c) WATCHLIST env var in .env.local
      d) Dashboard DB via /api/watchlist/export

    Layer 2 — Screener top tickers (new opportunities from today's TV screeners)
    ---------------------------------------------------------------
    Always merged on top of Layer 1 (deduplicated, max 8 new tickers).
    Read from tv_screeners.json (generated by tv_screener_fetch.py).

    Layer 3 — Empty fallback
    ---------------------------------------------------------------
    If nothing is available, return [] and let the LLM work with the snapshot.
    """
    personal: list[str] = []

    # a. CLI --watchlist flag
    if cli_override:
        personal = _parse_tickers(cli_override)

    # b. TV tickers extracted by Claude CLI via Chrome MCP
    if not personal and tv_tickers:
        personal = tv_tickers

    # c. Env var
    if not personal:
        env_raw = os.environ.get("WATCHLIST", "")
        if env_raw:
            personal = _parse_tickers(env_raw)

    # d. Dashboard DB
    if not personal:
        personal = _fetch_dashboard_watchlist()

    # Layer 2 — always merge screener top tickers
    screener = _top_screener_tickers()
    screener_extras = [t for t in screener if t not in personal][:8]
    combined = personal + screener_extras

    return combined


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a StructuredBrief via an AI provider.")
    parser.add_argument(
        "--provider",
        default="deepseek-search",
        choices=list(CALLERS),
        help="Which AI provider to use (default: deepseek-search = v4-flash + web search)",
    )
    parser.add_argument("--post", action="store_true", help="Push result to the dashboard ingest API")
    parser.add_argument("--out", default=None, help="Save JSON output to a file")
    parser.add_argument(
        "--watchlist",
        default=None,
        help="Comma-separated tickers — overrides WATCHLIST env var and dashboard DB",
    )
    parser.add_argument(
        "--tv-watchlist",
        default=None,
        dest="tv_watchlist",
        help="Tickers extracted from TradingView by Claude CLI Chrome MCP (comma-separated). "
             "Used by the morning-brief SKILL.md step that navigates the TV watchlist URL.",
    )
    args = parser.parse_args()

    tv_tickers = _parse_tickers(args.tv_watchlist) if args.tv_watchlist else None
    watchlist = _build_watchlist(args.watchlist, tv_tickers=tv_tickers)

    # Build date string (Malaysia time)
    now_myt = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=8)
    # %-d (Linux) and %#d (Windows) both mean "day without leading zero".
    # Use a portable alternative that works on all platforms.
    date_str = now_myt.strftime("%A, %B {day}, %Y").replace(
        "{day}", str(now_myt.day)
    )  # e.g. "Thursday, May 14, 2026"

    # ── Pre-fetch live data before calling the LLM ──────────────────────────
    print("[cli_run] Fetching Fear & Greed Index...", file=sys.stderr)
    fear_greed = _fetch_fear_and_greed()
    fg_score, fg_label = fear_greed
    print(
        f"[cli_run] Fear & Greed: {fg_score}/100 ({fg_label})" if fg_score else "[cli_run] Fear & Greed: unavailable",
        file=sys.stderr,
    )

    print(f"[cli_run] Fetching live prices for {len(watchlist)} tickers...", file=sys.stderr)
    live_prices = _fetch_live_prices(watchlist)

    breadth_data = _fetch_breadth_from_disk()
    if breadth_data:
        m = breadth_data.get("market", {})
        print(
            f"[cli_run] Breadth from disk: advance={m.get('advance')} decline={m.get('decline')} "
            f"new_highs={m.get('new_highs')} new_lows={m.get('new_lows')} universe={m.get('universe_size')} "
            f"built_at={breadth_data.get('built_at', '?')}",
            file=sys.stderr,
        )
    else:
        print("[cli_run] Breadth: no breadth.json found — LLM will return null", file=sys.stderr)

    snapshot = _load_snapshot()
    if snapshot:
        n_groups = len(snapshot.get("groups", {}))
        print(f"[cli_run] Snapshot loaded: {n_groups} groups, built_at={snapshot.get('built_at','?')}", file=sys.stderr)
    else:
        print("[cli_run] Snapshot: no snapshot.json found — LLM will web-search for sector/index data", file=sys.stderr)

    events = _load_events()
    print(f"[cli_run] Events: {len(events)} calendar events loaded", file=sys.stderr)

    screener_unscored = _screener_unscored_tickers()
    if screener_unscored:
        print(f"[cli_run] Unscored screener tickers to score: {screener_unscored}", file=sys.stderr)
    else:
        print("[cli_run] All screener tickers already scored (or no screener file found).", file=sys.stderr)

    prompt = _build_prompt(
        date_str, watchlist,
        fear_greed=fear_greed,
        live_prices=live_prices,
        breadth=breadth_data,
        snapshot=snapshot,
        events=events,
        screener_unscored=screener_unscored,
    )

    print(f"[cli_run] provider={args.provider}  date={date_str}  watchlist={watchlist}", file=sys.stderr)
    print("[cli_run] Calling provider...", file=sys.stderr)

    caller = CALLERS[args.provider]
    try:
        raw = caller(prompt)
    except urllib.error.HTTPError as e:
        print(f"Provider HTTP {e.code}: {e.read().decode()}", file=sys.stderr)
        sys.exit(1)

    # Parse JSON — strip any accidental markdown fences
    raw_stripped = raw.strip()
    if raw_stripped.startswith("```"):
        lines = raw_stripped.split("\n")
        raw_stripped = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

    try:
        structured = json.loads(raw_stripped)
    except json.JSONDecodeError as exc:
        print(f"JSON parse error: {exc}", file=sys.stderr)
        # Show ~200 chars around the failure position for easy diagnosis
        pos = exc.pos
        snippet_start = max(0, pos - 120)
        snippet_end = min(len(raw_stripped), pos + 120)
        snippet = raw_stripped[snippet_start:snippet_end]
        arrow = " " * (pos - snippet_start) + "^"
        print(f"Context around char {pos}:\n{snippet}\n{arrow}", file=sys.stderr)
        if len(raw_stripped) < 200:
            print("Full response (short):\n", raw_stripped, file=sys.stderr)
        elif exc.msg == "Expecting value" and pos > len(raw_stripped) - 50:
            print(
                "[cli_run] Response appears truncated (hit token limit). "
                "Try --provider deepseek for a shorter output, or reduce watchlist size.",
                file=sys.stderr,
            )
        sys.exit(1)

    print("[cli_run] ✓ JSON parsed successfully.", file=sys.stderr)

    # Integrity gate: withhold ungrounded news so the dashboard never shows
    # invented news/ratings/calendar as current. The prompt forbids
    # fabrication, but instructions are not enforcement.
    from validate_brief import sanitize_news
    structured, withheld = sanitize_news(
        structured, provider=args.provider, has_events=bool(events)
    )
    if withheld:
        fields = ", ".join(w["field"] for w in withheld)
        print(
            f"[cli_run] withheld ungrounded sections [{fields}] - no source "
            "citations; rendered Unavailable, not invented.",
            file=sys.stderr,
        )

    # Save to file if requested
    if args.out:
        out_path = Path(args.out)
        out_path.write_text(json.dumps(structured, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"[cli_run] Saved to {out_path}", file=sys.stderr)

    # Print JSON to stdout (so it can be piped to ingest_to_dashboard.py)
    print(json.dumps(structured, indent=2, ensure_ascii=False))

    # Push to dashboard if requested
    if args.post:
        print("[cli_run] Pushing to dashboard...", file=sys.stderr)
        result = _push(structured, args.provider)
        print(
            f"[cli_run] Ingest readback: provider={result.get('provider','?')} "
            f"bucketAt={result.get('bucketAt','?')} generatedBy={result.get('generatedBy','?')} "
            f"structured={result.get('hasStructuredJson', False)}",
            file=sys.stderr,
        )
        print(
            f"[cli_run] ✓ Pushed: bucketAt={result.get('bucketAt','?')} id={result.get('id','?')}",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
