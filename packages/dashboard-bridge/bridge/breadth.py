"""
Post-close market-breadth trigger for dashboard-bridge.

The dashboard computes breadth server-side via TradingView scanner counts and
upserts Postgres. The bridge only decides when to hit the endpoint once per US
trading day, keeping the 60-second broker loop cheap.
"""
from __future__ import annotations

import json
import logging
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, time
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from .config import Config

log = logging.getLogger("bridge.breadth")

STATE_PATH = Path.home() / ".dashboard-bridge-state.json"


@dataclass(frozen=True)
class BreadthResult:
    ok: bool
    skipped: str | None = None
    response: dict[str, Any] | None = None
    error: str | None = None


def _load_state() -> dict[str, Any]:
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except Exception:
        log.warning("Could not read state file %s; continuing with empty state", STATE_PATH)
        return {}


def _save_state(state: dict[str, Any]) -> None:
    tmp = STATE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")
    tmp.replace(STATE_PATH)


def _parse_hhmm(value: str) -> time:
    match = re.fullmatch(r"(\d{1,2}):(\d{2})", value.strip())
    if not match:
        raise ValueError(f"Invalid sync.breadth_post_close_time: {value!r}")
    hour = int(match.group(1))
    minute = int(match.group(2))
    if hour > 23 or minute > 59:
        raise ValueError(f"Invalid sync.breadth_post_close_time: {value!r}")
    return time(hour, minute)


def _post_refresh(cfg: Config) -> dict[str, Any]:
    key = cfg.dashboard.brief_ingest_key
    if not key:
        raise RuntimeError("dashboard.brief_ingest_key is not configured")

    url = f"{cfg.dashboard.url}/api/breadth/refresh?force=1"
    req = urllib.request.Request(
        url,
        method="POST",
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "User-Agent": "dashboard-bridge-breadth/1.0",
        },
        data=b"{}",
    )
    with urllib.request.urlopen(req, timeout=75) as resp:
        body = resp.read().decode("utf-8", "replace")
    return json.loads(body)


def maybe_refresh_breadth(cfg: Config, *, now: datetime | None = None, force: bool = False) -> BreadthResult:
    if not cfg.sync.breadth_post_close and not force:
        return BreadthResult(ok=True, skipped="disabled")

    try:
        tz = ZoneInfo(cfg.sync.breadth_timezone)
        local_now = (now or datetime.now(tz)).astimezone(tz)
        run_after = _parse_hhmm(cfg.sync.breadth_post_close_time)
    except Exception as exc:
        return BreadthResult(ok=False, error=str(exc))

    if not force:
        if local_now.weekday() >= 5:
            return BreadthResult(ok=True, skipped="weekend")
        if local_now.time() < run_after:
            return BreadthResult(ok=True, skipped=f"waiting until {cfg.sync.breadth_post_close_time} {cfg.sync.breadth_timezone}")

    state = _load_state()
    today = local_now.date().isoformat()
    if not force and state.get("last_breadth_refresh_date") == today:
        return BreadthResult(ok=True, skipped=f"already refreshed {today}")

    try:
        payload = _post_refresh(cfg)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:500]
        return BreadthResult(ok=False, error=f"HTTP {exc.code}: {detail}")
    except Exception as exc:
        return BreadthResult(ok=False, error=str(exc))

    if payload.get("ok"):
        state["last_breadth_refresh_date"] = today
        state["last_breadth_refresh_at"] = local_now.isoformat()
        state["last_breadth_response"] = {
            "refreshedAt": payload.get("refreshedAt"),
            "bucketDate": payload.get("bucketDate"),
            "durationMs": payload.get("durationMs"),
        }
        _save_state(state)
        return BreadthResult(ok=True, response=payload)

    return BreadthResult(ok=False, response=payload, error=str(payload.get("error") or payload))
