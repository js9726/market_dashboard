"""
industry_proxies.py — the Industry Proxy Board.

WHY THIS EXISTS (2026-08-12 operator directive, after the DELL/HPE miss).
The 2026-08-10 brief scored DELL WAIT because Finviz ranked Computer Hardware
#142/144 on a 1-month lookback. That rank was poor *because the group was
mid-consolidation* — the very setup that then resolved +9.87% in one session.
A 1-month performance rank is a lagging statistic; it cannot distinguish
"group is broken" from "group is basing".

The 21 DMA can. A group pulling back to a RISING 21 DMA and holding it is
consolidating; a group losing a FALLING 21 DMA is broken. Same rank, opposite
meaning.

So every morning brief must report, for each industry in play:
  - the Finviz industry name,
  - the PROXY TICKER Jie can actually chart,
  - price vs that proxy's 21 DMA, and whether the 21 DMA is rising,
  - the resulting state: HOLDING / RECLAIMING / LOST / EXTENDED.

Run:  python industry_proxies.py
      python industry_proxies.py --tickers IGV,SMH,CIBR
"""
from __future__ import annotations

import argparse
import datetime as dt

import pandas as pd
from moomoo import KLType, OpenQuoteContext, RET_OK

# Finviz industry -> the ticker Jie can put on a TradingView chart.
# "names" is used where no clean ETF exists; state that honestly in the brief
# rather than substituting a broad-sector ETF (that is the lens error that hid
# cybersecurity for six sessions — see SKILL.md Step 0.8).
PROXIES: list[dict] = [
    {"industry": "Software - Infrastructure", "proxy": "IGV",  "kind": "etf"},
    {"industry": "Cybersecurity (sub-theme)", "proxy": "CIBR", "kind": "etf"},
    {"industry": "Software - Application",    "proxy": "WCLD", "kind": "etf"},
    {"industry": "Semiconductors",            "proxy": "SMH",  "kind": "etf"},
    {"industry": "Semiconductor Equipment",   "proxy": "XSD",  "kind": "etf"},
    {"industry": "Computer Hardware / AI servers", "proxy": "XLK", "kind": "loose",
     "names": "DELL, HPE, SMCI, ANET — no clean ETF exists; XLK is broad tech, treat as loose"},
    {"industry": "Communication Equipment",   "proxy": "IYZ",  "kind": "loose",
     "names": "ANET, CSCO, FFIV — IYZ is telecom-weighted, treat as loose"},
    {"industry": "Gold",                      "proxy": "GDX",  "kind": "etf"},
    {"industry": "Silver",                    "proxy": "SILJ", "kind": "etf"},
    {"industry": "Steel",                     "proxy": "SLX",  "kind": "etf"},
    {"industry": "Copper",                    "proxy": "CPER", "kind": "etf"},
    {"industry": "Oil & Gas E&P",             "proxy": "XOP",  "kind": "etf"},
    {"industry": "Uranium / Nuclear",         "proxy": "URA",  "kind": "etf"},
    {"industry": "Biotech (INDICATOR ONLY)",  "proxy": "XBI",  "kind": "etf"},
    {"industry": "Crypto-adjacent",           "proxy": "WGMI", "kind": "etf"},
]


def classify(px: float, dma21: float, rising: bool, atr: float) -> str:
    """State of the group relative to its 21 DMA."""
    dist_atr = (px - dma21) / atr if atr else 0.0
    if px < dma21:
        return "LOST (below 21DMA)" if not rising else "UNDERCUT (below a rising 21DMA)"
    if dist_atr > 2.5:
        return "EXTENDED above 21DMA"
    if dist_atr < 0.35:
        return "HOLDING at 21DMA" if rising else "AT a flat/falling 21DMA"
    return "ABOVE rising 21DMA" if rising else "ABOVE a falling 21DMA"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tickers", help="comma list to override the default proxy board")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=11111)
    args = ap.parse_args()

    board = PROXIES
    if args.tickers:
        wanted = {t.strip().upper() for t in args.tickers.split(",")}
        board = [p for p in PROXIES if p["proxy"] in wanted] or [
            {"industry": t, "proxy": t, "kind": "etf"} for t in sorted(wanted)
        ]

    end = dt.date.today()
    start = end - dt.timedelta(days=180)
    ctx = OpenQuoteContext(host=args.host, port=args.port)
    rows = []
    try:
        for p in board:
            ret, k, _ = ctx.request_history_kline(
                f"US.{p['proxy']}", start=str(start), end=str(end),
                ktype=KLType.K_DAY, max_count=400,
            )
            if ret != RET_OK or k is None or len(k) < 30:
                rows.append({**p, "error": str(k)[:60]})
                continue
            c, h, l = k["close"], k["high"], k["low"]
            dma21 = c.rolling(21).mean()
            tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
            atr = tr.rolling(14).mean().iloc[-1]
            px = float(c.iloc[-1])
            d21 = float(dma21.iloc[-1])
            rising = bool(dma21.iloc[-1] > dma21.iloc[-6])  # 5 sessions of slope
            rows.append({
                **p,
                "px": px, "dma21": d21, "atr": float(atr),
                "pct": (px / d21 - 1) * 100,
                "dist_atr": (px - d21) / atr if atr else 0.0,
                "rising": rising,
                "state": classify(px, d21, rising, float(atr)),
            })
    finally:
        ctx.close()

    print(f"{'INDUSTRY':<34} {'PROXY':<6} {'PRICE':>9} {'21DMA':>9} {'vs21':>8} {'ATRs':>6}  {'SLOPE':<8} STATE")
    print("-" * 118)
    for r in rows:
        if "error" in r:
            print(f"{r['industry']:<34} {r['proxy']:<6}  DATA UNAVAILABLE — {r['error']}")
            continue
        slope = "rising" if r["rising"] else "falling"
        flag = "*" if r["kind"] == "loose" else " "
        print(f"{r['industry']:<34} {r['proxy']:<5}{flag} {r['px']:>9.2f} {r['dma21']:>9.2f} "
              f"{r['pct']:>7.2f}% {r['dist_atr']:>6.2f}  {slope:<8} {r['state']}")
    if any(r.get("kind") == "loose" for r in rows):
        print("\n* loose proxy — no clean ETF for that industry; see 'names' in PROXIES and say so in the brief.")


if __name__ == "__main__":
    main()
