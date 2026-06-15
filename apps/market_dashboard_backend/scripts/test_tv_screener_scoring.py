"""Tests for the Conviction-model deterministic screener scorer (_compute_stages).

Conviction = Setup/40 + Entry/30 + Theme/20 + Sentiment/10 (GO>=75/WAIT 50-74/PASS<50).
Run: python scripts/test_tv_screener_scoring.py  (from apps/market_dashboard_backend)
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tv_screener_fetch import _compute_stages


def _check(name, cond):
    print(f"  {'PASS' if cond else 'FAIL'}  {name}")
    if not cond:
        raise AssertionError(name)


def test_keys_and_caps():
    s = _compute_stages({"change": 6, "Perf.1M": 12, "relative_volume_10d_calc": 2.0,
                         "market_cap_basic": 5e9, "high": 11, "low": 10, "close": 10.8})
    _check("has conviction keys", {"setup", "entry", "theme", "sentiment", "raw", "pattern"} <= set(s))
    _check("no legacy stage keys", not ({"s1_trend", "s2_pattern", "s3_timing", "s4_risk"} & set(s)))
    _check("setup <= 40", 0 <= s["setup"] <= 40)
    _check("entry <= 30", 0 <= s["entry"] <= 30)
    _check("theme <= 20", 0 <= s["theme"] <= 20)
    _check("sentiment <= 10", 0 <= s["sentiment"] <= 10)
    _check("raw == sum", s["raw"] == s["setup"] + s["entry"] + s["theme"] + s["sentiment"])
    _check("raw <= 100", s["raw"] <= 100)


def test_clean_ep_is_go():
    s = _compute_stages({"change": 20, "Perf.1M": 12, "Perf.W": 12,
                         "relative_volume_10d_calc": 6.3, "market_cap_basic": 21e9,
                         "high": 150, "low": 125, "close": 144})
    _check("EP pattern", s["pattern"] == "EP")
    _check("EP setup strong (>=35)", s["setup"] >= 35)
    _check("EP is GO (raw>=75)", s["raw"] >= 75)


def test_parabolic_is_pass():
    s = _compute_stages({"change": 5, "Perf.1M": 120, "Perf.W": 20,
                         "relative_volume_10d_calc": 1.0, "market_cap_basic": 4e9})
    _check("parabolic pattern", s["pattern"] == "PARABOLIC")
    _check("parabolic setup low (<=8)", s["setup"] <= 8)
    _check("parabolic is PASS (raw<50)", s["raw"] < 50)


def test_low_volume_breakout_not_go():
    # breakout shape but RVOL < 1 -> volume penalty should keep it out of GO
    s = _compute_stages({"change": 6, "Perf.1M": 20, "Perf.W": 5,
                         "relative_volume_10d_calc": 0.6, "market_cap_basic": 1e9,
                         "high": 100, "low": 95, "close": 99})
    _check("weak-volume setup penalised (<30)", s["setup"] < 30)
    _check("weak-volume not GO (raw<75)", s["raw"] < 75)


def test_sentiment_override():
    base = {"change": 3, "Perf.1M": 15, "relative_volume_10d_calc": 2.5, "market_cap_basic": 11e9}
    hi = _compute_stages(base, market_sentiment=10)
    lo = _compute_stages(base, market_sentiment=0)
    _check("sentiment high == 10", hi["sentiment"] == 10)
    _check("sentiment low == 0", lo["sentiment"] == 0)
    _check("sentiment shifts total by 10", hi["raw"] - lo["raw"] == 10)


def test_verdict_bands_via_algo():
    from tv_screener_fetch import algo_score_all
    hits = [{"ticker": "EP", "change": 20, "Perf.1M": 12, "relative_volume_10d_calc": 6.3,
             "market_cap_basic": 21e9, "high": 150, "low": 125, "close": 144}]
    algo_score_all(hits)
    _check("algo sets verdict", hits[0]["verdict"] in ("GO", "WAIT", "PASS"))
    _check("algo GO threshold (>=75)", (hits[0]["verdict"] == "GO") == (hits[0]["score"] >= 75))
    _check("algo stages use new keys", set(hits[0]["stages"]) == {"setup", "entry", "theme", "sentiment"})


if __name__ == "__main__":
    for fn in [test_keys_and_caps, test_clean_ep_is_go, test_parabolic_is_pass,
               test_low_volume_breakout_not_go, test_sentiment_override, test_verdict_bands_via_algo]:
        print(fn.__name__)
        fn()
    print("\nALL TESTS PASSED")
