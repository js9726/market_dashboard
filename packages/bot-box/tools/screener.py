#!/usr/bin/env python3
"""Live TradingView screener hits for the private bot (anonymous read, prints only).

    python packages/bot-box/tools/screener.py --config <tv-screeners.json> [--screener ID] [--limit 15]

Runs Jie's configured screeners (the runner passes the canonical
apps/market_dashboard_backend/scripts/tv-screeners.json; the bot cannot choose the file)
against scanner.tradingview.com and prints each one's hits: ticker, exchange, name,
close, change %, volume, TradingView relative volume, market cap, sector, industry, 1-week
and 1-month performance, pre-market change and ATR %.

Why not the pipeline's own fetcher: tv_screener_fetch.py loads the repository .env at
import and always writes files. This tool sends no cookie or key, reads no secret, writes
nothing and never calls DeepSeek, so hits are unscored. A screener that fails gets its own
status (HTTP code or error) and no hits; the others still print. If every screener fails,
the overall status is UNAVAILABLE (exit 3).
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import time
import urllib.error
import urllib.request

SCANNER_URL = "https://scanner.tradingview.com/america/scan"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                         "Chrome/124.0.0.0 Safari/537.36",
           "Content-Type": "application/json", "Accept": "application/json, text/plain, */*",
           "Origin": "https://www.tradingview.com", "Referer": "https://www.tradingview.com/"}
TIMEOUT, ATTEMPTS, RETRY_SECONDS = 20, 2, 3
FIELDS = {"name": "name", "close": "close", "change": "change_pct", "volume": "volume",
          "relative_volume_10d_calc": "relative_volume", "market_cap_basic": "market_cap", "sector": "sector",
          "industry": "industry", "Perf.W": "perf_week_pct", "Perf.1M": "perf_month_pct",
          "premarket_change": "premarket_change_pct", "ATRP": "atr_pct"}


def emit(payload):
    sys.stdout.buffer.write((json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    sys.stdout.buffer.flush()


def post(body):
    request = urllib.request.Request(SCANNER_URL, data=json.dumps(body).encode("utf-8"), method="POST",
                                     headers=HEADERS)
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return json.loads(response.read().decode("utf-8"))


def run_screener(screener, columns, limit, send=post):
    body = dict(screener["query"], columns=columns)
    for attempt in range(1, ATTEMPTS + 1):
        try:
            data = send(body)
            break
        except urllib.error.HTTPError as error:
            if error.code in (429, 500, 502, 503, 504) and attempt < ATTEMPTS:
                time.sleep(RETRY_SECONDS)
                continue
            return {"id": screener["id"], "name": screener.get("name"), "status": "HTTP_{}".format(error.code),
                    "hits": []}
        except (urllib.error.URLError, OSError, ValueError) as error:
            return {"id": screener["id"], "name": screener.get("name"),
                    "status": "ERROR_{}".format(error.__class__.__name__), "hits": []}
    hits = []
    for row in data.get("data", []):
        symbol, values = str(row.get("s", "")), row.get("d") or []
        exchange, _, ticker = symbol.partition(":")
        mapped = {col: (values[i] if i < len(values) else None) for i, col in enumerate(columns)}
        hit = {"ticker": ticker or exchange, "exchange": exchange if ticker else None}
        hit.update({label: mapped.get(col) for col, label in FIELDS.items() if col in mapped})
        hits.append(hit)
    return {"id": screener["id"], "name": screener.get("name"), "status": "OK", "total": len(hits),
            "hits": hits[:limit]}


def main(argv=None, send=post):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
                                     allow_abbrev=False)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--screener")
    parser.add_argument("--limit", type=int, default=15, choices=range(1, 51), metavar="1-50")
    args = parser.parse_args(argv)
    config = json.loads(args.config.read_text(encoding="utf-8"))
    screeners = config["screeners"]
    if args.screener:
        screeners = [s for s in screeners if s["id"] == args.screener]
        if not screeners:
            emit({"status": "UNKNOWN_SCREENER", "screener": args.screener,
                  "available": [s["id"] for s in config["screeners"]]})
            return 2
    results = [run_screener(s, list(config["columns_to_fetch"]), args.limit, send) for s in screeners]
    ok = [r for r in results if r["status"] == "OK"]
    emit({"status": "OK" if len(ok) == len(results) else "PARTIAL" if ok else "UNAVAILABLE",
          "source": "TradingView scanner, live anonymous request (unscored)",
          "fetched_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"), "screeners": results,
          "note": "TradingView prices can lag; confirm with the quotes tool before any verdict. "
                  "relative_volume mid-session compares volume so far with a full-day average."})
    return 0 if ok else 3


if __name__ == "__main__":
    sys.exit(main())
