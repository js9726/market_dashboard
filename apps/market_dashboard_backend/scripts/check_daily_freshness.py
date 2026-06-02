"""Validate that daily market artifacts were refreshed recently.

This is a local routine guard: it fails loudly when the files that power the
dashboard are stale, missing, malformed, or empty enough to be suspicious.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _read_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise AssertionError(f"{path} is not valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise AssertionError(f"{path} must contain a JSON object")
    return data


def _require_recent(label: str, path: Path, key: str, max_age_minutes: int) -> dict[str, Any]:
    if not path.exists():
        raise AssertionError(f"{label} missing at {path}")
    data = _read_json(path)
    stamp = _parse_time(data.get(key))
    if stamp is None:
        raise AssertionError(f"{label} missing parseable {key}")
    age_minutes = (datetime.now(timezone.utc) - stamp.astimezone(timezone.utc)).total_seconds() / 60
    if age_minutes > max_age_minutes:
        raise AssertionError(f"{label} stale: {key}={stamp.isoformat()} age={age_minutes:.1f}m")
    print(f"[freshness] {label}: {key}={stamp.isoformat()} age={age_minutes:.1f}m")
    return data


def _validate_dir(data_dir: Path, max_age_minutes: int, label_prefix: str) -> None:
    snapshot = _require_recent(f"{label_prefix} snapshot", data_dir / "snapshot.json", "built_at", max_age_minutes)
    groups = snapshot.get("groups")
    if not isinstance(groups, dict) or not groups:
        raise AssertionError(f"{label_prefix} snapshot has no groups")
    if not any(isinstance(rows, list) and rows for rows in groups.values()):
        raise AssertionError(f"{label_prefix} snapshot groups are empty")

    screeners = _require_recent(
        f"{label_prefix} TV screeners",
        data_dir / "tv_screeners.json",
        "fetched_at",
        max_age_minutes,
    )
    screener_rows = screeners.get("screeners")
    if not isinstance(screener_rows, list) or len(screener_rows) < 1:
        raise AssertionError(f"{label_prefix} TV screeners has no screener rows")
    total_hits = sum(len(s.get("hits") or []) for s in screener_rows if isinstance(s, dict))
    if total_hits < 10:
        raise AssertionError(f"{label_prefix} TV screeners has suspiciously few hits: {total_hits}")
    print(f"[freshness] {label_prefix} TV screeners: {total_hits} hits")

    breadth = _require_recent(f"{label_prefix} breadth", data_dir / "breadth.json", "as_of", max_age_minutes)
    market = breadth.get("market")
    universe = breadth.get("universe_size") or (market or {}).get("universe_size")
    if not isinstance(universe, int) or universe < 1000:
        raise AssertionError(f"{label_prefix} breadth universe suspicious: {universe}")
    print(f"[freshness] {label_prefix} breadth universe: {universe}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", default="data", help="Backend data directory")
    parser.add_argument("--public-dir", default=None, help="Optional Next public market-dashboard directory")
    parser.add_argument("--max-age-minutes", type=int, default=180)
    args = parser.parse_args()

    try:
      _validate_dir(Path(args.data_dir), args.max_age_minutes, "backend")
      if args.public_dir:
          _validate_dir(Path(args.public_dir), args.max_age_minutes, "public")
    except AssertionError as exc:
        print(f"[freshness] FAILED: {exc}", file=sys.stderr)
        return 1

    print("[freshness] OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
