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


def _is_vix(ticker: str) -> bool:
    return ticker.upper().replace("US.", "") in {"VIX", "^VIX"}


def _fetch_yahoo_vix() -> dict[str, Any] | None:
    """OpenD does not expose VIX as US.VIX; use Yahoo chart as fallback."""
    url = "https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?range=1d&interval=1m"
    try:
        r = requests.get(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "Mozilla/5.0 (compatible; DashboardBridge/1.0)",
            },
            timeout=10,
        )
        r.raise_for_status()
        payload = r.json()
        result = (payload.get("chart", {}).get("result") or [None])[0] or {}
        meta = result.get("meta") or {}
        price = meta.get("regularMarketPrice")
        prev_close = meta.get("chartPreviousClose") or meta.get("previousClose")
        observed_raw = meta.get("regularMarketTime")
        if not isinstance(price, (int, float)) or price <= 0:
            return None
        observed_at = (
            datetime.datetime.fromtimestamp(float(observed_raw), datetime.timezone.utc)
            if isinstance(observed_raw, (int, float)) and observed_raw > 0
            else datetime.datetime.now(datetime.timezone.utc)
        )
        change_pct = (
            ((float(price) - float(prev_close)) / float(prev_close) * 100)
            if isinstance(prev_close, (int, float)) and prev_close > 0
            else None
        )
        return {
            "symbol": "VIX",
            "price": float(price),
            "changePct": round(change_pct, 4) if change_pct is not None else None,
            "volume": None,
            "source": "yahoo-chart",
            "observedAt": observed_at.isoformat(),
        }
    except Exception as e:
        log.warning("VIX Yahoo fallback failed (non-fatal): %s", e)
        return None


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
    wants_vix = False
    for t in list(position_tickers) + list(cfg.sync.live_quote_extras):
        if _is_vix(t):
            wants_vix = True
            continue
        code = _futu_code(t)
        if code not in seen:
            seen.add(code)
            universe.append(code)

    if not universe:
        vix = _fetch_yahoo_vix() if wants_vix else None
        return [vix] if vix else []

    ctx = OpenQuoteContext(host=cfg.opend.host, port=cfg.opend.port)
    try:
        ret, df = ctx.get_market_snapshot(universe)
    except Exception as e:
        log.warning("get_market_snapshot raised (non-fatal): %s", e)
        vix = _fetch_yahoo_vix() if wants_vix else None
        return [vix] if vix else []
    finally:
        ctx.close()

    if ret != RET_OK:
        log.warning("get_market_snapshot error (non-fatal): %s", df)
        vix = _fetch_yahoo_vix() if wants_vix else None
        return [vix] if vix else []

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
    if wants_vix:
        vix = _fetch_yahoo_vix()
        if vix:
            rows.append(vix)
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
