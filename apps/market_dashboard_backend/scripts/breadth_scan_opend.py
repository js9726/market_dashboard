"""
breadth_scan_opend.py — OpenD-driven market breadth scanner.

Drop-in replacement for breadth_scan.py when yfinance is rate-limited (which is
most of the time now). Uses the locally-running moomoo OpenD instance to fetch
daily OHLCV — no per-call rate limits, batched via the futu SDK.

Produces the same data/breadth.json + data/breadth_history.json files so the
existing dashboard surface keeps working with zero UI changes.

Architecture:
    Layer 1 (primary):  OpenD request_history_kline for daily OHLCV
    Layer 2 (sector):   data/_sector_cache.json (precomputed map ticker → sector/industry/mcap)
    Layer 3 (fallback): yfinance .info for any ticker missing from the cache
                        (rate-limited, but only triggered for new tickers)

Setup:
  1. moomoo OpenD running locally (check `python scripts/fetch_opend_live.py`)
  2. (optional) build data/_sector_cache.json once via `--build-sector-cache`
     — fetches sector/industry from yfinance for every ticker in the universe.
     Re-run weekly.

Usage:
    # Daily scan (uses cached sector map if present)
    python scripts/breadth_scan_opend.py --out-dir data

    # Limit universe to N tickers (smoke test)
    python scripts/breadth_scan_opend.py --out-dir data --limit 200

    # Rebuild sector cache (slow, yfinance .info per ticker)
    python scripts/breadth_scan_opend.py --build-sector-cache --out-dir data

Performance:
  - OpenD request_history_kline: ~3-5 calls/sec sustained (per moomoo rate limits).
  - 1500 mcap>$2B tickers ≈ 5-8 min total. Full 6800-ticker universe ≈ 25-30 min.
  - Recommendation: cache the full universe weekly, scan mcap>$2B subset daily.

Required env (optional, only for --build-sector-cache):
    None beyond OpenD being reachable on 127.0.0.1:11111.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

# Reuse breadth_scan.py's aggregate / history / stage logic so the output format
# stays identical to the yfinance path.
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from breadth_scan import (  # noqa: E402
    _classify_stage,
    aggregate,
    fetch_universe,
    _cache_universe,
    _load_cached_universe,
    update_history,
)
from build_data import sanitize_json, safe_json_dumps  # noqa: E402


def opend_imports():
    """Lazy import — keep moomoo SDK optional so the file can be parsed in CI."""
    try:
        from moomoo import OpenQuoteContext, KLType, AuType, RET_OK  # type: ignore
        return OpenQuoteContext, KLType, AuType, RET_OK
    except ImportError as e:
        print(f"error: moomoo SDK not installed ({e}). pip install moomoo-api", file=sys.stderr)
        sys.exit(2)


def _moomoo_code(ticker: str) -> str:
    """Convert plain ticker (NVDA) to moomoo's market-prefixed code (US.NVDA).

    moomoo accepts US.<TICKER> for both NYSE and Nasdaq — OpenD figures out the
    exchange. Tickers already containing a dot (BRK.B → US.BRK.B) are preserved.
    """
    if "." in ticker and not ticker.startswith("US."):
        # Class shares — strip the suffix, prefix US., re-add
        return f"US.{ticker}"
    return ticker if ticker.startswith("US.") else f"US.{ticker}"


def fetch_history_opend(
    ctx, ticker: str, days: int, KLType, AuType, RET_OK
):
    """Fetch daily OHLCV from OpenD. Returns (last, open, close_series, vol_series) or None.

    Returns a tuple of primitives rather than a DataFrame so we don't pay the
    pandas allocation cost across thousands of tickers.
    """
    import pandas as pd
    code = _moomoo_code(ticker)
    end = datetime.now()
    start = end - timedelta(days=days + 20)  # buffer for non-trading days
    try:
        ret, df, _ = ctx.request_history_kline(
            code,
            start=start.strftime("%Y-%m-%d"),
            end=end.strftime("%Y-%m-%d"),
            ktype=KLType.K_DAY,
            autype=AuType.QFQ,
            max_count=1000,
        )
    except Exception as e:
        return None, f"opend exception: {e}"
    if ret != RET_OK:
        return None, f"opend ret={ret}: {df}"
    if df is None or df.empty:
        return None, "empty result"
    df = df.rename(columns={
        "time_key": "Date",
        "open": "Open",
        "close": "Close",
        "high": "High",
        "low": "Low",
        "volume": "Volume",
    })
    df["Date"] = pd.to_datetime(df["Date"]).dt.tz_localize(None)
    df = df.set_index("Date").sort_index()
    df = df[["Open", "High", "Low", "Close", "Volume"]].dropna()
    if len(df) < 60:
        return None, f"only {len(df)} bars"
    return df, None


def compute_metrics(df, ticker: str, sector_info: dict | None) -> dict:
    """Compute breadth metrics from a DataFrame of daily OHLCV. Matches the
    schema breadth_scan.py.fetch_metrics_for produces.
    """
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
    sma30wk = None
    sma30wk_5d = None
    if len(close) >= 150:
        sma30wk = float(close.iloc[-150:].mean())
        sma30wk_5d = float(close.iloc[-155:-5].mean())
    slope = None
    if sma30wk and sma30wk_5d:
        slope = (sma30wk - sma30wk_5d) / sma30wk_5d
    stage = _classify_stage(last, sma30wk or float("nan"), slope or 0.0)

    sector = sector_info.get("sector") if sector_info else None
    industry = sector_info.get("industry") if sector_info else None
    mcap = sector_info.get("market_cap") if sector_info else None

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
        "market_cap": mcap,
        "sector": sector,
        "industry": industry,
    }


def load_sector_cache(out_dir: str) -> dict[str, dict]:
    """Read data/_sector_cache.json — map of ticker → {sector, industry, market_cap, updated_at}."""
    path = os.path.join(out_dir, "_sector_cache.json")
    if not os.path.exists(path):
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_sector_cache(out_dir: str, cache: dict[str, dict]) -> None:
    path = os.path.join(out_dir, "_sector_cache.json")
    os.makedirs(out_dir, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2, sort_keys=True)


def build_sector_cache(tickers: list[str], out_dir: str, limit: int | None = None) -> None:
    """One-time slow path: fetch sector/industry/marketCap from yfinance .info
    for every ticker, persist to data/_sector_cache.json. Re-run weekly.

    yfinance .info IS rate-limited but only triggered here, not in the main scan.
    Tolerates failures — missing tickers just stay out of the sector/industry
    panels until the next refresh.
    """
    try:
        import yfinance as yf
    except ImportError:
        sys.exit("yfinance required for --build-sector-cache. pip install yfinance")
    cache = load_sector_cache(out_dir)
    n = len(tickers)
    if limit:
        n = min(n, limit)
        tickers = tickers[:limit]
    print(f"[sector-cache] building for {n} tickers (existing cache: {len(cache)})")
    new_count = 0
    skip_count = 0
    fail_count = 0
    today = datetime.now().date().isoformat()
    for i, t in enumerate(tickers, 1):
        existing = cache.get(t)
        if existing and existing.get("updated_at", "") >= today and existing.get("sector"):
            skip_count += 1
            continue
        try:
            info = yf.Ticker(t).info or {}
            sector = info.get("sector")
            industry = info.get("industry")
            mcap = info.get("marketCap")
            if not sector:
                fail_count += 1
                continue
            cache[t] = {
                "sector": sector,
                "industry": industry,
                "market_cap": mcap,
                "updated_at": today,
            }
            new_count += 1
        except Exception:
            fail_count += 1
        if i % 100 == 0:
            print(f"  {i}/{n} done, new={new_count} skip={skip_count} fail={fail_count}")
            # Throttle to avoid yfinance rate limits
            time.sleep(2)
        if i % 500 == 0:
            # Periodic save so a crash doesn't lose progress
            save_sector_cache(out_dir, cache)
    save_sector_cache(out_dir, cache)
    print(f"[sector-cache] done. new={new_count} skip={skip_count} fail={fail_count} total={len(cache)}")


def scan_via_opend(
    tickers: list[str],
    sector_cache: dict[str, dict],
    rate_per_sec: float = 1.9,
) -> list[dict]:
    """Iterate tickers, fetch OHLCV from OpenD, compute metrics.

    OpenD's history-kline rate limit is **60 requests per 30 seconds** =
    2 req/sec sustained. We default to 1.9/sec for safety + back off 30s on
    any "high frequency" error before retrying the same ticker.

    Single OpenQuoteContext shared across the run.
    """
    OpenQuoteContext, KLType, AuType, RET_OK = opend_imports()
    ctx = OpenQuoteContext(host="127.0.0.1", port=11111)
    out: list[dict] = []
    failed: dict[str, int] = {}
    started = time.time()
    interval = 1.0 / max(rate_per_sec, 0.5)
    quota_hits = 0  # consecutive "insufficient quota" errors → bail out fast
    QUOTA_BAILOUT = 10  # after 10 in a row, give up; the user's daily quota is exhausted
    try:
        i = 0
        while i < len(tickers):
            t = tickers[i]
            df, err = fetch_history_opend(ctx, t, days=365, KLType=KLType, AuType=AuType, RET_OK=RET_OK)
            if df is None and err and "high frequency" in err.lower():
                print(f"[opend-breadth] rate-limited at #{i+1} ({t}). Sleeping 35s and retrying…")
                time.sleep(35)
                continue
            if df is None and err and "Insufficient historical candlestick quota" in err:
                quota_hits += 1
                failed[err] = failed.get(err, 0) + 1
                if quota_hits >= QUOTA_BAILOUT:
                    print(
                        f"\n[opend-breadth] OpenD daily quota exhausted "
                        f"({quota_hits} consecutive 'Insufficient quota' errors at #{i+1}/{len(tickers)}). "
                        f"Bailing out — quota replenishes on a rolling 24h basis.\n"
                        f"  - Returning {len(out)} successful metrics from this run.\n"
                        f"  - Tip: shrink data/_curated_universe.json to fit a single day's quota,\n"
                        f"    or run scripts/build_curated_universe.py with --max-size lower."
                    )
                    break
                i += 1
                time.sleep(interval)
                continue
            else:
                quota_hits = 0  # reset on any non-quota response

            i += 1
            if df is None:
                failed[err or "unknown"] = failed.get(err or "unknown", 0) + 1
                time.sleep(interval)
                continue
            try:
                m = compute_metrics(df, t, sector_cache.get(t))
                out.append(m)
            except Exception as e:
                failed[f"metrics: {e}"] = failed.get(f"metrics: {e}", 0) + 1
            time.sleep(interval)
            if i % 50 == 0:
                elapsed = time.time() - started
                rate = i / elapsed if elapsed > 0 else 0
                eta = (len(tickers) - i) / rate if rate > 0 else 0
                print(f"[opend-breadth] {i}/{len(tickers)} done, {rate:.1f}/s, ETA {eta:.0f}s, ok={len(out)} fail={sum(failed.values())}")
    finally:
        ctx.close()
    if failed:
        print("[opend-breadth] failure summary:")
        for reason, count in sorted(failed.items(), key=lambda x: -x[1])[:10]:
            print(f"  {count:>5}× {reason[:100]}")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out-dir", default="data", help="Output directory for breadth.json")
    ap.add_argument("--limit", type=int, default=None, help="Cap universe size (smoke test)")
    ap.add_argument("--rate", type=float, default=1.9,
                    help="OpenD request rate per second (default 1.9 — OpenD caps at 60 req/30s)")
    ap.add_argument("--build-sector-cache", action="store_true",
                    help="Build/refresh data/_sector_cache.json via yfinance (slow, once a week)")
    ap.add_argument("--mcap-floor", type=float, default=2_000_000_000,
                    help="Sector/industry panels filter to mcap >= this (default $2B)")
    ap.add_argument("--no-junk-filter", action="store_true",
                    help="Don't filter warrants/units/rights from the universe (default: filter)")
    ap.add_argument("--full-universe", action="store_true",
                    help="Ignore data/_curated_universe.json; scan the full 6800-ticker NASDAQ+NYSE composite")
    args = ap.parse_args()

    out_dir = args.out_dir
    os.makedirs(out_dir, exist_ok=True)

    # 1. Universe — prefer the curated list (built by build_curated_universe.py)
    #    if present, since OpenD's free-tier history-kline quota is ~100/day.
    curated_path = os.path.join(out_dir, "_curated_universe.json")
    if os.path.exists(curated_path) and not args.full_universe:
        try:
            with open(curated_path, encoding="utf-8") as f:
                cache = json.load(f)
            universe = cache.get("tickers", [])
            print(f"[opend-breadth] using curated universe: {len(universe)} tickers "
                  f"(rebuild via build_curated_universe.py)")
        except Exception as e:
            print(f"[opend-breadth] curated universe read failed ({e}); falling back to NYSE/Nasdaq composite")
            universe = None
    else:
        universe = None

    if not universe:
        universe = _load_cached_universe(out_dir)
        if universe is None:
            print("[opend-breadth] no cached universe; fetching fresh (~20s)")
            universe = fetch_universe()
            _cache_universe(universe, out_dir)
    raw_count = len(universe)

    # Filter junk: warrants (W), units (U), rights (R), preferred (P) — these end
    # with the suffix appended to a parent ticker and OpenD typically has no
    # historical data for them. Heuristic: if ticker is 4+ chars AND ends in
    # W/U/R AND the previous char is also a letter, treat as junk.
    if not args.no_junk_filter:
        junk_suffixes = ("W", "WS", "U", "UN", "R", "RT")
        filtered = []
        for t in universe:
            if len(t) >= 5 and any(t.endswith(s) for s in junk_suffixes):
                continue
            filtered.append(t)
        print(f"[opend-breadth] junk-filtered {raw_count} -> {len(filtered)} (-{raw_count-len(filtered)} warrants/units/rights)")
        universe = filtered

    if args.limit:
        universe = universe[: args.limit]
    print(f"[opend-breadth] universe size: {len(universe)}")

    # 2. Sector cache (optional)
    if args.build_sector_cache:
        build_sector_cache(universe, out_dir, limit=args.limit)
        return 0

    sector_cache = load_sector_cache(out_dir)
    cached_pct = round(100 * len(sector_cache) / max(len(universe), 1), 1)
    print(f"[opend-breadth] sector cache: {len(sector_cache)} entries ({cached_pct}% of universe)")
    if cached_pct < 50:
        print(
            "[opend-breadth] WARNING: sector cache is sparse. Sector/industry panels "
            "will be empty until you run `--build-sector-cache` once."
        )

    # 3. Scan via OpenD
    metrics = scan_via_opend(universe, sector_cache, rate_per_sec=args.rate)
    if not metrics:
        print("[opend-breadth] no metrics produced — aborting.", file=sys.stderr)
        return 1

    # 4. Aggregate (reusing breadth_scan.py logic verbatim)
    snapshot = {
        "as_of": datetime.now().isoformat() + "Z",
        "generated_by": "breadth_scan_opend",
        "universe_size": len(metrics),
        **aggregate(metrics, mcap_floor=args.mcap_floor),
    }

    # 5. History (rolling 30d for WoW/MoM deltas). update_history already
    # appends today's snapshot, persists the rolling file, and returns the
    # deltas-annotated snapshot — don't double-call _compute_deltas.
    snapshot = update_history(out_dir, snapshot) or snapshot

    out_path = os.path.join(out_dir, "breadth.json")
    safe = sanitize_json(snapshot)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(safe_json_dumps(safe))
    print(f"[opend-breadth] wrote {out_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
