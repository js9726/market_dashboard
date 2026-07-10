"""Tests for the Conviction-model deterministic screener scorer (_compute_stages).

Conviction = Setup/40 + Entry/30 + Theme/20 + Sentiment/10 (GO>=75/WAIT 50-74/PASS<50).
Run: python scripts/test_tv_screener_scoring.py  (from apps/market_dashboard_backend)
"""
import datetime
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tv_screener_fetch import (
    _compute_stages,
    session_volume_fraction,
    effective_rvol,
    annotate_intraday_rvol,
)

try:
    from zoneinfo import ZoneInfo
    _ET = ZoneInfo("America/New_York")
except Exception:  # pragma: no cover - CI fallback
    import pytz
    _ET = pytz.timezone("America/New_York")


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


def test_session_volume_fraction_bounds():
    # Closed paths → 1.0 (raw RVOL, correction disabled)
    _check("weekend closed == 1.0",
           session_volume_fraction(datetime.datetime(2026, 7, 4, 11, 0, tzinfo=_ET)) == 1.0)  # Sat
    _check("pre-open closed == 1.0",
           session_volume_fraction(datetime.datetime(2026, 7, 6, 8, 0, tzinfo=_ET)) == 1.0)
    _check("after-close closed == 1.0",
           session_volume_fraction(datetime.datetime(2026, 7, 6, 17, 0, tzinfo=_ET)) == 1.0)
    # Intraday → strictly between the floor and 1.0, and monotonic through the day
    f_open  = session_volume_fraction(datetime.datetime(2026, 7, 6, 10, 0, tzinfo=_ET))
    f_mid   = session_volume_fraction(datetime.datetime(2026, 7, 6, 13, 0, tzinfo=_ET))
    f_late  = session_volume_fraction(datetime.datetime(2026, 7, 6, 15, 30, tzinfo=_ET))
    _check("intraday floored >= 0.12", f_open >= 0.12)
    _check("intraday < 1.0", f_late < 1.0)
    _check("monotonic through session", f_open < f_mid < f_late)


def test_effective_rvol_one_sided():
    # Divides by the elapsed volume fraction → only ever RAISES (never lowers)
    _check("raises understated rvol", effective_rvol(1.07, 0.30) > 1.07)
    _check("closed is no-op", effective_rvol(1.07, 1.0) == 1.07)
    _check("zero stays zero", effective_rvol(0, 0.30) == 0)
    _check("None is safe", effective_rvol(None, 0.30) is None)


def test_intraday_understated_rvol_not_setup8():
    # CRDO-like: real +6% mover but TV shows 0.30x cumulative-so-far RVOL early
    # session. RAW → no pattern classifies + rvol<1 penalty → the "setup 8 /
    # low RVOL / UNCLEAR" stamp the fix targets.
    raw_hit = {"change": 6, "Perf.1M": 10, "Perf.W": 2, "relative_volume_10d_calc": 0.30,
               "market_cap_basic": 5e9, "high": 51, "low": 49.5, "close": 50.6}
    s_raw = _compute_stages(dict(raw_hit))
    _check("raw understated == setup 8", s_raw["setup"] == 8)
    _check("raw understated == UNCLEAR", s_raw["pattern"] == "UNCLEAR")

    # Adjusted early-session: 0.30 / 0.15 = 2.0x → clears the breakout gate.
    adj = [dict(raw_hit)]
    annotate_intraday_rvol(adj, 0.15)
    s_adj = _compute_stages(adj[0])
    _check("adjusted lifts out of setup 8", s_adj["setup"] > 8)
    _check("adjusted classifies a pattern", s_adj["pattern"] != "UNCLEAR")
    _check("adjusted flagged on the hit", adj[0]["rvol_adjusted"] is True)
    _check("raw preserved on the hit", adj[0]["rvol_raw"] == 0.30)


def test_intraday_high_rvol_ep_mover():
    # WULF-like: +15% fresh gap, TV reads only 1.07x (cumulative-so-far) mid-morning.
    hit = {"change": 15, "Perf.1M": 5, "Perf.W": 8, "relative_volume_10d_calc": 1.07,
           "market_cap_basic": 19e9, "high": 22, "low": 18.5, "close": 21.4}
    s_raw = _compute_stages(dict(hit))          # raw 1.07 → misses EP (>2.5) gate
    adj = [dict(hit)]
    annotate_intraday_rvol(adj, 0.30)           # 1.07 / 0.30 ≈ 3.57x → EP gate clears
    s_adj = _compute_stages(adj[0])
    _check("adjusted recognises EP", s_adj["pattern"] == "EP")
    _check("adjusted setup strong (>=32)", s_adj["setup"] >= 32)
    _check("adjustment improves discrimination", s_adj["setup"] > s_raw["setup"])


def test_closed_market_path_byte_identical():
    # Scoring a hit annotated at fraction 1.0 must equal scoring the raw hit.
    raw_hit = {"change": 6, "Perf.1M": 10, "Perf.W": 2, "relative_volume_10d_calc": 0.30,
               "market_cap_basic": 5e9, "high": 51, "low": 49.5, "close": 50.6}
    closed = [dict(raw_hit)]
    annotate_intraday_rvol(closed, 1.0)
    _check("closed effective == raw", closed[0]["rvol_effective"] == 0.30)
    _check("closed not flagged adjusted", closed[0]["rvol_adjusted"] is False)
    _check("closed stages == raw stages",
           _compute_stages(closed[0]) == _compute_stages(dict(raw_hit)))


if __name__ == "__main__":
    for fn in [test_keys_and_caps, test_clean_ep_is_go, test_parabolic_is_pass,
               test_low_volume_breakout_not_go, test_sentiment_override, test_verdict_bands_via_algo,
               test_session_volume_fraction_bounds, test_effective_rvol_one_sided,
               test_intraday_understated_rvol_not_setup8, test_intraday_high_rvol_ep_mover,
               test_closed_market_path_byte_identical]:
        print(fn.__name__)
        fn()
    print("\nALL TESTS PASSED")
