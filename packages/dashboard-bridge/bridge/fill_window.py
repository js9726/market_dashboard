"""
Which deals each moomoo poll asks OpenD for, and how far back after an outage.

Three rules keep a fill from being dropped:

- OpenD reads history_deal_list_query's start/end dates in the OpenD host's local
  time, not UTC and not the market's zone. The OKTA buy at 13:24 ET on 3 Sep 2026
  (01:24 MYT on 4 Sep) is only returned by a window that includes 4 Sep. Windows
  are therefore host-local dates and run to tomorrow.
- The bridge remembers when it last fetched AND posted an account's fills, and
  reaches back to that day after an outage. A fixed 1-day lookback lost the PLTR
  stop of 2026-10-16 while the PC was off for 37 hours.
- A failed deal query is retried, then reported as a failure instead of "no
  fills", so the remembered sync time never moves past it.
"""
from __future__ import annotations

import datetime
import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Callable

from moomoo import RET_OK, TrdEnv

log = logging.getLogger(__name__)

STATE_PATH = Path.home() / ".dashboard-bridge-state.json"

# One history_deal_list_query covers at most ~90 days (see backfill_deals.py).
MAX_WINDOW_DAYS = 90

# OpenD allows 10 history-deal queries per 30 seconds; three per poll stay inside it.
RETRY_DELAYS_SEC = (2.0, 5.0)


def deal_query_window(
    today: datetime.date,
    lookback_days: int,
    since: datetime.date | None = None,
) -> tuple[datetime.date, datetime.date]:
    """Host-local (start, end) dates for one history_deal_list_query.

    start reaches back lookback_days, or to the day before `since` when that is
    earlier. end is tomorrow, so a deal stamped after local midnight is never cut
    off. A window longer than MAX_WINDOW_DAYS is clamped with a warning.
    """
    end = today + datetime.timedelta(days=1)
    start = today - datetime.timedelta(days=max(lookback_days, 1))
    if since is not None:
        start = min(start, since - datetime.timedelta(days=1))
    floor = end - datetime.timedelta(days=MAX_WINDOW_DAYS)
    if start < floor:
        log.warning(
            "fill catch-up from %s exceeds one %d-day query; deals before %s are not fetched",
            start, MAX_WINDOW_DAYS, floor,
        )
        start = floor
    return start, end


def query_deals(
    ctx: Any,
    start: datetime.date,
    end: datetime.date,
    acc_id: int,
    delays: tuple[float, ...] = RETRY_DELAYS_SEC,
    sleep: Callable[[float], None] | None = None,
) -> Any | None:
    """history_deal_list_query with retries. Returns the deal DataFrame, or None
    when every attempt failed (OpenD reports "Network interruption" and timeouts
    for minutes at a time)."""
    sleep = sleep or time.sleep
    attempts = len(delays) + 1
    for attempt in range(1, attempts + 1):
        try:
            ret, data = ctx.history_deal_list_query(
                start=start.isoformat(),
                end=end.isoformat(),
                trd_env=TrdEnv.REAL,
                acc_id=acc_id,
            )
        except Exception as e:  # noqa: BLE001
            ret, data = None, e
        if ret == RET_OK:
            return data
        if attempt < attempts:
            log.warning("history_deal_list_query attempt %d/%d failed: %s", attempt, attempts, data)
            sleep(delays[attempt - 1])
    log.error(
        "history_deal_list_query failed after %d attempts (%s..%s): %s",
        attempts, start, end, data,
    )
    return None


class FillSyncState:
    """When each broker account last had its fills fetched and posted.

    Kept in a file because it matters most across restarts: the PC sleeping
    through a fill is the outage this covers.
    """

    def __init__(self, path: Path = STATE_PATH):
        self.path = path

    def last_synced(self, account: str) -> datetime.datetime | None:
        raw = self._read()["fillsSyncedAt"].get(account)
        if raw is None:
            return None
        try:
            return datetime.datetime.fromisoformat(raw)
        except (TypeError, ValueError):
            log.warning("ignoring bad fill-sync time %r for %s in %s", raw, account, self.path)
            return None

    def mark_synced(self, account: str, at: datetime.datetime) -> None:
        data = self._read()
        data["fillsSyncedAt"][account] = at.isoformat()
        tmp = self.path.with_name(self.path.name + ".tmp")
        try:
            tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
            os.replace(tmp, self.path)
        except OSError as e:
            log.warning("could not save fill-sync state to %s (non-fatal): %s", self.path, e)

    def _read(self) -> dict[str, Any]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            data = {}
        except (OSError, ValueError) as e:
            log.warning("ignoring unreadable fill-sync state %s: %s", self.path, e)
            data = {}
        if not isinstance(data, dict):
            data = {}
        if not isinstance(data.get("fillsSyncedAt"), dict):
            data["fillsSyncedAt"] = {}
        return data
