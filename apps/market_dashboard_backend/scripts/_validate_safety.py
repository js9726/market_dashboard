"""Smoke test that sanitize_json + safe_json_dumps are wired correctly across
the three scripts that import them from build_data.py.

Run from apps/market_dashboard_backend/scripts/ as:
    python _validate_safety.py

Exits 0 on success, 1 on first assertion failure.
"""
import json
import sys

from build_data import sanitize_json, safe_json_dumps
import trader_verdict
import tv_screener_fetch


def main() -> int:
    # 1. Cross-script wiring: the helpers in the importing scripts must be the
    #    same function objects (not re-shadowed by anything else).
    assert trader_verdict.sanitize_json is sanitize_json, (
        "trader_verdict.sanitize_json is not the same object as build_data.sanitize_json"
    )
    assert tv_screener_fetch.sanitize_json is sanitize_json, (
        "tv_screener_fetch.sanitize_json is not the same object as build_data.sanitize_json"
    )

    # 2. Round-trip: NaN / Inf in nested structures must come out as null
    sample = {
        "nan": float("nan"),
        "inf": float("inf"),
        "neg_inf": float("-inf"),
        "good": 1.23,
        "nested": {"rs": float("nan"), "rvol": 2.5},
        "list": [1.0, float("nan"), 3.0],
    }
    raw = safe_json_dumps(sanitize_json(sample), indent=2)
    assert "NaN" not in raw, "Bare NaN survived: %r" % raw
    assert "Infinity" not in raw, "Bare Infinity survived: %r" % raw
    parsed = json.loads(raw)
    assert parsed["nan"] is None
    assert parsed["inf"] is None
    assert parsed["neg_inf"] is None
    assert parsed["good"] == 1.23
    assert parsed["nested"]["rs"] is None
    assert parsed["nested"]["rvol"] == 2.5
    assert parsed["list"] == [1.0, None, 3.0]

    print("sanitize_json + safe_json_dumps wiring OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
