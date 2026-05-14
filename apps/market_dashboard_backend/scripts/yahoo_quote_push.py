"""
Yahoo Finance fallback live-quote push.

Hits the unofficial https://query1.finance.yahoo.com/v7/finance/quote endpoint
for indices, sector ETFs, and the watchlist, then POSTs to the Vercel
/api/live-quotes/ingest route in "fallback" mode. The server skips writes
for any symbol whose existing row was observed within the last 90 s — so
when the moomoo daemon is also running, this script is a no-op.

Run from GitHub Actions every 5 min during 13:00–21:00 UTC, Mon–Fri.
"""
from __future__ import print_function
import datetime
import json
import os
import sys
import urllib.error
import urllib.request

YAHOO_INDEX_ALIASES = {
    "^GSPC": "SPX",
    "^NDX": "NDX",
    "^DJI": "DJI",
    "^RUT": "RUT",
    "^VIX": "VIX",
}

INDEX_SYMBOLS = list(YAHOO_INDEX_ALIASES.keys()) + ["SPY", "QQQ", "IWM", "DIA"]
SECTOR_SYMBOLS = ["XLK", "XLF", "XLE", "XLV", "XLI", "XLY", "XLP", "XLU", "XLB", "XLRE", "XLC"]
WATCHLIST = ["NVDA", "TSLA", "AAPL", "MSFT", "AMZN", "META",
             "GOOGL", "AMD", "SMCI", "PLTR", "CRWD", "MSTR"]

ALL_SYMBOLS = INDEX_SYMBOLS + SECTOR_SYMBOLS + WATCHLIST


def fetch_yahoo(symbols):
    url = "https://query1.finance.yahoo.com/v7/finance/quote?symbols=" + ",".join(symbols)
    req = urllib.request.Request(
        url,
        headers={
            # Yahoo blocks default urllib UA; mimic a browser
            "User-Agent": "Mozilla/5.0 (compatible; market-dashboard-bot/1.0)",
        },
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        payload = json.loads(r.read().decode("utf-8"))
    return payload.get("quoteResponse", {}).get("result", []) or []


def push_batch(quotes):
    base = os.environ.get("VERCEL_INGEST_URL")
    key = os.environ.get("LIVE_QUOTE_INGEST_KEY")
    if not base or not key:
        print("missing VERCEL_INGEST_URL or LIVE_QUOTE_INGEST_KEY", file=sys.stderr)
        sys.exit(2)
    url = base.rstrip("/") + "/api/live-quotes/ingest"
    body = json.dumps({"quotes": quotes, "mode": "fallback"}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + key,
        },
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    try:
        rows = fetch_yahoo(ALL_SYMBOLS)
    except urllib.error.HTTPError as e:
        print("yahoo HTTP %s" % e.code, file=sys.stderr)
        sys.exit(1)

    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    quotes = []
    for r in rows:
        raw_sym = r.get("symbol")
        sym = YAHOO_INDEX_ALIASES.get(raw_sym, raw_sym)
        price = r.get("regularMarketPrice")
        if not sym or price is None:
            continue
        change_pct = r.get("regularMarketChangePercent")
        volume = r.get("regularMarketVolume")
        # Yahoo gives epoch seconds; prefer the server-side trade time when present
        ts = r.get("regularMarketTime")
        observed_at = (
            datetime.datetime.fromtimestamp(ts, tz=datetime.timezone.utc).isoformat()
            if ts else now_iso
        )
        quotes.append({
            "symbol": sym,
            "price": float(price),
            "changePct": float(change_pct) if change_pct is not None else None,
            "volume": int(volume) if volume is not None else None,
            "source": "yahoo",
            "observedAt": observed_at,
        })

    if not quotes:
        print("no quotes from yahoo", file=sys.stderr)
        sys.exit(1)

    res = push_batch(quotes)
    print("written=%d skipped=%d" % (res.get("written", 0), res.get("skipped", 0)))


if __name__ == "__main__":
    main()
