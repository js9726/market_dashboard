"""
HTTP client for POSTing to /api/bridge/sync.

Auth: Authorization: Bearer <token> + X-Timestamp: <unix-seconds>.
"""
from __future__ import annotations

import datetime
import logging
import time
from typing import Any

import requests

from .config import Config

log = logging.getLogger(__name__)

DEFAULT_TIMEOUT_SEC = 30


class DashboardClient:
    def __init__(self, cfg: Config):
        self.cfg = cfg

    def sync(
        self,
        positions: list[dict[str, Any]],
        fills: list[dict[str, Any]],
        equity: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        url = f"{self.cfg.dashboard.url}/api/bridge/sync"
        body: dict[str, Any] = {
            "brokerAccountAlias": self.cfg.broker.account_alias,
            "brokerType": self.cfg.broker.type,
            "syncedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "positions": positions,
            "fills": fills,
        }
        # Phase 4: equity snapshot is optional in the payload to stay backward-
        # compatible with older dashboard /api/bridge/sync versions. The route
        # ignores unknown fields if equity_snapshots isn't supported yet.
        if equity is not None:
            body["equity"] = equity
        headers = {
            "Authorization": f"Bearer {self.cfg.dashboard.token}",
            "X-Timestamp": str(int(time.time())),
            "Content-Type": "application/json",
        }
        try:
            # allow_redirects=False so a misconfigured middleware that 302's
            # us to /login surfaces as a 3xx error instead of silently
            # following to a 200 HTML page.
            r = requests.post(
                url, headers=headers, json=body,
                timeout=DEFAULT_TIMEOUT_SEC, allow_redirects=False,
            )
        except requests.RequestException as e:
            log.error("Sync HTTP request failed: %s", e)
            return {"ok": False, "error": str(e)}

        if 300 <= r.status_code < 400:
            log.error("Sync redirected (%d) -- middleware likely intercepting. Body: %s",
                      r.status_code, r.text[:200])
            return {"ok": False, "error": f"redirect_{r.status_code}"}
        if r.status_code == 401:
            log.error("Auth failed (401): %s", r.text[:200])
            return {"ok": False, "error": "auth"}
        if r.status_code == 404:
            log.error("Account alias not found (404): %s", r.text[:200])
            return {"ok": False, "error": "account_not_found"}
        if r.status_code >= 400:
            log.error("Sync %d: %s", r.status_code, r.text[:200])
            return {"ok": False, "error": f"status_{r.status_code}"}

        # If status was 200 but body isn't JSON, the route handler probably
        # crashed or middleware injected HTML. Treat as failure so we know.
        try:
            return r.json()  # type: ignore[no-any-return]
        except ValueError:
            log.error("Sync 200 but response is not JSON: %s", r.text[:200])
            return {"ok": False, "error": "non_json_response"}
