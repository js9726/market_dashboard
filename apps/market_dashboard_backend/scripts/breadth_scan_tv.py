"""
breadth_scan_tv.py — Breadth scanner using TradingView's screener API.

Why this exists:
  - yfinance is rate-limited to death (30%+ of tickers fail)
  - stooq fallback's CSV schema changed ('Date' column missing)
  - moomoo OpenD has a daily history-kline quota cap (~100 calls/day)

TradingView's scanner.tradingview.com endpoint (the one your TV screener UI
uses) accepts a SINGLE bulk query returning thousands of tickers with
sector/industry/SMA-positioning/RVOL/perf already computed server-side.
No auth required for the columns we use, no documented rate limit at
typical daily volume. Completely free.

What we ask TV for (one query, range [0, 5000]):
    close, change, volume, relative_volume_10d_calc,
    market_cap_basic, sector, industry,
    Perf.W, Perf.1M,
    high.52, low.52,
    SMA50, SMA200, close.above_or_below.SMA50, close.above_or_below.SMA200

That's everything `breadth_scan.py` computes per-ticker — but via 1 HTTP call
instead of 6800.

Outputs:
  data/breadth.json
  data/breadth_history.json

Usage:
    python scripts/breadth_scan_tv.py --out-dir data
    python scripts/breadth_scan_tv.py --out-dir data --mcap-floor 5000000000
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from breadth_scan import update_history  # noqa: E402
from build_data import sanitize_json, safe_json_dumps  # noqa: E402

TV_ENDPOINT = "https://scanner.tradingview.com/america/scan"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) breadth_scan_tv/1.0"

# Columns we ask TradingView for. Each maps to a field in the response array.
# Order matters — response is positional.
COLUMNS = [
    "close",
    "change",
    "volume",
    "relative_volume_10d_calc",
    "market_cap_basic",
    "sector",
    "industry",
    "Perf.W",
    "Perf.1M",
    "Perf.3M",
    "Perf.6M",
    "Perf.Y",
    "price_52_week_high",
    "price_52_week_low",
    "SMA50",
    "SMA200",
    "open",
]


def fetch_tv_universe(mcap_floor: float, range_size: int = 5000) -> list[dict]:
    """Single bulk TV screener call. Returns list of dicts keyed by COLUMNS."""
    body = {
        "filter": [
            {"left": "market_cap_basic", "operation": "egreater", "right": mcap_floor},
            {"left": "is_primary", "operation": "equal", "right": True},
            {"left": "type", "operation": "equal", "right": "stock"},
            {"left": "exchange", "operation": "in_range", "right": ["AMEX", "NASDAQ", "NYSE"]},
            # Liquidity floor — drop OTC + penny stocks
            {"left": "volume", "operation": "egreater", "right": 50000},
            {"left": "close", "operation": "egreater", "right": 5},
        ],
        "options": {"lang": "en"},
        "markets": ["america"],
        "symbols": {"query": {"types": []}, "tickers": []},
        "columns": COLUMNS,
        "sort": {"sortBy": "market_cap_basic", "sortOrder": "desc"},
        "range": [0, range_size],
    }
    payload = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        TV_ENDPOINT,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
            "Origin": "https://www.tradingview.com",
            "Referer": "https://www.tradingview.com/",
        },
        method="POST",
    )
    print(f"[tv-breadth] querying TradingView with mcap>={mcap_floor:,.0f}, range[0:{range_size}]")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"[tv-breadth] HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:500]}", file=sys.stderr)
        return []

    rows = data.get("data") or []
    print(f"[tv-breadth] got {len(rows)} rows from TV (total available: {data.get('totalCount')})")
    out = []
    for row in rows:
        symbol = row.get("s", "")  # e.g. "NASDAQ:NVDA"
        ticker = symbol.split(":", 1)[1] if ":" in symbol else symbol
        d = row.get("d") or []
        mapped = {col: d[i] if i < len(d) else None for i, col in enumerate(COLUMNS)}
        mapped["ticker"] = ticker
        out.append(mapped)
    return out


def _f(x):
    """Safe float — returns None for None / non-numeric, else float."""
    if x is None:
        return None
    try:
        f = float(x)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except (TypeError, ValueError):
        return None


def to_metric(row: dict) -> dict | None:
    """Convert a TV row to the metric dict shape that breadth_scan.aggregate() expects."""
    last = _f(row.get("close"))
    if last is None:
        return None
    chg_pct = _f(row.get("change")) or 0.0
    today_open = _f(row.get("open"))
    change_open_pct = ((last / today_open) - 1) * 100 if today_open else 0.0
    today_vol = _f(row.get("volume")) or 0.0
    rvol = _f(row.get("relative_volume_10d_calc")) or 1.0
    avg_vol_30 = today_vol / rvol if rvol > 0 else today_vol  # back-derive
    high_52w = _f(row.get("price_52_week_high")) or last
    low_52w = _f(row.get("price_52_week_low")) or last
    sma50 = _f(row.get("SMA50"))
    sma200 = _f(row.get("SMA200"))

    # Stage classification — Stan Weinstein 4-stage from SMA50 vs SMA200 + slope direction.
    # We don't have 30-week slope here so use a proxy: Perf.3M direction.
    perf_3m = _f(row.get("Perf.3M")) or 0.0
    perf_6m = _f(row.get("Perf.6M")) or 0.0
    if sma50 is None or sma200 is None:
        stage = 0
    elif last > sma50 > sma200 and perf_3m > 0:
        stage = 2  # Stage 2 — uptrend
    elif last < sma50 < sma200 and perf_3m < 0:
        stage = 4  # Stage 4 — downtrend
    elif sma50 < sma200 and perf_3m > 5:
        stage = 1  # Stage 1 — base/accumulation
    else:
        stage = 3  # Stage 3 — top/distribution

    return {
        "ticker": row["ticker"],
        "price": last,
        "change_pct": chg_pct,
        "change_open_pct": change_open_pct,
        "today_vol": today_vol,
        "avg_vol_30": avg_vol_30,
        "is_new_high": last >= high_52w * 0.999,
        "is_new_low": last <= low_52w * 1.001,
        "sma50": sma50,
        "above_sma50": (sma50 is not None and last > sma50),
        "stage": stage,
        "market_cap": _f(row.get("market_cap_basic")),
        "sector": row.get("sector"),
        "industry": row.get("industry"),
    }


def aggregate(metrics: list[dict], mcap_floor: float) -> dict:
    """Same aggregation as breadth_scan.py — count + per-sector + per-industry rollups.
    Reimplemented here to avoid the import-cycle with breadth_scan (which has its own
    aggregate that filters per-row internally)."""
    big = [m for m in metrics if (m.get("market_cap") or 0) >= mcap_floor]

    def count(rows, pred):
        return sum(1 for r in rows if pred(r))

    market = {
        "new_highs":    count(metrics, lambda r: r["is_new_high"]),
        "new_lows":     count(metrics, lambda r: r["is_new_low"]),
        "advance":      count(metrics, lambda r: r["change_pct"] > 0),
        "decline":      count(metrics, lambda r: r["change_pct"] < 0),
        "stage_counts": {str(s): count(metrics, lambda r, s=s: r["stage"] == s) for s in (1, 2, 3, 4)},
        "universe_size": len(metrics),
    }
    momentum = {
        "up_from_open":   count(metrics, lambda r: r["change_open_pct"] > 0),
        "down_from_open": count(metrics, lambda r: r["change_open_pct"] < 0),
        "up_on_volume":   count(metrics, lambda r: r["change_pct"] > 0 and r["today_vol"] > r["avg_vol_30"]),
        "down_on_volume": count(metrics, lambda r: r["change_pct"] < 0 and r["today_vol"] > r["avg_vol_30"]),
        "up_4pct":        count(metrics, lambda r: r["change_pct"] >= 4),
        "down_4pct":      count(metrics, lambda r: r["change_pct"] <= -4),
    }

    by_sector: dict[str, list] = {}
    for r in big:
        sec = r.get("sector")
        if not sec:
            continue
        by_sector.setdefault(sec, []).append(r)
    sectors = []
    for sec, rows in sorted(by_sector.items()):
        n = len(rows)
        if n == 0:
            continue
        pct_above = round(100.0 * sum(1 for r in rows if r["above_sma50"]) / n, 1)
        sectors.append({"sector": sec, "n": n, "pct_above_50sma": pct_above})

    by_industry: dict[str, list] = {}
    for r in big:
        ind = r.get("industry")
        if not ind:
            continue
        by_industry.setdefault(ind, []).append(r)
    industries = []
    for ind, rows in sorted(by_industry.items()):
        n = len(rows)
        if n < 5:
            continue
        pct_above = round(100.0 * sum(1 for r in rows if r["above_sma50"]) / n, 1)
        industries.append({"industry": ind, "n": n, "pct_above_50sma": pct_above})

    return {"market": market, "momentum": momentum, "sectors": sectors, "industries": industries}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out-dir", default="data")
    ap.add_argument("--mcap-floor", type=float, default=2_000_000_000,
                    help="Universe filter — only stocks with mcap >= this (default $2B)")
    ap.add_argument("--mcap-fetch", type=float, default=300_000_000,
                    help="Fetch floor — pull all stocks above this; aggregate panels still use --mcap-floor (default $300M for breadth counts)")
    ap.add_argument("--range", type=int, default=5000, help="Max rows to fetch (default 5000)")
    ap.add_argument("--out-name", default="breadth.json", help="Output filename in out-dir")
    args = ap.parse_args()

    out_dir = args.out_dir
    os.makedirs(out_dir, exist_ok=True)

    rows = fetch_tv_universe(mcap_floor=args.mcap_fetch, range_size=args.range)
    if not rows:
        print("[tv-breadth] no rows from TV — aborting", file=sys.stderr)
        return 1

    metrics = [m for m in (to_metric(r) for r in rows) if m is not None]
    print(f"[tv-breadth] mapped {len(metrics)} valid metrics (dropped {len(rows) - len(metrics)} with bad data)")

    snapshot = {
        "as_of": datetime.now(timezone.utc).isoformat(),
        "generated_by": "breadth_scan_tv",
        "mcap_floor": args.mcap_floor,
        "mcap_fetch": args.mcap_fetch,
        "universe_size": len(metrics),
        **aggregate(metrics, mcap_floor=args.mcap_floor),
    }

    # History (rolling 30d for WoW/MoM deltas — same file the legacy scan uses)
    snapshot = update_history(out_dir, snapshot) or snapshot

    out_path = os.path.join(out_dir, args.out_name)
    safe = sanitize_json(snapshot)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(safe_json_dumps(safe))
    print(f"[tv-breadth] wrote {out_path}")
    print(f"  market: highs={snapshot['market']['new_highs']} lows={snapshot['market']['new_lows']} "
          f"adv={snapshot['market']['advance']} dec={snapshot['market']['decline']}")
    print(f"  stages: S1={snapshot['market']['stage_counts']['1']} "
          f"S2={snapshot['market']['stage_counts']['2']} "
          f"S3={snapshot['market']['stage_counts']['3']} "
          f"S4={snapshot['market']['stage_counts']['4']}")
    print(f"  sectors: {len(snapshot['sectors'])}  industries: {len(snapshot['industries'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
