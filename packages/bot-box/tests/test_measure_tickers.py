"""Offline regression tests for tools/measure_tickers.py (review findings B1-B4).

No network, broker or provider calls: every fetch is a synthetic in-memory series.

    python -m unittest discover -s packages/bot-box/tests -v
"""
from __future__ import annotations

import contextlib
import datetime as dt
import io
import json
import math
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import measure_tickers as m  # noqa: E402

ET = m.ET
# Monday 2026-09-28, 17:00 ET: that session's bar is final.
FIXED = dt.datetime(2026, 9, 28, 17, 0, tzinfo=ET)
SESSION = dt.date(2026, 9, 28)


def series(end: dt.date, n: int, start: float = 100.0, step: float = 0.2, vol: float = 2e6) -> list[dict]:
    """n well-formed bars on the n exchange sessions ending at `end`, gently rising."""
    bars, c = [], start
    for i, d in enumerate(m.recent_sessions(end, n)):
        o = c
        c = c + (step if i % 3 else -step / 2)
        bars.append({"d": d.isoformat(), "o": o, "h": max(o, c) + 0.5, "l": min(o, c) - 0.5, "c": c, "v": vol})
    return bars


def run(bars: dict[str, list[dict]], argv=None, now=FIXED, source="opend"):
    argv = argv or ["--tickers", "AAA", "--source", source]
    fetch = lambda wanted: {k: v for k, v in bars.items() if k in wanted}  # noqa: E731
    clock = now if callable(now) else (lambda: now)
    return m.run(argv, now=clock, fetchers={"opend": fetch, "yahoo": fetch}, reachable=lambda: True)


def row(doc: dict, ticker: str = "AAA") -> dict:
    return next(r for r in doc["rows"] if r["ticker"] == ticker)


class OutputPathB1(unittest.TestCase):
    """B1: the allow-listed tool must not be able to write where its caller says."""

    def test_output_flags_are_rejected(self):
        for flag in (["--out", "x.json"], ["--out=../../x.json"], ["--ou", "x"], ["--o", "x"],
                     ["--output", "x"]):
            with self.subTest(flag=flag), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as cm:
                    m.build_parser().parse_args(["--tickers", "AAA", *flag])
                self.assertEqual(cm.exception.code, 2)

    def test_main_writes_no_files_and_prints_strict_json(self):
        now = dt.datetime.now(ET)
        end = m.expected_last_completed(now)
        bars = {"SPY": series(end, 300), "AAA": series(end, 300, start=50)}
        with tempfile.TemporaryDirectory() as tmp:
            outside = Path(tmp) / "outside"
            work = Path(tmp) / "work"
            outside.mkdir()
            work.mkdir()
            old = os.getcwd()
            os.chdir(work)
            try:
                out = io.StringIO()
                with mock.patch.object(m, "fetch_opend", lambda w: {k: v for k, v in bars.items() if k in w}), \
                        mock.patch.object(m, "opend_reachable", lambda: True), contextlib.redirect_stdout(out):
                    code = m.main(["--tickers", "AAA"])
            finally:
                os.chdir(old)
            self.assertEqual(code, 0)
            self.assertEqual(list(work.iterdir()), [])
            self.assertEqual(list(outside.iterdir()), [])
            doc = json.loads(out.getvalue(), parse_constant=lambda c: self.fail(f"nonstandard JSON {c}"))
            self.assertEqual(row(doc)["status"], "OK")

    def test_source_has_no_file_write_calls(self):
        src = Path(m.__file__).read_text(encoding="utf-8")
        for needle in ('open(', 'write_text', 'write_bytes', '"--out"'):
            self.assertNotIn(needle, src, needle)


