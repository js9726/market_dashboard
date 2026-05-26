"""
build_curated_universe.py — Compose a "good enough" breadth universe within OpenD's free quota.

Pulls liquid US tickers from sources that already exist:
  1. Hardcoded mega/large-cap baseline (~70 names — SPY components most likely held)
  2. Today's TV screener hits (data/tv_screeners.json) — adds the day's movers
  3. Operator watchlists from morning_brief / opend_live cache

Writes data/_curated_universe.json. breadth_scan_opend.py will prefer this
over the 6880-ticker NASDAQ/NYSE composite when present.

Total target: ~120-180 tickers. Fits OpenD free-tier history quota
(~100-150 / day) comfortably with margin to spare.

Usage:
    python scripts/build_curated_universe.py --out-dir data
"""
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

# Baseline universe — the "always include" tickers. Roughly: top mega-caps,
# popular swing-trading names, sector leaders, semis, AI infra. Curated to be
# what would actually show up in a breadth panel that matters for momentum
# trading. Skip dual-class shares (BRK.B etc.) since OpenD prefix handling
# differs for them.
BASELINE = [
    # Mega-caps
    "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "AVGO", "ORCL",
    "NFLX", "ADBE", "CRM", "INTC", "AMD", "QCOM",
    # Banks/financials
    "JPM", "BAC", "WFC", "GS", "MS", "C", "BLK", "AXP", "V", "MA",
    # Industrials/energy/materials
    "BA", "CAT", "DE", "HON", "GE", "RTX", "LMT", "XOM", "CVX", "OXY",
    "FCX", "NEM",
    # Consumer
    "WMT", "COST", "HD", "LOW", "NKE", "SBUX", "DIS", "MCD", "TGT",
    "BKNG", "ABNB", "UBER",
    # Healthcare
    "UNH", "JNJ", "LLY", "PFE", "MRK", "ABBV", "TMO", "DHR", "ISRG",
    # Sector ETFs (for sector-momentum signal)
    "SPY", "QQQ", "IWM", "DIA", "XLK", "XLF", "XLE", "XLV", "XLI", "XLU",
    "XLY", "XLP", "XLC", "XLB", "XLRE", "SMH", "CIBR", "IGV", "IBB", "GLD",
    "TLT", "USO",
    # Swing-trading favorites (AI infra / semis)
    "ALAB", "CRDO", "MRVL", "ARM", "DDOG", "SNOW", "PLTR", "CRWD", "PANW",
    "ZS", "NET", "MDB", "SHOP", "SQ", "PYPL", "ROKU",
    # Recent screener-popular names
    "NTAP", "PTON", "DELL", "HPQ", "QBTS", "SMCI", "IONQ", "RKLB",
]


def load_tv_screener_tickers(data_dir: Path) -> set[str]:
    """All tickers appearing in today's TV screener hits, top 10 per screener."""
    path = data_dir / "tv_screeners.json"
    if not path.exists():
        return set()
    try:
        d = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return set()
    out = set()
    for screener in d.get("screeners", []):
        for hit in (screener.get("hits") or [])[:10]:
            t = (hit.get("ticker") or "").strip().upper()
            if t and len(t) <= 6 and t.isalpha():
                out.add(t)
    return out


def load_opend_live_tickers(data_dir: Path) -> set[str]:
    """Whatever the morning-brief OpenD snapshot was last subscribed to."""
    candidates = [
        data_dir.parent.parent / "packages" / "core-skills" / "morning-brief" / "opend_live.json",
        data_dir / "opend_live.json",
    ]
    out = set()
    for p in candidates:
        if not p.exists():
            continue
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if isinstance(d, list):
            for row in d:
                t = (row.get("ticker") or "").strip().upper()
                if t:
                    out.add(t)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out-dir", default="data")
    ap.add_argument("--max-size", type=int, default=180,
                    help="Cap final universe size (default 180; tune to your moomoo quota)")
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    tickers = set(BASELINE)
    screener_extras = load_tv_screener_tickers(out_dir) - tickers
    live_extras = load_opend_live_tickers(out_dir) - tickers - screener_extras

    print(f"[curated] baseline: {len(BASELINE)}")
    print(f"[curated] screener extras: {len(screener_extras)} ({sorted(screener_extras)[:10]}...)")
    print(f"[curated] live extras: {len(live_extras)} ({sorted(live_extras)[:10]}...)")

    final = sorted(tickers | screener_extras | live_extras)
    if len(final) > args.max_size:
        # Trim — prefer baseline + screener extras over opend_live extras (they
        # might be just whatever the daemon happened to subscribe to)
        final = sorted(set(BASELINE) | screener_extras)[: args.max_size]
        print(f"[curated] trimmed to {len(final)} (cap was {args.max_size})")

    cache = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "count": len(final),
        "source": "curated",
        "tickers": final,
    }
    out_path = out_dir / "_curated_universe.json"
    out_path.write_text(json.dumps(cache, indent=2), encoding="utf-8")
    print(f"[curated] wrote {out_path} ({len(final)} tickers)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
