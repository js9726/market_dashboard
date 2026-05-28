"""
check_trading_day.py
=====================
Tiny utility used by GH Actions workflows to skip non-trading days
(weekends + US market holidays).

Exits 0 if today is a NYSE trading day, exits 1 otherwise. Used as a
preflight gate in refresh_premarket.yml and journal_close.yml so cron-driven
jobs don't burn LLM tokens on Memorial Day, July 4, Thanksgiving, Christmas
half-days, etc.

Usage in a workflow step:

  - name: Skip if not a trading day
    run: python scripts/check_trading_day.py
    # If this exits 1, all subsequent steps are auto-skipped because the
    # workflow uses `if: success()` on every step.

Or with --date override for testing:

  python scripts/check_trading_day.py --date 2026-07-04   # exits 1 (July 4)
  python scripts/check_trading_day.py --date 2026-07-07   # exits 0 (Tuesday)
"""
from __future__ import annotations
import argparse
import datetime
import sys


def is_trading_day(date: datetime.date) -> bool:
    """Returns True if `date` is a NYSE trading day."""
    try:
        import pandas_market_calendars as mcal
    except ImportError:
        print("[check_trading_day] pandas_market_calendars not installed; "
              "falling back to weekday-only check", file=sys.stderr)
        # Fallback: just check Mon-Fri (misses US holidays).
        return date.weekday() < 5

    nyse = mcal.get_calendar("NYSE")
    schedule = nyse.schedule(start_date=date, end_date=date)
    return not schedule.empty


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="YYYY-MM-DD (default: today UTC)")
    args = ap.parse_args()

    if args.date:
        target = datetime.date.fromisoformat(args.date)
    else:
        target = datetime.datetime.utcnow().date()

    if is_trading_day(target):
        print(f"[check_trading_day] {target.isoformat()}: TRADING DAY")
        return 0
    else:
        print(f"[check_trading_day] {target.isoformat()}: NOT a trading day (weekend / holiday)")
        return 1


if __name__ == "__main__":
    sys.exit(main())