class FreshnessB2(unittest.TestCase):
    """B2: stale ticker or SPY history must never receive normal gates."""

    def test_fresh_series_is_measured(self):
        code, doc = run({"SPY": series(SESSION, 300), "AAA": series(SESSION, 300)})
        self.assertEqual(code, 0)
        self.assertEqual(doc["expected_last_completed_session"], "2026-09-28")
        self.assertEqual(doc["spy_last_bar"], "2026-09-28")
        r = row(doc)
        self.assertEqual((r["status"], r["bar_date"], r["bar_complete"]), ("OK", "2026-09-28", True))
        self.assertTrue(doc["all_rows_evaluable"])

    def test_stale_ticker_gets_no_gates(self):
        stale_end = dt.date(2025, 4, 10)
        code, doc = run({"SPY": series(SESSION, 300), "AAA": series(stale_end, 300)})
        self.assertEqual(code, 0)
        r = row(doc)
        self.assertEqual(r["status"], "STALE")
        self.assertFalse(r["bar_complete"])
        self.assertNotIn("gates", r)
        self.assertEqual((r["last_bar_date"], r["expected_bar_date"]), ("2025-04-10", "2026-09-28"))
        self.assertFalse(doc["all_rows_evaluable"])

    def test_ticker_one_session_behind_is_stale(self):
        code, doc = run({"SPY": series(SESSION, 300), "AAA": series(dt.date(2026, 9, 25), 300)})
        self.assertEqual(row(doc)["status"], "STALE")

    def test_stale_spy_fails_the_whole_run(self):
        # The reviewer's fixture: histories ending 2025-04-10 previously returned exit 0,
        # full grade and normal gates with last_completed_bar 2026-09-25.
        old = dt.date(2025, 4, 10)
        code, doc = run({"SPY": series(old, 300), "AAA": series(old, 300)})
        self.assertEqual(code, 3)
        self.assertEqual(doc["status"], "BENCHMARK_STALE")
        self.assertEqual(doc["spy_last_bar"], "2025-04-10")
        self.assertEqual(row(doc)["status"], "NOT_EVALUATED")
        self.assertNotIn("gates", row(doc))

    def test_missing_session_is_misaligned(self):
        bars = series(SESSION, 300)
        del bars[-10]
        code, doc = run({"SPY": series(SESSION, 300), "AAA": bars})
        r = row(doc)
        self.assertEqual(r["status"], "MISALIGNED")
        self.assertEqual(r["missing_count"], 1)

    def test_spy_gap_fails_the_run(self):
        spy = series(SESSION, 300)
        del spy[-3]
        code, doc = run({"SPY": spy, "AAA": series(SESSION, 300)})
        self.assertEqual((code, doc["status"]), (3, "BENCHMARK_MISALIGNED"))

    def test_grade_is_not_chart_evidence(self):
        for source, grade in (("opend", "broker"), ("yahoo", "public")):
            _, doc = run({"SPY": series(SESSION, 300), "AAA": series(SESSION, 300)}, source=source)
            self.assertEqual(doc["data_grade"], grade)
            self.assertIs(doc["chart_evidence"], False)
            self.assertEqual(doc["band_cap_without_chart"], "WATCH")
            self.assertNotIn("full", json.dumps(doc["data_grade"]))


