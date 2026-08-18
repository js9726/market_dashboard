"""Measure US breadth above the 5, 20 and 50-day simple moving averages.

The default universe is the S&P 500 membership reported by TradingView's scanner,
which makes the 50-day result comparable in scope to StockCharts ``$SPXA50R``.
TradingView can return fewer than 500 symbols because of share-class and data-vendor
coverage differences, so the exact measured denominator is always printed.

Usage::

    python breadth_ma.py
    python breadth_ma.py --universe sp500 --json
    python breadth_ma.py --universe liquid-us --min-cap 2e9 --json
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from typing import Any

sys.stdout.reconfigure(encoding="utf-8")

URL = "https://scanner.tradingview.com/america/scan"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Content-Type": "application/json",
}
COLS = ["name", "close", "SMA5", "SMA20", "SMA50", "market_cap_basic", "indexes"]
SP500_PRONAME = "SP:SPX"


def scan(filters: list[dict[str, Any]], limit: int) -> tuple[list[dict[str, Any]], int]:
    body = {
        "filter": filters,
        "options": {"lang": "en"},
        "markets": ["america"],
        "symbols": {"query": {"types": ["stock"]}, "tickers": []},
        "columns": COLS,
        "sort": {"sortBy": "market_cap_basic", "sortOrder": "desc"},
        "range": [0, limit],
    }
    req = urllib.request.Request(
        URL,
        data=json.dumps(body).encode(),
        headers=HEADERS,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=45) as response:
        payload = json.loads(response.read())

    rows: list[dict[str, Any]] = []
    for row in payload.get("data", []):
        values = row.get("d", [])
        if len(values) < len(COLS):
            continue
        record = dict(zip(COLS, values))
        if record["close"] is not None:
            rows.append(record)
    return rows, int(payload.get("totalCount") or len(rows))


def is_sp500(record: dict[str, Any]) -> bool:
    return any(
        isinstance(index, dict) and index.get("proname") == SP500_PRONAME
        for index in (record.get("indexes") or [])
    )


def fetch_sp500() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    rows, total = scan(
        [{"left": "is_primary", "operation": "equal", "right": True}],
        20_000,
    )
    if total > len(rows):
        raise RuntimeError(f"scanner result truncated: returned {len(rows)} of {total}")
    members = [row for row in rows if is_sp500(row)]
    if len(members) < 450:
        raise RuntimeError(
            f"only {len(members)} S&P 500 members were classified; expected at least 450"
        )
    return members, {
        "kind": "sp500",
        "definition": "TradingView index membership proname SP:SPX",
        "scanner_primary_stock_count": total,
    }


def fetch_liquid_us(
    min_cap: float,
    min_price: float,
    min_vol: float,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    rows, total = scan(
        [
            {"left": "market_cap_basic", "operation": "egreater", "right": min_cap},
            {"left": "close", "operation": "egreater", "right": min_price},
            {"left": "average_volume_10d_calc", "operation": "egreater", "right": min_vol},
            {"left": "is_primary", "operation": "equal", "right": True},
        ],
        3_000,
    )
    if total > len(rows):
        raise RuntimeError(f"scanner result truncated: returned {len(rows)} of {total}")
    return rows, {
        "kind": "liquid-us",
        "definition": (
            f"US primary stocks; cap >= {min_cap:g}; price >= {min_price:g}; "
            f"10d average volume >= {min_vol:g}"
        ),
    }


def calculate(rows: list[dict[str, Any]], metadata: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {
        "universe": metadata,
        "measured": len(rows),
    }
    for moving_average in ("SMA5", "SMA20", "SMA50"):
        valid = [row for row in rows if row.get(moving_average) is not None]
        above = [row for row in valid if row["close"] > row[moving_average]]
        result[moving_average] = {
            "n": len(valid),
            "above": len(above),
            "pct": round(len(above) / len(valid) * 100, 1) if valid else None,
        }
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--universe", choices=("sp500", "liquid-us"), default="sp500")
    parser.add_argument("--min-cap", type=float, default=2e9)
    parser.add_argument("--min-price", type=float, default=5.0)
    parser.add_argument("--min-vol", type=float, default=300_000)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    try:
        if args.universe == "sp500":
            rows, metadata = fetch_sp500()
        else:
            rows, metadata = fetch_liquid_us(args.min_cap, args.min_price, args.min_vol)
    except Exception as error:
        print(f"FAIL-CLOSED: breadth scan failed: {error}", file=sys.stderr)
        return 1

    if not rows:
        print("FAIL-CLOSED: scanner returned 0 rows. Do not classify breadth.", file=sys.stderr)
        return 1

    result = calculate(rows, metadata)
    if args.json:
        print(json.dumps(result, indent=2))
        return 0

    print("\n  BREADTH — % of stocks above their moving average")
    print(f"  universe: {metadata['definition']}")
    print(f"  measured symbols: {len(rows)}\n")
    for moving_average, label, threshold in (
        ("SMA5", "5-day", 75),
        ("SMA20", "20-day", None),
        ("SMA50", "50-day", None),
    ):
        value = result[moving_average]
        flag = ""
        if threshold and value["pct"] is not None:
            flag = (
                "  <-- STRETCHED (>75%)"
                if value["pct"] > threshold
                else f"  <-- below {threshold}%, NOT stretched"
            )
        print(
            f"   above {label:8s} {value['pct']:>5.1f}%   "
            f"({value['above']}/{value['n']}){flag}"
        )
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
