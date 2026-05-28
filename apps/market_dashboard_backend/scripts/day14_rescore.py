"""
day14_rescore.py
================
Phase 5 of pre-open CI + journal revamp plan.

Walks AListCandidate rows that are aged ~14 trading sessions (>= 14 NYSE
sessions since pickDate) and haven't had day-14 outcome computed yet. For
each, fetches 14 sessions of OHLC, computes MFE/MAE (in $ and R units),
classifies the outcome, and POSTs the result to /api/a-list/{id}/day14.

Runtime path:
  cron @ 16:30 ET (journal_close.yml) → scripts/day14_rescore.py
  → for each due AListCandidate:
      1. Resolve 14-trading-session window starting from pickDate + 1
      2. Fetch OHLC via yfinance (fallback to stooq)
      3. MFE = max(highs) - entry; MAE = entry - min(lows)
      4. R = entry - stop
      5. MFE_R = MFE / R; MAE_R = MAE / R
      6. Outcome bucket:
         HIT_TARGET   if max(highs) >= target
         STOPPED_OUT  elif min(lows) <= stop
         PARTIAL      elif MFE_R >= 1.0 (got at least 1R favourable)
         FADE         elif MAE_R >= 1.0 (got at least 1R adverse)
         DRIFT        else (neither side made any meaningful move)
      7. Day-14 score 0-10:
            HIT_TARGET = 10
            PARTIAL    = 4 + min(MFE_R, 5)  (max 9)
            DRIFT      = 5
            FADE       = max(0, 4 - MAE_R)
            STOPPED_OUT= 0
      8. POST to /api/a-list/<id>/day14 — endpoint updates row + flips status

Authentication: re-uses BRIEF_INGEST_KEY (the same secret used by
/api/morning-verdict/ingest and /api/a-list/ingest).

Usage:
  python scripts/day14_rescore.py
  python scripts/day14_rescore.py --dry-run                # don't POST
  python scripts/day14_rescore.py --pick-date 2026-05-14   # rescore only this date
"""
from __future__ import annotations

import argparse
import datetime
import json
import logging
import os
import sys
from typing import Any

import requests

try:
    import yfinance as yf
except ImportError:
    print("[day14] yfinance not installed; pip install yfinance", file=sys.stderr)
    sys.exit(1)

try:
    import pandas_market_calendars as mcal
except ImportError:
    mcal = None

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

DAY14_SESSION_COUNT = 14


def trading_sessions_ago(n: int, from_date: datetime.date | None = None) -> datetime.date:
    """Return the date that was n NYSE sessions before `from_date` (default: today)."""
    end = from_date or datetime.date.today()
    if mcal is None:
        # Fallback: subtract n weekdays
        d = end
        skipped = 0
        while skipped < n:
            d -= datetime.timedelta(days=1)
            if d.weekday() < 5:
                skipped += 1
        return d
    nyse = mcal.get_calendar("NYSE")
    start = end - datetime.timedelta(days=n * 3)  # buffer for weekends/holidays
    schedule = nyse.schedule(start_date=start, end_date=end)
    if len(schedule) < n:
        return start
    return schedule.index[-n].date()


def fetch_due_candidates(base_url: str, key: str) -> list[dict[str, Any]]:
    """
    Pull A-list candidates that are ~14 sessions old and have no day-14 yet.
    Uses the history endpoint with from/to bounded around the target session.
    """
    target = trading_sessions_ago(DAY14_SESSION_COUNT)
    # Pull a 3-day window in case of holidays around the target
    from_date = (target - datetime.timedelta(days=2)).isoformat()
    to_date = (target + datetime.timedelta(days=2)).isoformat()

    url = f"{base_url}/api/a-list/history?from={from_date}&to={to_date}&status=ACTIVE&limit=200"
    log.info("Fetching candidates aged ~%d sessions (window %s..%s)",
             DAY14_SESSION_COUNT, from_date, to_date)

    r = requests.get(url, headers={"Authorization": f"Bearer {key}"}, timeout=30)
    if r.status_code != 200:
        log.error("Failed to fetch due candidates: %d %s", r.status_code, r.text[:200])
        return []
    items = r.json().get("items", [])
    due = [it for it in items if it.get("day14") is None and it.get("status") == "ACTIVE"]
    log.info("Found %d candidates due for day-14 rescore", len(due))
    return due


