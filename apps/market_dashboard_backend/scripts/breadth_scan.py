"""
Market breadth scanner — NYSE + Nasdaq composite, daily.

Scans the full US listed universe (~5000 tickers), computes:

  Market breadth:
    - new 52-week highs vs new 52-week lows (count)
    - advance vs decline (today change > 0 vs < 0)
    - Stage 1 / 2 / 3 / 4 (Weinstein) counts

  Momentum breadth:
    - up from open vs down from open
    - up on volume vs down on volume (vol > 30-day avg AND day green/red)
    - up 4% vs down 4%

  Sector momentum (mcap > $2B filter):
    - For each sector ETF (XLK, SMH, etc.) compute % of constituent stocks
      above their 50-SMA, today vs 1W ago vs 1M ago.

  Industry rotation:
    - For each GICS industry, same %-above-50-SMA metric, sorted by Δ WoW.

Inputs: yfinance for OHLCV (~30 weeks of daily bars per ticker), Finviz or
yfinance .info for sector/industry/market_cap classification.

Outputs:
  data/breadth.json          — today's full snapshot
  data/breadth_history.json  — rolling 30-day archive of daily snapshots
                               (lets the frontend / future runs compute Δ WoW
                                and Δ MoM without re-scanning)

Run from repo root:
  python apps/market_dashboard_backend/scripts/breadth_scan.py [--out-dir data]

Cadence: once daily as part of refresh_data.yml at 13:00 UTC.

Performance notes:
  - yfinance batch download in chunks of 500 with 0.5s sleep between chunks.
  - Tickers list is cached at data/_universe_us.json (refresh weekly).
  - Total runtime: ~3–6 min on GH Actions runners.
"""
from __future__ import print_function
import argparse
import datetime
import json
import math
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Iterable

import requests

try:
    import yfinance as yf
    import pandas as pd
    import numpy as np
except ImportError as e:
    print(f"Missing dep: {e}. pip install yfinance pandas numpy")
    sys.exit(1)

# Shared JSON safety helpers — keep bare NaN out of browser-facing files.
from build_data import sanitize_json, safe_json_dumps  # noqa: E402


# --------------------------------------------------------------------------
# .env loader (mirrors morning_brief.py / build_data.py pattern)
# --------------------------------------------------------------------------

