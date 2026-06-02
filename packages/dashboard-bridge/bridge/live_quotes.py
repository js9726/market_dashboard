"""
Live-quote pusher for the local dashboard-bridge daemon.

Pulls real-time quotes from moomoo OpenD for the union of:
  - tickers in the user's current positions (so /dashboard/portfolio shows
    fresh P/L for the user's actual book — fixes the TENB-stale issue)
  - configurable extras from sync.live_quote_extras (defaults: SPY/QQQ/IWM/DIA/VIX
    so dashboard always has a fresh index and VIX reference)

Pushes to /api/live-quotes/ingest with source="moomoo". Failure modes are
non-fatal: a network error or OpenD hiccup logs a warning but doesn't break
the main positions/fills/equity sync loop.
"""
from __future__ import annotations

import datetime
import logging
from typing import Any, Sequence

import requests
from moomoo import OpenQuoteContext, RET_OK

from .config import Config

log = logging.getLogger(__name__)


def _futu_code(ticker: str) -> str:
    return ticker if ticker.startswith(("US.", "HK.", "SH.", "SZ.")) else f"US.{ticker}"


def _plain_symbol(futu_code: str) -> str:
    """MarketQuote keys on plain symbol, not futu code."""
    for prefix in ("US.", "HK.", "SH.", "SZ."):
        if futu_code.startswith(prefix):
            return futu_code[len(prefix):]
    return futu_code


def fetch_live_quotes(
    cfg: Config,
    position_tickers: Sequence[str],
) -> list[dict[str, Any]]:
    """
    Pull get_market_snapshot for position tickers + configured extras.
    Returns list of quote dicts ready for /api/live-quotes/ingest.
    """
    universe: list[str] = []
    seen: set[str] = set()
    for t in list(position_tickers) + list(cfg.sync.live_quote_extras):
        code = _futu_code(t)
        if code not in seen:
            seen.add(code)
            universe.append(code)

    if not universe:
        return []

    ctx = OpenQuoteContext(host=cfg.opend.host, port=cfg.opend.port)
    try:
        ret, df = ctx.get_market_snapshot(universe)
    except Exception as e:
        log.warning("get_market_snapshot raised (non-fatal): %s", e)
        return []
    finally:
        ctx.close()

    if ret != RET_OK:
        log.warning("get_market_snapshot error (non-fatal): %s", df)
        return []

    observed_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    rows: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        try:
            price = float(row.get("last_price", 0))
            if price <= 0:
                continue
            prev_close = float(row.get("prev_close_price", 0))
            change_pct = ((price - prev_close) / prev_close * 100) if prev_close > 0 else None
            volume = int(row.get("volume", 0))
            rows.append({
                "symbol": _plain_symbol(str(row.get("code", ""))),
                "price": price,
                "changePct": round(change_pct, 4) if change_pct is not None else None,
                "volume": volume,
                "source": "moomoo",
                "observedAt": observed_at,
            })
        except Exception as e:
            log.debug("row parse skipped: %s", e)
            continue
    return rows


def push_live_quotes(cfg: Config, quotes: list[dict[str, Any]]) -> dict[str, Any]:
    """POST quotes to /api/live-quotes/ingest. Returns the parsed response."""
    if not quotes:
        return {"ok": True, "skipped_empty": True}
    if not cfg.dashboard.live_quote_key:
        return {"ok": False, "error": "live_quote_key not configured"}

    url = f"{cfg.dashboard.url}/api/live-quotes/ingest"
    body = {"mode": "primary", "quotes": quotes}
    headers = {
        "Authorization": f"Bearer {cfg.dashboard.live_quote_key}",
        "Content-Type": "application/json",
    }
    try:
        r = requests.post(url, headers=headers, json=body, timeout=15, allow_redirects=False)
    except requests.RequestException as e:
        log.warning("live-quote push HTTP error (non-fatal): %s", e)
        return {"ok": False, "error": str(e)}

    if r.status_code >= 400:
        log.warning("live-quote push %d (non-fatal): %s", r.status_code, r.text[:200])
        return {"ok": False, "status": r.status_code}

    try:
        return r.json()
    except Exception:
        return {"ok": True, "raw": r.text[:200]}
