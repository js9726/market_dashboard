"""
breadth_fast.py
===============
Lightweight market-breadth fetcher using TradingView's scanner aggregate-count
endpoint. Replaces the slow + fragile breadth_scan.py (which fetched ~5000
individual tickers and routinely timed out / rate-limited on yfinance).

Each metric is ONE scanner call returning `totalCount` — the number of stocks
matching a filter. ~20 calls total, ~20 seconds, no per-ticker failures, no
rate limits. The whole point: breadth that ACTUALLY updates, reliably.

Output schema matches BreadthSnapshot (apps/market_dashboard/src/types/breadth.ts):
  market:    new_highs, new_lows, advance, decline, stage_counts{1,2,3,4}, universe_size
  momentum:  up_from_open, down_from_open, up_on_volume, down_on_volume, up_4pct, down_4pct
  sectors:   [{sector, n, pct_above_50sma}]
  industries: (omitted in fast mode — sector granularity is enough for the gauge)

Usage:
  # Write breadth.json to data dir (same as breadth_scan.py)
  python scripts/breadth_fast.py --out-dir data

  # Push to dashboard DB via /api/breadth/ingest (no git commit needed)
  python scripts/breadth_fast.py --out-dir data \
      --post-to https://market-dashboard-ivory.vercel.app/api/breadth/ingest \
      --post-key "$BRIEF_INGEST_KEY"

  # Both (write file AND push) — the recommended cron/daemon invocation
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import sys
import time
import urllib.request

SCANNER_URL = "https://scanner.tradingview.com/america/scan"

# Market-cap floor: $100M (filters out micro-cap noise; matches "usable rows" intent)
MCAP_FLOOR = 100_000_000
_MCAP = {"left": "market_cap_basic", "operation": "greater", "right": MCAP_FLOOR}
_STOCK = {"left": "type", "operation": "in_range", "right": ["stock"]}

# TradingView sector values (the `sector` column). These map to the dashboard's
# sector momentum table.
TV_SECTORS = [
    "Electronic Technology", "Technology Services", "Finance", "Health Technology",
    "Consumer Non-Durables", "Consumer Services", "Retail Trade", "Energy Minerals",
    "Producer Manufacturing", "Commercial Services", "Transportation", "Utilities",
    "Process Industries", "Industrial Services", "Non-Energy Minerals",
    "Communications", "Distribution Services", "Consumer Durables",
    "Health Services", "Miscellaneous",
]


def _scan_count(filters: list[dict], retries: int = 3) -> int | None:
    """Return totalCount for a scanner filter set, or None on failure."""
    payload = {
        "filter": filters + [_STOCK],
        "options": {"lang": "en"},
        "range": [0, 1],
        "columns": ["name"],
        "markets": ["america"],
    }
    body = json.dumps(payload).encode()
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                SCANNER_URL, data=body,
                headers={"User-Agent": "Mozilla/5.0", "Content-Type": "application/json"},
            )
            resp = json.loads(urllib.request.urlopen(req, timeout=15).read().decode())
            return int(resp.get("totalCount", 0))
        except Exception as e:
            if attempt == retries - 1:
                print(f"[breadth_fast] scan failed after {retries} tries: {e}", file=sys.stderr)
                return None
            time.sleep(1.0 * (attempt + 1))
    return None


def _count(filters: list[dict], spacing: float = 0.2) -> int | None:
    time.sleep(spacing)
    return _scan_count(filters)


def fetch_breadth() -> dict:
    """Run all breadth queries and assemble the BreadthSnapshot dict."""
    GT = lambda l, r: {"left": l, "operation": "greater", "right": r}
    LT = lambda l, r: {"left": l, "operation": "less", "right": r}
    EGT = lambda l, r: {"left": l, "operation": "egreater", "right": r}
    ELT = lambda l, r: {"left": l, "operation": "eless", "right": r}

    # ── Universe size (all stocks above mcap floor) ─────────────────────────
    universe = _count([_MCAP]) or 0

    # ── Market breadth ──────────────────────────────────────────────────────
    advance = _count([GT("change", 0), _MCAP]) or 0
    decline = _count([LT("change", 0), _MCAP]) or 0
    new_highs = _count([EGT("close", "price_52_week_high"), _MCAP]) or 0
    new_lows = _count([ELT("close", "price_52_week_low"), _MCAP]) or 0

    # ── Stage analysis (Weinstein 4-stage proxy via SMA relationships) ──────
    # Stage 2 (advancing uptrend): close > SMA50 > SMA200
    stage2 = _count([GT("close", "SMA50"), GT("SMA50", "SMA200"), _MCAP]) or 0
    # Stage 4 (declining downtrend): close < SMA50 < SMA200
    stage4 = _count([LT("close", "SMA50"), LT("SMA50", "SMA200"), _MCAP]) or 0
    # Stage 1 (basing): close < SMA50 but SMA50 > SMA200 (pullback in longer uptrend)
    stage1 = _count([LT("close", "SMA50"), GT("SMA50", "SMA200"), _MCAP]) or 0
    # Stage 3 (topping/recovery): close > SMA50 but SMA50 < SMA200
    stage3 = _count([GT("close", "SMA50"), LT("SMA50", "SMA200"), _MCAP]) or 0

    # ── Momentum breadth ─────────────────────────────────────────────────────
    up_from_open = _count([GT("close", "open"), _MCAP]) or 0
    down_from_open = _count([LT("close", "open"), _MCAP]) or 0
    # Up/down on (above-average) volume
    up_on_volume = _count([GT("change", 0), GT("relative_volume_10d_calc", 1.0), _MCAP]) or 0
    down_on_volume = _count([LT("change", 0), GT("relative_volume_10d_calc", 1.0), _MCAP]) or 0
    up_4pct = _count([EGT("change", 4), _MCAP]) or 0
    down_4pct = _count([ELT("change", -4), _MCAP]) or 0

    # ── Sector breadth (% above 50SMA per sector) ───────────────────────────
    sectors = []
    for sec in TV_SECTORS:
        sec_filter = {"left": "sector", "operation": "in_range", "right": [sec]}
        n = _count([sec_filter, _MCAP])
        if not n:
            continue
        above = _count([sec_filter, GT("close", "SMA50"), _MCAP]) or 0
        pct = round(above / n * 100, 1) if n else 0.0
        sectors.append({"sector": sec, "n": n, "pct_above_50sma": pct})
    sectors.sort(key=lambda s: -s["pct_above_50sma"])

    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    return {
        "built_at": now,
        "as_of": now,
        "generated_by": "breadth_fast_tv_scanner",
        "mcap_floor": MCAP_FLOOR,
        "universe_size": universe,
        "market": {
            "new_highs": new_highs,
            "new_lows": new_lows,
            "advance": advance,
            "decline": decline,
            "stage_counts": {"1": stage1, "2": stage2, "3": stage3, "4": stage4},
            "universe_size": universe,
        },
        "momentum": {
            "up_from_open": up_from_open,
            "down_from_open": down_from_open,
            "up_on_volume": up_on_volume,
            "down_on_volume": down_on_volume,
            "up_4pct": up_4pct,
            "down_4pct": down_4pct,
        },
        "sectors": sectors,
        "industries": [],  # fast mode: sector granularity is sufficient for the gauge
    }


def _post(snapshot: dict, url: str, key: str) -> None:
    body = json.dumps(snapshot).encode()
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
    )
    try:
        resp = urllib.request.urlopen(req, timeout=20)
        print(f"[breadth_fast] pushed to dashboard: HTTP {resp.status}")
    except Exception as e:
        print(f"[breadth_fast] push failed: {e}", file=sys.stderr)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", default="data")
    ap.add_argument("--post-to", help="POST breadth JSON to this ingest URL")
    ap.add_argument("--post-key", help="Bearer key for the ingest URL")
    args = ap.parse_args()

    started = time.time()
    print("[breadth_fast] fetching breadth via TV scanner counts...")
    snapshot = fetch_breadth()
    elapsed = time.time() - started

    m = snapshot["market"]
    print(f"[breadth_fast] done in {elapsed:.1f}s | "
          f"adv={m['advance']} dec={m['decline']} "
          f"hi={m['new_highs']} lo={m['new_lows']} "
          f"universe={m['universe_size']} sectors={len(snapshot['sectors'])}")

    # Write file (backwards-compat with the static-file read path)
    os.makedirs(args.out_dir, exist_ok=True)
    out_path = os.path.join(args.out_dir, "breadth.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, indent=2)
    print(f"[breadth_fast] wrote {out_path}")

    # Push to DB (the reliable path — no git commit / Vercel rebuild needed)
    if args.post_to and args.post_key:
        _post(snapshot, args.post_to, args.post_key)

    # Sanity: advance+decline should be a large fraction of universe
    if m["advance"] + m["decline"] < m["universe_size"] * 0.5:
        print("[breadth_fast] WARNING: adv+dec < 50% of universe — TV may have rate-limited.",
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
