"""Fail closed on stale, invalid or divergent generated artifacts before publication.

Generation timestamps do not establish freshness of every underlying quote.
Strict wall-clock age applies to newly run pipelines, even on weekends.
"""
from __future__ import annotations
import argparse
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

ARTIFACTS = {
    "snapshot": ("snapshot.json", "built_at"),
    "screeners": ("tv_screeners.json", "fetched_at"),
    "breadth": ("breadth.json", "as_of"),
}


def _parse_time(value):
    if not isinstance(value, str):
        raise ValueError("missing timestamp")
    stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if stamp.tzinfo is None:
        raise ValueError("timestamp must include timezone")
    return stamp.astimezone(timezone.utc)


def _reject_constant(value):
    raise ValueError(f"non-finite JSON token {value}")


def _finite_float(value):
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"non-finite JSON number {value}")
    return number


def _read_json(path):
    data = json.loads(path.read_text(encoding="utf-8-sig"), parse_constant=_reject_constant, parse_float=_finite_float)
    if not isinstance(data, dict):
        raise ValueError("expected JSON object")
    return data


def _validate_shape(kind, data):
    if data.get("error") or data.get("errors") or data.get("status") in ("failed", "error", "unavailable"):
        raise ValueError("producer reports an error/unavailable result")
    if kind == "snapshot":
        groups = data.get("groups")
        if not isinstance(groups, dict) or not any(isinstance(rows, list) and rows for rows in groups.values()):
            raise ValueError("snapshot groups are empty or invalid")
    elif kind == "screeners":
        rows = data.get("screeners")
        if not isinstance(rows, list) or not rows:
            raise ValueError("no screener results")
        for row in rows:
            if not isinstance(row, dict) or not isinstance(row.get("hits"), list):
                raise ValueError("malformed screener result")
            if row.get("error") or row.get("status") != "success":
                raise ValueError("screener lacks explicit successful-fetch provenance")
        # Successful scans may legitimately contain zero matching stocks.
    else:
        market = data.get("market")
        if not isinstance(market, dict):
            raise ValueError("breadth market is missing")
        universe = data.get("universe_size") or market.get("universe_size")
        if type(universe) is not int or universe < 1000:
            raise ValueError("breadth universe is missing or below 1000")


def validate(data_dir, public_dir=None, *, artifacts=tuple(ARTIFACTS), max_age_minutes=180, now=None):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None or max_age_minutes <= 0:
        raise ValueError("use an aware clock and positive max age")
    checks, errors, loaded = [], [], {}
    roots = [("backend", data_dir)] + ([("public", public_dir)] if public_dir else [])
    for label, directory in roots:
        for kind in artifacts:
            filename, key = ARTIFACTS[kind]
            try:
                data = _read_json(directory / filename)
                stamp = _parse_time(data.get(key))
                age = (now - stamp).total_seconds() / 60
                if age < -5:
                    raise ValueError("timestamp is more than 5 minutes in the future")
                if age > max_age_minutes:
                    raise ValueError(f"stale {key}={stamp.isoformat()} age={age:.1f}m")
                _validate_shape(kind, data)
                loaded[(label, kind)] = data
                checks.append({"source": label, "artifact": kind, "timestamp": stamp.isoformat(), "age_minutes": round(age, 1)})
            except (OSError, ValueError, TypeError) as exc:
                errors.append(f"{label}/{filename}: {exc}")
    if public_dir:
        for kind in artifacts:
            if ("backend", kind) in loaded and ("public", kind) in loaded:
                if loaded[("backend", kind)] != loaded[("public", kind)]:
                    errors.append(f"{kind}: backend/public content differs")
    return {"ok": not errors, "checked_at": now.isoformat(), "checks": checks, "errors": errors}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--public-dir")
    parser.add_argument("--max-age-minutes", type=int, default=180)
    parser.add_argument("--artifacts", nargs="+", choices=ARTIFACTS, default=list(ARTIFACTS))
    parser.add_argument("--now", help="Explicit timezone-aware clock for replay/tests")
    parser.add_argument("--json", action="store_true", help="Emit metadata-only JSON receipt")
    args = parser.parse_args()
    try:
        result = validate(Path(args.data_dir), Path(args.public_dir) if args.public_dir else None,
                          artifacts=tuple(args.artifacts), max_age_minutes=args.max_age_minutes,
                          now=_parse_time(args.now) if args.now else None)
    except ValueError as exc:
        parser.error(str(exc))
    if args.json:
        print(json.dumps(result, allow_nan=False, indent=2))
    else:
        for check in result["checks"]:
            print(f"[freshness] {check['source']}/{check['artifact']}: {check['timestamp']} age={check['age_minutes']}m")
        for error in result["errors"]:
            print(f"[freshness] FAILED: {error}", file=sys.stderr)
        print("[freshness] OK" if result["ok"] else "[freshness] FAILED")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
