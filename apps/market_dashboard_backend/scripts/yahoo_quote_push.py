"""
Yahoo Finance fallback live-quote push.

Hits the unofficial https://query1.finance.yahoo.com/v7/finance/quote endpoint
for indices, sector ETFs, and the current TV screener tickers, then POSTs to
the Vercel /api/live-quotes/ingest route in "fallback" mode. The server skips
writes for any symbol whose existing row was observed within the last 90 s
— so when the moomoo daemon is also running, this script is a no-op.

Ticker universe mirrors live_quote_daemon.py: loaded dynamically from
data/tv_screeners.json so the daemon and Yahoo fallback cover the same names.

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

# Fallback if tv_screeners.json is absent (e.g. first run on a fresh clone).
_FALLBACK_WATCHLIST = ["NVDA", "TSLA", "AAPL", "MSFT", "AMZN", "META",
                        "GOOGL", "AMD", "SMCI", "PLTR", "CRWD", "MSTR"]

# Per-chunk symbol count + timeout — matches live_quote_daemon.py.
# The /api/live-quotes/ingest route does sequential Prisma upserts (~200ms each
# against Neon), so batching 93+ symbols in one POST blows past the 10–15s
# default timeout. 15 per chunk × ~3s round trip = comfortable.
CHUNK_SIZE = 15
HTTP_TIMEOUT = 30


def load_screener_tickers():
    """Return unique alpha-only tickers from tv_screeners.json.

    Prefers data/tv_screeners.json (local dev, freshly generated). Falls back
    to the committed public/market-dashboard/tv_screeners.json so GitHub
    Actions (which only checks out HEAD, no data/ folder) still gets the
    current screener universe instead of the legacy 12-name fallback.
    """
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.normpath(os.path.join(here, "..", "data", "tv_screeners.json")),
        os.path.normpath(os.path.join(
            here, "..", "..", "market_dashboard", "public", "market-dashboard", "tv_screeners.json"
        )),
    ]
    data_path = next((p for p in candidates if os.path.exists(p)), None)
    if not data_path:
        print("[symbols] tv_screeners.json not found in any known path - using fallback watchlist", file=sys.stderr)
        return list(_FALLBACK_WATCHLIST)
    with open(data_path, encoding="utf-8") as f:
        data = json.load(f)
    tickers = []
    seen = set()
    for screener in data.get("screeners", []):
        for hit in screener.get("hits", []):
            sym = (hit.get("ticker") or "").strip().upper()
            # skip preferred shares, warrants, rights (anything non-alphabetic)
            if not sym or not sym.isalpha():
                continue
            if sym not in seen:
                seen.add(sym)
                tickers.append(sym)
    if not tickers:
        print("[symbols] tv_screeners.json had no hits - using fallback watchlist", file=sys.stderr)
        return list(_FALLBACK_WATCHLIST)
    print("[symbols] loaded %d screener tickers from tv_screeners.json" % len(tickers), file=sys.stderr)
    return tickers


WATCHLIST = load_screener_tickers()
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


def _post_chunk(url, key, chunk):
    body = json.dumps({"quotes": chunk, "mode": "fallback"}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + key,
        },
    )
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
        return json.loads(r.read().decode("utf-8"))


def push_batch(quotes):
    base = os.environ.get("VERCEL_INGEST_URL")
    key = os.environ.get("LIVE_QUOTE_INGEST_KEY")
    if not base or not key:
        print("missing VERCEL_INGEST_URL or LIVE_QUOTE_INGEST_KEY", file=sys.stderr)
        sys.exit(2)
    url = base.rstrip("/") + "/api/live-quotes/ingest"

    total_written = 0
    total_skipped = 0
    chunks = [quotes[i:i + CHUNK_SIZE] for i in range(0, len(quotes), CHUNK_SIZE)]
    for i, chunk in enumerate(chunks, 1):
        try:
            res = _post_chunk(url, key, chunk)
            total_written += res.get("written", 0)
            total_skipped += res.get("skipped", 0)
        except urllib.error.HTTPError as e:
            print("chunk %d/%d HTTP %s: %s" % (
                i, len(chunks), e.code, e.read().decode("utf-8", "ignore")[:200]
            ), file=sys.stderr)
            total_skipped += len(chunk)
        except Exception as e:
            print("chunk %d/%d error: %s" % (i, len(chunks), e), file=sys.stderr)
            total_skipped += len(chunk)
    return {"written": total_written, "skipped": total_skipped, "chunks": len(chunks)}


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
    print("%d chunks | written=%d skipped=%d" % (
        res.get("chunks", 0), res.get("written", 0), res.get("skipped", 0)
    ))


if __name__ == "__main__":
    main()