class NonfiniteAndRiskB3(unittest.TestCase):
    """B3: NaN/infinity/zero inputs and nonpositive stop risk."""

    def bad(self, field, value, index=-1, ticker_only=True):
        bars = series(SESSION, 300)
        bars[index] = {**bars[index], field: value}
        return bars

    def test_invalid_ticker_bars_are_rejected(self):
        cases = [("c", float("nan")), ("c", float("inf")), ("h", float("-inf")), ("c", 0.0), ("l", -1.0),
                 ("v", -5.0), ("v", float("nan")), ("c", None), ("c", "101"), ("h", 1.0)]
        for field, value in cases:
            for index in (-1, -150):
                with self.subTest(field=field, value=value, index=index):
                    code, doc = run({"SPY": series(SESSION, 300), "AAA": self.bad(field, value, index)})
                    self.assertEqual(code, 0)
                    r = row(doc)
                    self.assertEqual(r["status"], "INVALID_DATA")
                    self.assertNotIn("gates", r)
                    json.dumps(doc, allow_nan=False)

    def test_nan_spy_fails_the_run(self):
        code, doc = run({"SPY": self.bad("c", float("nan")), "AAA": series(SESSION, 300)})
        self.assertEqual((code, doc["status"]), (3, "BENCHMARK_INVALID_DATA"))

    def test_main_refuses_nonstandard_json(self):
        with mock.patch.object(m, "run", lambda argv: (0, {"x": float("nan")})), \
                contextlib.redirect_stdout(io.StringIO()) as out, contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(m.main(["--tickers", "AAA"]), 4)
        self.assertEqual(out.getvalue(), "")

    def test_r2_rejects_nonfinite(self):
        for v in (float("nan"), float("inf"), float("-inf")):
            with self.assertRaises(ValueError):
                m.r2(v)

    def test_stop_at_or_above_close_is_invalid(self):
        for level in (95.0, 100.0):
            s = m.stop_candidate(100.0 if level == 95.0 else level, 95.0 if level == 95.0 else 100.0, 2.0)
            self.assertIs(s["valid"], False)
            self.assertIsNone(s["within_1_5_atr"])
            self.assertIsNone(s["risk_pct"])
        # Reviewer fixture: close 95, prior 21EMA 100 used to report risk -5.26% and within_1_5_atr true.
        s = m.stop_candidate(100.0, 95.0, 2.0)
        self.assertIs(s["valid"], False)

    def test_stop_risk_boundaries(self):
        self.assertIs(m.stop_candidate(97.0, 100.0, 2.0)["within_1_5_atr"], True)    # exactly 1.5 ATR
        self.assertIs(m.stop_candidate(96.99, 100.0, 2.0)["within_1_5_atr"], False)  # just over
        self.assertIs(m.stop_candidate(99.99, 100.0, 2.0)["valid"], True)            # tiny positive risk
        self.assertIsNone(m.stop_candidate(97.0, 100.0, 0.0))                         # no ATR, no candidate
        self.assertIsNone(m.stop_candidate(None, 100.0, 2.0))

    def test_close_below_prior_ema_marks_that_stop_invalid(self):
        bars = series(SESSION, 300, step=0.5)
        last = bars[-1]
        drop = bars[-2]["c"] - 12
        bars[-1] = {**last, "o": bars[-2]["c"], "c": drop, "h": bars[-2]["c"] + 0.1, "l": drop - 0.2}
        _, doc = run({"SPY": series(SESSION, 300), "AAA": bars})
        r = row(doc)
        self.assertEqual(r["status"], "OK")
        ema = r["stop_candidates"]["prior_21ema"]
        self.assertIs(ema["valid"], False)
        self.assertIsNone(ema["within_1_5_atr"])
        for name, cand in r["stop_candidates"].items():
            if cand["valid"]:
                self.assertGreater(cand["risk_pct"], 0, name)

    def test_uncomputable_inputs_are_unknown_not_pass(self):
        bars = series(SESSION, 300)
        c = bars[-1]["c"]
        bars[-1] = {**bars[-1], "o": c, "h": c, "l": c}  # zero range: close strength undefined
        for b in bars[-21:-1]:
            b["v"] = 0.0  # zero 20-day average: RVOL undefined
        _, doc = run({"SPY": series(SESSION, 300), "AAA": bars})
        g = row(doc)["gates"]
        self.assertEqual(g["close_strength"], "UNKNOWN")
        self.assertEqual(g["volume_trigger"], "UNKNOWN")


