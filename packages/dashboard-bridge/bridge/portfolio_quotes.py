"""
Portfolio quote refresher for local bridge daemons.

Vercel Hobby cron cannot run every few minutes, so the desktop bridge nudges the
deployed /api/cron/refresh-quotes route at most once per five minutes. That
keeps the portfolio "Today" column populated from Yahoo while broker-side
position sync keeps quantity/cost/equity truthful.
"""
from __future__ import annotations

import logging
import time
from typing import Any

import requests

from .config import Config

log = logging.getLogger(__name__)

MIN_REFRESH_INTERVAL_SEC = 5 * 60
_last_refresh_at = 0.0


def maybe_refresh_portfolio_quotes(cfg: Config, *, force: bool = False) -> dict[str, Any]:
    """Call the dashboard quote refresh endpoint, throttled per bridge process."""
    global _last_refresh_at

    key = cfg.dashboard.live_quote_key or cfg.dashboard.brief_ingest_key
    if not key:
        return {"ok": False, "skipped": "no quote refresh key configured"}

    now = time.time()
    if not force and now - _last_refresh_at < MIN_REFRESH_INTERVAL_SEC:
        return {"ok": True, "skipped": "throttled"}

    url = f"{cfg.dashboard.url}/api/cron/refresh-quotes"
    try:
        res = requests.get(
            url,
            params={"secret": key},
            timeout=45,
            allow_redirects=False,
        )
    except requests.RequestException as e:
        log.warning("Portfolio quote refresh HTTP error (non-fatal): %s", e)
        return {"ok": False, "error": str(e)}

    _last_refresh_at = now
    if res.status_code >= 400:
        log.warning("Portfolio quote refresh %d (non-fatal): %s", res.status_code, res.text[:200])
        return {"ok": False, "status": res.status_code}

    try:
        return res.json()
    except ValueError:
        return {"ok": True, "raw": res.text[:200]}