def _load_env():
    here = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.normpath(os.path.join(here, "..", "..", ".."))
    env_path = os.path.join(repo_root, ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key, value = key.strip(), value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value

_load_env()


# --------------------------------------------------------------------------
# Universe — NYSE + Nasdaq listed
# --------------------------------------------------------------------------

NASDAQ_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt"
OTHER_LISTED_URL  = "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt"


def fetch_universe() -> list:
    """Return the NYSE + Nasdaq composite ticker list (no ETFs, no ETNs, no warrants)."""
    tickers = set()
    for url in (NASDAQ_LISTED_URL, OTHER_LISTED_URL):
        try:
            r = requests.get(url, timeout=30)
            r.raise_for_status()
            lines = r.text.splitlines()
            if not lines:
                continue
            # Pipe-delimited, first line is header, last line is "File Creation Time"
            header = lines[0].split("|")
            sym_idx = header.index("Symbol") if "Symbol" in header else 0
            etf_idx = header.index("ETF") if "ETF" in header else None
            test_idx = header.index("Test Issue") if "Test Issue" in header else None
            for line in lines[1:]:
                if line.startswith("File Creation"):
                    break
                parts = line.split("|")
                if len(parts) <= sym_idx:
                    continue
                sym = parts[sym_idx].strip()
                if not sym or "$" in sym or "." in sym:
                    continue  # skip warrants, units, dual classes (.A/.B)
                if etf_idx is not None and len(parts) > etf_idx and parts[etf_idx] == "Y":
                    continue
                if test_idx is not None and len(parts) > test_idx and parts[test_idx] == "Y":
                    continue
                tickers.add(sym)
        except Exception as e:
            print(f"[universe] {url}: {e}")
    return sorted(tickers)


def _cache_universe(tickers: list, out_dir: str):
    cache_path = os.path.join(out_dir, "_universe_us.json")
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump({"fetched_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                   "count": len(tickers), "tickers": tickers}, f)


def _load_cached_universe(out_dir: str, max_age_days: int = 7) -> list | None:
    cache_path = os.path.join(out_dir, "_universe_us.json")
    if not os.path.exists(cache_path):
        return None
    try:
        with open(cache_path, encoding="utf-8") as f:
            cache = json.load(f)
        fetched = datetime.datetime.fromisoformat(cache["fetched_at"])
        if (datetime.datetime.now(datetime.timezone.utc) - fetched).days > max_age_days:
            return None
        return cache["tickers"]
    except Exception:
        return None


# --------------------------------------------------------------------------
# Sector ETF mapping
# --------------------------------------------------------------------------

SECTOR_ETFS = {
    "XLK":  "Technology",
    "SMH":  "Semiconductors",
    "XLC":  "Communication Services",
    "XLY":  "Consumer Discretionary",
    "XLF":  "Financials",
    "XLV":  "Healthcare",
    "XLI":  "Industrials",
    "XLE":  "Energy",
    "XLP":  "Consumer Staples",
    "XLU":  "Utilities",
    "XLB":  "Materials",
    "XLRE": "Real Estate",
}


# --------------------------------------------------------------------------
# Per-ticker computation
# --------------------------------------------------------------------------

def _classify_stage(close_today: float, sma30wk: float, sma30wk_slope: float) -> int:
    """
    Stan Weinstein 4-stage classification.
      Stage 1 (basing):       price ~ flat MA, no trend
      Stage 2 (markup):       price > rising MA
      Stage 3 (distribution): price ~ flat MA after Stage 2
      Stage 4 (decline):      price < falling MA
    Slope threshold: 0.5% / week.
    """
    if any(map(lambda x: x is None or (isinstance(x, float) and math.isnan(x)),
               [close_today, sma30wk, sma30wk_slope])):
        return 0  # unknown
    rising = sma30wk_slope > 0.005
    falling = sma30wk_slope < -0.005
    above = close_today > sma30wk * 1.01
    below = close_today < sma30wk * 0.99
    if above and rising: return 2
    if below and falling: return 4
    if above and not falling: return 3
    if below and not rising: return 1
    return 1 if not rising else 2


def fetch_metrics_for(ticker: str) -> dict | None:
    """Fetch OHLCV + metadata for a single ticker. Returns metric dict or None."""
    try:
        t = yf.Ticker(ticker)
        # 1y daily — enough for 52w high/low + 30wk MA + 21-day comparison
        df = t.history(period="1y", interval="1d", auto_adjust=False)
        if df is None or len(df) < 60:
            return None
        close = df["Close"]
        opens = df["Open"]
        vol = df["Volume"]
        last = float(close.iloc[-1])
        first = float(close.iloc[-2]) if len(close) >= 2 else last
        change_pct = ((last / first) - 1) * 100 if first else 0.0
        today_open = float(opens.iloc[-1])
        change_open_pct = ((last / today_open) - 1) * 100 if today_open else 0.0
        avg_vol_30 = float(vol.iloc[-30:].mean()) if len(vol) >= 30 else float(vol.mean())
        today_vol = float(vol.iloc[-1])
        high_52w = float(close.iloc[-252:].max()) if len(close) >= 252 else float(close.max())
        low_52w = float(close.iloc[-252:].min()) if len(close) >= 252 else float(close.min())
        sma50 = float(close.iloc[-50:].mean()) if len(close) >= 50 else None
        # 30-week MA = ~150 daily bars. Slope = (sma_today - sma_5d_ago) / sma_5d_ago.
        sma30wk = None
        sma30wk_5d = None
        if len(close) >= 150:
            sma30wk = float(close.iloc[-150:].mean())
            sma30wk_5d = float(close.iloc[-155:-5].mean())
        slope = None
        if sma30wk and sma30wk_5d:
            slope = (sma30wk - sma30wk_5d) / sma30wk_5d
        stage = _classify_stage(last, sma30wk or float("nan"), slope or 0.0)

        # Sector / industry / market cap from .info (slower, but we need it)
        info = {}
        try:
            info = t.info or {}
        except Exception:
            info = {}

        return {
            "ticker": ticker,
            "price": last,
            "change_pct": change_pct,
            "change_open_pct": change_open_pct,
            "today_vol": today_vol,
            "avg_vol_30": avg_vol_30,
            "is_new_high": last >= high_52w * 0.999,
            "is_new_low": last <= low_52w * 1.001,
            "sma50": sma50,
            "above_sma50": (sma50 is not None and last > sma50),
            "stage": stage,
            "market_cap": info.get("marketCap"),
            "sector": info.get("sector"),
            "industry": info.get("industry"),
        }
    except Exception:
        return None


def fetch_all_metrics(tickers: list, max_workers: int = 16, sleep_between: float = 0.0) -> list:
    """Concurrent fetch with a thread pool. Returns list of metric dicts (None filtered)."""
    out = []
    n = len(tickers)
    print(f"[breadth] fetching metrics for {n} tickers (workers={max_workers})…")
    started = time.time()
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futures = {ex.submit(fetch_metrics_for, t): t for t in tickers}
        done_count = 0
        for fut in as_completed(futures):
            m = fut.result()
            done_count += 1
            if m is not None:
                out.append(m)
            if done_count % 250 == 0:
                elapsed = time.time() - started
                rate = done_count / max(elapsed, 1)
                print(f"[breadth] {done_count}/{n} done, {rate:.1f}/s, "
                      f"ETA {(n - done_count) / max(rate, 0.1):.0f}s")
    print(f"[breadth] fetched {len(out)}/{n} (took {time.time() - started:.0f}s)")
    return out


# --------------------------------------------------------------------------
# Aggregation
# --------------------------------------------------------------------------

def aggregate(metrics: list, mcap_floor: float = 2_000_000_000) -> dict:
    big = [m for m in metrics if (m.get("market_cap") or 0) >= mcap_floor]

    def count(rows, pred):
        return sum(1 for r in rows if pred(r))

    market = {
        "new_highs":  count(metrics, lambda r: r["is_new_high"]),
        "new_lows":   count(metrics, lambda r: r["is_new_low"]),
        "advance":    count(metrics, lambda r: r["change_pct"] > 0),
        "decline":    count(metrics, lambda r: r["change_pct"] < 0),
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

    # Per-sector: % above 50-SMA, mcap > $2B
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

    # Per-industry: same metric
    by_industry: dict[str, list] = {}
    for r in big:
        ind = r.get("industry")
        if not ind:
            continue
        by_industry.setdefault(ind, []).append(r)
    industries = []
    for ind, rows in sorted(by_industry.items()):
        n = len(rows)
        if n < 5:  # skip industries with <5 mcap-2B+ stocks (noisy)
            continue
        pct_above = round(100.0 * sum(1 for r in rows if r["above_sma50"]) / n, 1)
        industries.append({"industry": ind, "n": n, "pct_above_50sma": pct_above})

    return {"market": market, "momentum": momentum, "sectors": sectors, "industries": industries}


# --------------------------------------------------------------------------
# History — keep rolling 30-day archive for WoW / MoM deltas
# --------------------------------------------------------------------------

def update_history(out_dir: str, today_snapshot: dict) -> dict:
    history_path = os.path.join(out_dir, "breadth_history.json")
    history = []
    if os.path.exists(history_path):
        try:
            with open(history_path, encoding="utf-8") as f:
                history = json.load(f)
        except Exception:
            history = []

    # Strip today's full per-row data — we only need the aggregates per date
    history.append({
        "date": datetime.date.today().isoformat(),
        "market": today_snapshot["market"],
        "momentum": today_snapshot["momentum"],
        "sectors": today_snapshot["sectors"],
        "industries": today_snapshot["industries"],
    })
    # Keep last 35 days (covers MoM with margin)
    history = history[-35:]

    with open(history_path, "w", encoding="utf-8") as f:
        json.dump(history, f, indent=2)

    return _compute_deltas(history, today_snapshot)


def _compute_deltas(history: list, today: dict) -> dict:
    """Annotate today's sectors + industries with WoW (5d) and MoM (21d) deltas."""
    if len(history) < 2:
        return today
    by_date = {h["date"]: h for h in history}
    sorted_dates = sorted(by_date.keys())

    def lookup(days_ago: int):
        if len(sorted_dates) <= days_ago:
            return None
        return by_date[sorted_dates[-1 - days_ago]]

    wow_snap = lookup(5)   # 5 trading days ≈ 1 calendar week
    mom_snap = lookup(21)  # 21 trading days ≈ 1 month

    def delta(now_rows, past_snap, key, sub_key):
        if not past_snap:
            return None
        past_by_key = {r[key]: r["pct_above_50sma"] for r in past_snap.get(sub_key, [])}
        return {r[key]: round(r["pct_above_50sma"] - past_by_key[r[key]], 1)
                for r in now_rows if r[key] in past_by_key}

    sec_wow = delta(today["sectors"], wow_snap, "sector", "sectors") or {}
    sec_mom = delta(today["sectors"], mom_snap, "sector", "sectors") or {}
    ind_wow = delta(today["industries"], wow_snap, "industry", "industries") or {}
    ind_mom = delta(today["industries"], mom_snap, "industry", "industries") or {}

    for r in today["sectors"]:
        r["delta_wow"] = sec_wow.get(r["sector"])
        r["delta_mom"] = sec_mom.get(r["sector"])
    for r in today["industries"]:
        r["delta_wow"] = ind_wow.get(r["industry"])
        r["delta_mom"] = ind_mom.get(r["industry"])

    return today


# --------------------------------------------------------------------------

def _compute_drop_stats(fetched: int, attempted: int) -> dict:
    """Return drop-rate counters for logging + threshold checks."""
    dropped = max(0, attempted - fetched)
    drop_rate = (dropped / attempted) if attempted else 0.0
    return {
        "attempted": attempted,
        "fetched": fetched,
        "dropped": dropped,
        "drop_rate": round(drop_rate, 4),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", default="data")
    parser.add_argument("--max-workers", type=int, default=16)
    parser.add_argument("--limit", type=int, default=None,
                        help="Cap universe to N tickers (for fast smoke test)")
    parser.add_argument("--mcap-floor", type=float, default=2_000_000_000.0)
    parser.add_argument(
        "--drop-rate-warn",
        type=float,
        default=0.10,
        help="Print a loud WARNING when the per-ticker drop rate exceeds this fraction. "
             "Default 0.10 (10%%). The aggregate is still written.",
    )
    parser.add_argument(
        "--drop-rate-fail",
        type=float,
        default=0.50,
        help="Exit non-zero when the drop rate exceeds this fraction. "
             "Default 0.50 (50%%) — catastrophic-only, so a flaky day still ships partial data.",
    )
    args = parser.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)

    universe = _load_cached_universe(args.out_dir) or fetch_universe()
    if not universe:
        print("[breadth] universe fetch failed", file=sys.stderr)
        sys.exit(1)
    _cache_universe(universe, args.out_dir)

    if args.limit:
        universe = universe[: args.limit]

    metrics = fetch_all_metrics(universe, max_workers=args.max_workers)

    drop = _compute_drop_stats(fetched=len(metrics), attempted=len(universe))
    pct = drop["drop_rate"] * 100
    print(
        f"[breadth] coverage: fetched={drop['fetched']}/{drop['attempted']} "
        f"({100 - pct:.1f}% success, {drop['dropped']} dropped, drop_rate={pct:.2f}%)"
    )
    if drop["drop_rate"] > args.drop_rate_warn:
        print(
            f"[breadth] WARNING: drop rate {pct:.2f}% exceeds threshold "
            f"{args.drop_rate_warn * 100:.0f}% — breadth counts may understate the universe.",
            file=sys.stderr,
        )

    today = aggregate(metrics, mcap_floor=args.mcap_floor)
    today["built_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    today["mcap_floor"] = args.mcap_floor
    today["coverage"] = drop

    today = update_history(args.out_dir, today)

    out_path = os.path.join(args.out_dir, "breadth.json")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(safe_json_dumps(sanitize_json(today), indent=2, default=str))
    print(f"[breadth] wrote {out_path}")
    print(f"[breadth] highs={today['market']['new_highs']} "
          f"lows={today['market']['new_lows']} "
          f"adv={today['market']['advance']} dec={today['market']['decline']}")

    if drop["drop_rate"] > args.drop_rate_fail:
        print(
            f"[breadth] FATAL: drop rate {pct:.2f}% exceeds fail-threshold "
            f"{args.drop_rate_fail * 100:.0f}% — the data is too thin to trust.",
            file=sys.stderr,
        )
        sys.exit(2)


if __name__ == "__main__":
    main()
