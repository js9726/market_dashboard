#!/usr/bin/env python3
"""Live US quotes from moomoo OpenD for the private bot (read-only snapshot, prints only).

    python packages/bot-box/tools/quotes.py --tickers NVDA,AMD

For each ticker: name, last price, change % against the previous close, open/high/low,
volume, moomoo's volume ratio (today's volume per minute against the 5-day average per
minute, so already normalised for time of day), the exchange time of the last update and
its age in seconds, and pre-market / after-hours price and change when OpenD has them.

- One JSON object on stdout; nothing is written. Quote-only: no trade context is opened.
- A symbol OpenD does not know fails its whole batch, so the batch is retried one ticker
  at a time and unknown symbols get status UNKNOWN_TICKER instead of voiding the rest.
- Status STALE when the US regular session is open and the last update is over 10
  minutes old; INVALID_DATA when the price is missing or not positive. The run as a whole
  fails closed through opend_common (gateway down, not logged in, timeout: exit 3).
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import sys
from zoneinfo import ZoneInfo

import opend_common as oc

NEW_YORK = ZoneInfo("America/New_York")
REGULAR_SESSION_STATES = {"MORNING", "AFTERNOON"}
STALE_SECONDS = 600


def age_seconds(update_time, now=None):
    """Seconds since an OpenD update_time (US exchange local time), or None."""
    try:
        stamp = datetime.strptime(str(update_time)[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=NEW_YORK)
    except ValueError:
        return None
    return round(((now or datetime.now(timezone.utc)) - stamp).total_seconds())


def extended(row, prefix):
    price, change = oc.number(row.get(prefix + "_price")), oc.number(row.get(prefix + "_change_rate"))
    return {"price": price, "change_pct": change} if price else None


def quote_row(ticker, row, market_state):
    price, previous = oc.number(row.get("last_price")), oc.number(row.get("prev_close_price"))
    age = age_seconds(row.get("update_time"))
    out = {"ticker": ticker, "name": str(row.get("name", "")), "price": price,
           "change_pct": round((price / previous - 1) * 100, 2) if price and previous else None,
           "open": oc.number(row.get("open_price")), "high": oc.number(row.get("high_price")),
           "low": oc.number(row.get("low_price")), "prev_close": previous,
           "volume": oc.number(row.get("volume")), "volume_ratio": oc.number(row.get("volume_ratio")),
           "update_time_et": str(row.get("update_time", "")), "age_seconds": age,
           "pre_market": extended(row, "pre"), "after_hours": extended(row, "after"), "status": "OK"}
    if not price or price <= 0:
        out["status"] = "INVALID_DATA"
    elif market_state in REGULAR_SESSION_STATES and (age is None or age > STALE_SECONDS):
        out["status"] = "STALE"
    return out


def snapshot(context, RET_OK, tickers):
    """{ticker: row or None}; retries one by one when a bad symbol voids the batch."""
    ret, table = context.get_market_snapshot(["US." + t for t in tickers])
    if ret == RET_OK:
        return {str(r["code"]).split(".", 1)[1]: r for _, r in table.iterrows()}
    rows = {}
    for ticker in tickers:
        ret, table = context.get_market_snapshot(["US." + ticker])
        rows[ticker] = next((r for _, r in table.iterrows()), None) if ret == RET_OK else None
    return rows


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
                                     allow_abbrev=False)
    parser.add_argument("--tickers", required=True, help="comma-separated US tickers")
    tickers = list(dict.fromkeys(t.strip().upper() for t in parser.parse_args(argv).tickers.split(",") if t.strip()))

    def read():
        with oc.sdk_output():
            from moomoo import OpenQuoteContext, RET_OK
            state = oc.global_state(OpenQuoteContext, RET_OK)
            context = OpenQuoteContext(host=oc.HOST, port=oc.PORT)
            try:
                rows = snapshot(context, RET_OK, tickers)
            finally:
                context.close()
        return state, rows

    def render(result):
        state, rows = result
        market_state = str(state.get("market_us", ""))
        quotes = [quote_row(t, rows[t], market_state) if rows.get(t) is not None
                  else {"ticker": t, "status": "UNKNOWN_TICKER"} for t in tickers]
        return {"status": "OK", "source": "moomoo OpenD market snapshot (read-only)",
                "queried_at_utc": oc.now_utc(), "us_market_state": market_state, "quotes": quotes,
                "note": "volume_ratio is moomoo's time-normalised volume ratio, not TradingView's "
                        "relative volume. A STALE or INVALID_DATA row supports no verdict."}

    return oc.run(read, render)


if __name__ == "__main__":
    sys.exit(main())