class SessionCalendarB4(unittest.TestCase):
    """B4: holidays, early closes, finalization and close-crossing requests."""

    def at(self, y, mo, d, h, mi=0):
        return dt.datetime(y, mo, d, h, mi, tzinfo=ET)

    def test_expected_session(self):
        cases = [
            (self.at(2026, 11, 27, 12, 30), "2026-11-25"),  # early-close day, still open; 11-26 Thanksgiving
            (self.at(2026, 11, 27, 13, 10), "2026-11-25"),  # closed 13:00 but not yet final
            (self.at(2026, 11, 27, 13, 25), "2026-11-27"),  # final after the 13:00 close
            (self.at(2026, 12, 24, 15, 0), "2026-12-24"),   # Christmas Eve early close
            (self.at(2026, 12, 28, 10, 0), "2026-12-24"),   # Christmas Friday holiday
            (self.at(2026, 4, 6, 9, 0), "2026-04-02"),      # Monday after Good Friday
            (self.at(2026, 7, 6, 8, 0), "2026-07-02"),      # Independence Day observed Friday 07-03
            (self.at(2026, 9, 28, 16, 10), "2026-09-25"),   # after the bell, before finalization
            (self.at(2026, 9, 28, 16, 20), "2026-09-28"),   # finalization boundary is inclusive
            (self.at(2026, 9, 27, 12, 0), "2026-09-25"),    # Sunday
            (self.at(2025, 1, 10, 8, 0), "2025-01-08"),     # special closure 2025-01-09
            (self.at(2022, 1, 3, 9, 0), "2021-12-31"),      # Saturday New Year not observed on Dec 31
            # MYT input: 04:15 MYT is 16:15 ET (not final yet), 04:25 MYT is 16:25 ET (final)
            (dt.datetime(2026, 9, 29, 4, 15, tzinfo=dt.timezone(dt.timedelta(hours=8))), "2026-09-25"),
            (dt.datetime(2026, 9, 29, 4, 25, tzinfo=dt.timezone(dt.timedelta(hours=8))), "2026-09-28"),
        ]
        for now, want in cases:
            with self.subTest(now=now.isoformat()):
                self.assertEqual(m.expected_last_completed(now).isoformat(), want)

    def test_holidays_and_early_closes(self):
        self.assertFalse(m.is_session(dt.date(2026, 4, 3)))
        self.assertFalse(m.is_session(dt.date(2026, 7, 3)))
        self.assertFalse(m.is_session(dt.date(2026, 6, 19)))
        self.assertTrue(m.is_session(dt.date(2021, 6, 18)))       # before Juneteenth became a holiday
        self.assertTrue(m.is_early_close(dt.date(2025, 7, 3)))
        self.assertFalse(m.is_early_close(dt.date(2026, 7, 2)))    # 07-03 is the observed holiday
        self.assertTrue(m.is_early_close(dt.date(2026, 11, 27)))
        self.assertFalse(m.is_session(dt.date(2027, 12, 24)))      # Christmas Saturday, observed Friday

    def test_close_crossing_request_keeps_todays_bar_partial(self):
        # The request starts at 15:59:50 ET and returns after the close with a bar dated today.
        ticks = iter([self.at(2026, 9, 28, 15, 59) + dt.timedelta(seconds=50), self.at(2026, 9, 28, 16, 45)])
        bars = {"SPY": series(SESSION, 301), "AAA": series(SESSION, 301)}
        code, doc = run(bars, now=lambda: next(ticks))
        self.assertEqual(code, 0)
        self.assertEqual(doc["expected_last_completed_session"], "2026-09-25")
        r = row(doc)
        self.assertEqual(r["bar_date"], "2026-09-25")
        self.assertEqual(r["live_partial_bar"]["date"], "2026-09-28")
        self.assertIn("UNFINISHED", r["live_partial_bar"]["note"])

    def test_bar_on_a_holiday_is_invalid(self):
        bars = series(SESSION, 300)
        i = next(i for i, b in enumerate(bars) if b["d"] > "2026-04-03")
        bars.insert(i, {**bars[i - 1], "d": "2026-04-03"})
        _, doc = run({"SPY": series(SESSION, 300), "AAA": bars})
        self.assertEqual(row(doc)["status"], "INVALID_DATA")

    def test_short_history_discloses_and_does_not_claim_52_week_high(self):
        _, doc = run({"SPY": series(SESSION, 300), "AAA": series(SESSION, 100)})
        r = row(doc)
        self.assertEqual(r["status"], "OK")
        self.assertIsNone(r["off_52w_high_pct"])
        self.assertEqual(r["gates"]["proximity"], "UNKNOWN")
        self.assertEqual((r["history_bars"], r["high_lookback_bars"]), (100, 100))
        self.assertIn("not a 52-week high", r["high_note"])
        _, doc = run({"SPY": series(SESSION, 300), "AAA": series(SESSION, 260)})
        r = row(doc)
        self.assertIsNotNone(r["off_52w_high_pct"])
        self.assertIn(r["gates"]["proximity"], ("PASS", "FAIL"))
        self.assertEqual(r["high_lookback_bars"], 252)

    def test_too_little_history_is_not_measured(self):
        _, doc = run({"SPY": series(SESSION, 300), "AAA": series(SESSION, 59)})
        self.assertEqual(row(doc)["status"], "INSUFFICIENT_HISTORY")

    def test_unsorted_dates_are_invalid(self):
        bars = series(SESSION, 300)
        bars[-1], bars[-2] = bars[-2], bars[-1]
        _, doc = run({"SPY": series(SESSION, 300), "AAA": bars})
        self.assertEqual(row(doc)["status"], "INVALID_DATA")


class Unknowns(unittest.TestCase):
    def test_unknown_symbol_is_reported(self):
        code, doc = run({"SPY": series(SESSION, 300)}, argv=["--tickers", "ZZZZ", "--source", "opend"])
        self.assertEqual((code, row(doc, "ZZZZ")["status"]), (0, "NO_DATA"))

    def test_missing_spy_exits_2(self):
        with contextlib.redirect_stderr(io.StringIO()):
            code, doc = run({"AAA": series(SESSION, 300)})
        self.assertEqual((code, doc), (2, None))

    def test_all_numbers_finite(self):
        _, doc = run({"SPY": series(SESSION, 300), "AAA": series(SESSION, 300)})

        def walk(v):
            if isinstance(v, float):
                self.assertTrue(math.isfinite(v))
            elif isinstance(v, dict):
                for x in v.values():
                    walk(x)
            elif isinstance(v, list):
                for x in v:
                    walk(x)
        walk(doc)


if __name__ == "__main__":
    unittest.main()