def fetch_ohlc(ticker: str, start: datetime.date, end: datetime.date) -> list[dict[str, float]] | None:
    """Fetch daily OHLC bars for ticker between start and end (inclusive)."""
    try:
        df = yf.Ticker(ticker).history(
            start=start.isoformat(),
            end=(end + datetime.timedelta(days=1)).isoformat(),
            interval="1d",
            auto_adjust=False,
        )
    except Exception as e:
        log.warning("yfinance fetch failed for %s: %s", ticker, e)
        return None
    if df is None or df.empty:
        return None
    bars = []
    for ts, row in df.iterrows():
        bars.append({
            "date": ts.date().isoformat(),
            "open": float(row["Open"]),
            "high": float(row["High"]),
            "low": float(row["Low"]),
            "close": float(row["Close"]),
        })
    return bars


def compute_outcome(
    entry: float, stop: float, target: float,
    bars: list[dict[str, float]],
) -> dict[str, Any]:
    """Compute MFE/MAE/outcome from a list of OHLC bars."""
    if not bars:
        return {"outcome": "DRIFT", "mfe": 0.0, "mae": 0.0, "mfeR": 0.0, "maeR": 0.0, "score": 5.0}
    highs = [b["high"] for b in bars]
    lows = [b["low"] for b in bars]

    max_high = max(highs)
    min_low = min(lows)
    mfe = max_high - entry
    mae = entry - min_low
    R = max(0.01, entry - stop) if entry > stop else 0.01
    mfe_r = mfe / R
    mae_r = mae / R

    # Outcome bucket — first-touch logic: if both target and stop hit, the
    # earlier one wins (here approximated by checking max_high vs min_low day
    # ordering — simplified: if target reached, HIT_TARGET wins).
    if target and max_high >= target:
        outcome = "HIT_TARGET"
        score = 10.0
    elif min_low <= stop:
        outcome = "STOPPED_OUT"
        score = 0.0
    elif mfe_r >= 1.0:
        outcome = "PARTIAL"
        score = 4.0 + min(mfe_r, 5.0)
    elif mae_r >= 1.0:
        outcome = "FADE"
        score = max(0.0, 4.0 - mae_r)
    else:
        outcome = "DRIFT"
        score = 5.0

    return {
        "outcome": outcome,
        "mfe": round(mfe, 4),
        "mae": round(mae, 4),
        "mfeR": round(mfe_r, 2),
        "maeR": round(mae_r, 2),
        "score": round(score, 2),
    }


def push_day14(base_url: str, key: str, candidate_id: str, result: dict[str, Any]) -> bool:
    url = f"{base_url}/api/a-list/{candidate_id}/day14"
    r = requests.post(
        url,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json=result,
        timeout=15,
    )
    if r.status_code != 200:
        log.error("day14 POST %s failed: %d %s", candidate_id, r.status_code, r.text[:200])
        return False
    log.info("✓ %s day14 outcome=%s score=%.1f", candidate_id, result["outcome"], result["score"])
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="Don't POST results")
    ap.add_argument("--pick-date", help="Only rescore candidates with this pickDate (YYYY-MM-DD)")
    args = ap.parse_args()

    base_url = os.environ.get("VERCEL_INGEST_URL", "").rstrip("/")
    key = os.environ.get("BRIEF_INGEST_KEY", "")
    if not base_url or not key:
        log.error("VERCEL_INGEST_URL and BRIEF_INGEST_KEY required")
        return 2

    candidates = fetch_due_candidates(base_url, key)
    if args.pick_date:
        candidates = [c for c in candidates if c.get("pickDate") == args.pick_date]
    if not candidates:
        log.info("No candidates due for day-14 rescore.")
        return 0

    succeeded = 0
    failed = 0

    for c in candidates:
        ticker = c.get("ticker")
        entry = c.get("entry")
        stop = c.get("stop")
        target = c.get("target") or (entry * 1.15 if entry else None)  # fallback +15%
        pick_date = c.get("pickDate")

        if not ticker or entry is None or stop is None:
            log.warning("Skip %s (missing entry/stop)", ticker)
            failed += 1
            continue

        start = datetime.date.fromisoformat(pick_date) + datetime.timedelta(days=1)
        end = start + datetime.timedelta(days=DAY14_SESSION_COUNT + 7)  # buffer

        bars = fetch_ohlc(ticker, start, end)
        if not bars or len(bars) < 3:
            log.warning("Not enough OHLC bars for %s — skipping", ticker)
            failed += 1
            continue

        # Limit to first DAY14_SESSION_COUNT trading sessions
        bars = bars[:DAY14_SESSION_COUNT]

        result = compute_outcome(entry, stop, target or entry * 1.15, bars)

        if args.dry_run:
            log.info("[dry-run] %s %s → %s", pick_date, ticker, json.dumps(result))
            succeeded += 1
        else:
            ok = push_day14(base_url, key, c["id"], result)
            if ok:
                succeeded += 1
            else:
                failed += 1

    log.info("Day-14 rescore complete: succeeded=%d failed=%d", succeeded, failed)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
