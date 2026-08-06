"""
breadth_ma.py — compute % of stocks above their 5 / 20 / 50-day MA, measured, not guessed.

Why this exists
---------------
The ⑦ Market Edge checklist has a "% above 5dma > 75%" row. StockCharts publishes
$SPXA50R (50-day), $SPXA150R and $SPXA200R — but **no 5-day series**. On 2026-08-06 the
skill pointed at $SPXA50R for a 5-day question, which is simply the wrong metric. Rather
than send the operator hunting for a chart that does not exist, measure it.

One POST to the TradingView scanner returns close + SMA5/SMA20/SMA50 for the whole
liquid US universe, so this is a single request, not 6,934 kline calls.

Usage
-----
    python breadth_ma.py                 # S&P-500-scale liquid universe
    python breadth_ma.py --min-cap 2e9   # tighten/loosen the universe
    python breadth_ma.py --json
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")

URL = "https://scanner.tradingview.com/america/scan"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Content-Type": "application/json"}


def fetch(min_cap: float, min_price: float, min_vol: float) -> list[dict]:
    cols = ["name", "close", "SMA5", "SMA20", "SMA50", "market_cap_basic"]
    body = {
        "filter": [
            {"left": "market_cap_basic", "operation": "egreater", "right": min_cap},
            {"left": "close", "operation": "egreater", "right": min_price},
            {"left": "average_volume_10d_calc", "operation": "egreater", "right": min_vol},
            {"left": "is_primary", "operation": "equal", "right": True},
        ],
        "options": {"lang": "en"},
        "markets": ["america"],
        "symbols": {"query": {"types": ["stock"]}, "tickers": []},
        "columns": cols,
        "sort": {"sortBy": "market_cap_basic", "sortOrder": "desc"},
        "range": [0, 3000],
    }
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), headers=UA, method="POST")
    with urllib.request.urlopen(req, timeout=45) as r:
        data = json.loads(r.read())
    out = []
    for row in data.get("data", []):
        d = row.get("d", [])
        if len(d) < len(cols):
            continue
        rec = dict(zip(cols, d))
        if rec["close"] is None:
            continue
        out.append(rec)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-cap", type=float, default=2e9)
    ap.add_argument("--min-price", type=float, default=5.0)
    ap.add_argument("--min-vol", type=float, default=300_000)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    rows = fetch(a.min_cap, a.min_price, a.min_vol)
    if not rows:
        print("FAIL-CLOSED: scanner returned 0 rows. Do NOT tick the breadth row.", file=sys.stderr)
        return 1

    res = {"universe": len(rows), "min_cap_usd": a.min_cap}
    for ma in ("SMA5", "SMA20", "SMA50"):
        valid = [r for r in rows if r.get(ma)]
        above = [r for r in valid if r["close"] > r[ma]]
        res[ma] = {"n": len(valid),
                   "above": len(above),
                   "pct": round(len(above) / len(valid) * 100, 1) if valid else None}

    if a.json:
        print(json.dumps(res, indent=2))
        return 0

    print(f"\n  BREADTH — % of stocks above their moving average")
    print(f"  universe: {res['universe']} US primary stocks, cap >= ${a.min_cap/1e9:.0f}B, "
          f"price >= ${a.min_price:.0f}, 10d avg vol >= {a.min_vol:,.0f}\n")
    for ma, label, thresh in (("SMA5", "5-day", 75), ("SMA20", "20-day", None), ("SMA50", "50-day", None)):
        v = res[ma]
        flag = ""
        if thresh and v["pct"] is not None:
            flag = "  <-- STRETCHED (>75%)" if v["pct"] > thresh else f"  <-- below {thresh}%, NOT stretched"
        print(f"   above {label:8s} {v['pct']:>5.1f}%   ({v['above']}/{v['n']}){flag}")
    print()
    print("  Tick ⑦ Market Edge row '% above 5dma > 75%' from the 5-day line above.")
    print("  StockCharts has NO 5-day series — $SPXA50R is the 50-day. This is the real number.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
