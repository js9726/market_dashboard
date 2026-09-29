"""Offline tests for the DeepSeek pre-open brief path: the live data block, DeepSeek's
fallback when it answers with a tool call, the Discord post, and the late-run skip gate.
No network, provider or Discord call is made.

    cd apps/market_dashboard_backend && python -m unittest scripts.test_brief_pipeline -v
"""
from __future__ import annotations

import contextlib
import datetime as dt
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
import urllib.error
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import brief_live_data  # noqa: E402
import brief_ran_today  # noqa: E402
import post_brief_discord as pbd  # noqa: E402

ET = pbd.ET
NOW = dt.datetime(2026, 9, 30, 9, 5, tzinfo=ET)            # Wednesday, before the open
WEBHOOK_URL = "https://discord.com/api/webhooks/123456789012345678/" + "A" * 68


def write(d: Path, name: str, obj) -> None:
    (d / name).write_text(json.dumps(obj), encoding="utf-8")


SNAPSHOT = {"built_at": "2026-09-29T20:02:15Z",
            "groups": {"Indices": [{"ticker": "SPY", "daily": -0.75, "5d": -1.0, "20d": -0.25, "rs": 65, "abc": "A"}],
                       "Sel Sectors": [{"ticker": "XLK", "daily": -0.89, "5d": -0.16, "20d": 4.88, "rs": 90, "abc": "A"}],
                       "Industries": []},
            "industry_performance": {"top5": [{"industry": "Lodging", "perf_1d": "1.9%", "perf_1w": "3.9%",
                                               "perf_1m": "-1.4%"}]},
            "breadth": {"above_200sma_pct": 50.6, "near_52w_high_pct": 32.9, "tickers_sampled": 79},
            "fear_greed": {"value": 33.6, "label": "fear", "status": "ok", "as_of": "2026-09-29T19:55:39+00:00"}}
TECH = {"SPY": {"symbol": "SPY", "close": 111.11, "date": "2026-09-29 00:00:00", "atr14": 6.5, "dist_21_atr": 0.32,
                "dist_50_atr": 1.01, "rsi14": 52.6, "macd_dir": "FALLING", "entry_risk": "FAIR", "curving_down": True}}
TV = {"fetched_at": "2026-09-29T20:12:56Z", "market_was_open": False,
      "screeners": [{"id": "top-gainer", "name": "Top Gainer",
                     "hits": [{"ticker": "PANW", "close": 393.38, "change": 4.98, "relative_volume_10d_calc": 0.63,
                               "industry": "Packaged Software", "score": 52}]}]}
BRIEF = {"mood": {"label": "CHOPPY", "posture": "WAIT", "summary": "Indices slipped; breadth weak."},
         "alert": None,
         "indices": [{"symbol": "SPY", "name": "S&P 500", "level": 765.61, "changePct": -0.75},
                     {"symbol": "QQQ", "level": None, "changePct": -1.07}],
         "fearGreed": {"score": 34, "label": "Fear"}, "breadth": {"up": 120, "down": 380},
         "technicalsNarrative": "SPY fair; QQQ extended.",
         "sectorsThemes": [{"symbol": "XLK", "changePct": -0.89}, {"symbol": "XLV", "changePct": 0.33},
                           {"symbol": "XLF", "changePct": -1.17}, {"symbol": "XLE", "changePct": 0.12},
                           {"symbol": "XLY", "changePct": -1.42}],
         "standout": {"ticker": "PANW", "side": "LONG", "score": 72, "grade": None, "thesis": "Breakout @everyone",
                      "entry": 394, "stop": 380, "target": 420, "rrr": 1.9},
         "watchlist": [{"ticker": "NVDA", "level": 228.86, "changePct": -1.2, "abc": "A", "note": "holding 21EMA"},
                       {"ticker": "TSLA", "level": None, "changePct": None, "note": "no live price supplied"}],
         "earnings": {"bmo": [{"ticker": "NKE"}], "amc": [{"ticker": "MU"}], "yesterdayReactions": []},
         "calendar": [{"time": "10:00", "event": "Consumer confidence"}], "movers": []}


def meta(built_at="2026-09-30T13:02:00+00:00", generated=True):
    return {"built_at": built_at, "providers": {"deepseek": {"generated": generated}, "gemini": {"generated": True}}}


class LiveDataBlock(unittest.TestCase):
    def test_block_carries_this_runs_data_with_as_of_times(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            write(d, "snapshot.json", SNAPSHOT)
            write(d, "index_technicals.json", TECH)
            write(d, "tv_screeners.json", TV)
            block = brief_live_data.build_live_data_block(d)
        for needle in ("DATA AS OF 2026-09-29T20:02:15Z", "Fear & Greed Index: 34/100", "SPY", "XLK",
                       "INDEX TECHNICALS", "close 111.11", "ENTRY_RISK=FAIR", "MACD-CURVING-DOWN",
                       "TV SCREENER HITS (fetched 2026-09-29T20:12:56Z", "PANW 393.38", "score 52", "Lodging",
                       "NOT a reason to block new entries"):
            self.assertIn(needle, block)

    def test_technicals_come_only_from_the_run_data_folder(self):
        with tempfile.TemporaryDirectory() as d:
            write(Path(d), "snapshot.json", SNAPSHOT)
            block = brief_live_data.build_live_data_block(d)
        self.assertNotIn("INDEX TECHNICALS", block)       # the skill folder's old copy is never read
        self.assertNotIn("765.99", block)

    def test_no_data_gives_an_empty_block(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(brief_live_data.build_live_data_block(d), "")

    def test_block_is_bounded(self):
        big = dict(TV, screeners=[{"id": "s%d" % i, "name": "S%d" % i, "hits": TV["screeners"][0]["hits"] * 5}
                                  for i in range(300)])
        with tempfile.TemporaryDirectory() as d:
            write(Path(d), "snapshot.json", SNAPSHOT)
            write(Path(d), "tv_screeners.json", big)
            block = brief_live_data.build_live_data_block(d)
        self.assertLessEqual(len(block), brief_live_data.MAX_CHARS + 60)
        self.assertIn("truncated", block)


class DeepSeekFallback(unittest.TestCase):
    def setUp(self):
        import morning_brief
        self.mb = morning_brief
        self.env = mock.patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test-not-a-key"})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.sleep = mock.patch.object(morning_brief.time, "sleep", lambda s: None)
        self.sleep.start()
        self.addCleanup(self.sleep.stop)

    def run_with(self, answers):
        calls = []

        def fake(prompt, web_search, max_output_tokens, instructions=None):
            calls.append(web_search)
            self.assertEqual(max_output_tokens, 32000 if web_search else 8192)
            self.assertEqual(instructions is None, web_search)        # no-web attempts say so
            if instructions:
                self.assertIn("NO web access", instructions)
            return answers[len(calls) - 1]
        with tempfile.TemporaryDirectory() as d, contextlib.redirect_stdout(io.StringIO()):
            ok = self.mb.generate_deepseek("prompt", d, call=fake)
            written = (Path(d) / "morning_brief_deepseek.json").exists()
        return ok, written, calls

    def test_tool_call_answer_retries_without_web_search(self):
        tool_call = '{"name": "WebSearch", "arguments": {"query": "futures"}}\n{"name": "WebSearch"}'
        ok, written, calls = self.run_with([tool_call, json.dumps(BRIEF)])
        self.assertEqual((ok, written, calls), (True, True, [True, False]))

    def test_single_tool_call_object_is_not_a_brief(self):
        ok, written, calls = self.run_with(['{"name": "WebSearch", "arguments": {}}', "not json", json.dumps(BRIEF)])
        self.assertEqual((ok, calls), (True, [True, False, False]))

    def test_three_bad_answers_write_nothing(self):
        ok, written, calls = self.run_with(["x", '{"a": 1}', "[]"])
        self.assertEqual((ok, written, len(calls)), (False, False, 3))


class DiscordPost(unittest.TestCase):
    def data_dir(self, brief=BRIEF, m=None):
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        p = Path(d.name)
        write(p, "morning_brief_meta.json", m or meta())
        if brief is not None:
            write(p, "morning_brief_deepseek.json", brief)
        write(p, "snapshot.json", SNAPSHOT)
        return p

    def test_full_brief_message(self):
        state, payload = pbd.build(self.data_dir(), NOW)
        self.assertEqual(state, "ok")
        self.assertEqual(payload["allowed_mentions"], {"parse": []})
        e = payload["embeds"][0]
        self.assertIn("Wed 30 Sep 2026", e["title"])
        self.assertIn("CHOPPY", e["description"])
        names = [f["name"] for f in e["fields"]]
        for n in ("Indices", "Sentiment", "Technicals", "Sectors (best / worst)", "Standout", "Watchlist", "Earnings",
                  "Calendar"):
            self.assertIn(n, names)
        idx = next(f for f in e["fields"] if f["name"] == "Indices")["value"]
        self.assertIn("765.61", idx)
        self.assertIn("-0.75%", idx)
        self.assertNotIn("after the US open", e["description"])
        self.assertIn("market data as of 2026-09-29 20:02 UTC", e["footer"]["text"])
        self.assertLessEqual(pbd.embed_size(e), 6000)
        standout = next(f for f in e["fields"] if f["name"] == "Standout")["value"]
        self.assertNotIn("None", standout)
        watch = next(f for f in e["fields"] if f["name"] == "Watchlist")["value"]
        self.assertIn("NVDA", watch)
        self.assertNotIn("TSLA", watch)                     # no price, no move: left out
        for f in e["fields"]:
            self.assertLessEqual(len(f["value"]), 1024)

    def test_alert_warning_sign_is_not_doubled(self):
        state, payload = pbd.build(self.data_dir(brief=dict(BRIEF, alert="⚠ Risk high")), NOW)
        self.assertEqual(payload["embeds"][0]["description"].count("⚠"), 1)

    def test_late_brief_is_labelled(self):
        state, payload = pbd.build(self.data_dir(m=meta("2026-09-30T17:40:00+00:00")), NOW.replace(hour=14))
        self.assertIn("after the US open", payload["embeds"][0]["description"])

    def test_stale_or_failed_brief_is_never_posted_as_today(self):
        cases = [meta(generated=False), meta("2026-09-29T13:02:00+00:00")]      # failed today; yesterday's file
        for m in cases:
            with self.subTest(m=m):
                state, payload = pbd.build(self.data_dir(m=m), NOW)
                self.assertEqual(state, "failed")
                self.assertNotIn("embeds", payload)
                self.assertIn("not available", payload["content"])

    def test_brief_without_market_data_gets_a_notice(self):
        empty = dict(BRIEF, indices=[{"symbol": "SPY", "level": None, "changePct": None}],
                     alert="DATA UNAVAILABLE - no live feed")
        state, payload = pbd.build(self.data_dir(brief=empty), NOW)
        self.assertEqual(state, "no_data")
        self.assertIn("without market data", payload["content"])

    def test_huge_fields_stay_within_discord_limits(self):
        big = dict(BRIEF, technicalsNarrative="x " * 5000, sectorsNarrative="y " * 5000,
                   watchlist=[{"ticker": "T%d" % i, "note": "z " * 500} for i in range(50)],
                   mood=dict(BRIEF["mood"], summary="s " * 5000))
        state, payload = pbd.build(self.data_dir(brief=big), NOW)
        e = payload["embeds"][0]
        self.assertLessEqual(pbd.embed_size(e), 6000)
        self.assertLessEqual(len(e["description"]), 4096)

    def run_main(self, env, opener=None, args=()):
        d = self.data_dir()
        out = io.StringIO()
        with mock.patch.dict(os.environ, env, clear=False), contextlib.redirect_stdout(out):
            code = pbd.main(["--data-dir", str(d), *args], now=NOW, opener=opener or self.fail_opener)
        return code, out.getvalue()

    def fail_opener(self, *a, **k):
        raise AssertionError("no post expected")

    def test_no_webhook_posts_nothing(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("DISCORD_BRIEF_WEBHOOK_URL", None)
            code, out = self.run_main({})
        self.assertEqual(code, 0)
        self.assertIn("not set", out)

    def test_bad_webhook_is_refused_and_not_printed(self):
        code, out = self.run_main({"DISCORD_BRIEF_WEBHOOK_URL": "https://evil.example/api/webhooks/1/x"})
        self.assertEqual(code, 1)
        self.assertNotIn("evil.example", out)

    def test_successful_post_and_rate_limit_retry(self):
        sent = []

        class Resp:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        def opener(request, timeout):
            sent.append(json.loads(request.data))
            if len(sent) == 1:
                raise urllib.error.HTTPError(request.full_url, 429, "slow down", {},
                                             io.BytesIO(b'{"retry_after": 0.01}'))
            self.assertTrue(request.full_url.endswith("?wait=true"))
            return Resp()
        code, out = self.run_main({"DISCORD_BRIEF_WEBHOOK_URL": WEBHOOK_URL}, opener=opener)
        self.assertEqual((code, len(sent)), (0, 2))
        self.assertEqual(sent[1]["allowed_mentions"], {"parse": []})
        self.assertNotIn(WEBHOOK_URL, out)

    def test_failed_post_exits_1_without_printing_the_url(self):
        def opener(request, timeout):
            raise urllib.error.HTTPError(request.full_url, 404, "Unknown Webhook", {}, io.BytesIO(b"{}"))
        code, out = self.run_main({"DISCORD_BRIEF_WEBHOOK_URL": WEBHOOK_URL}, opener=opener)
        self.assertEqual(code, 1)
        self.assertIn("HTTP 404", out)
        self.assertNotIn("webhooks", out)

    def test_dry_run_prints_the_message(self):
        code, out = self.run_main({}, args=("--dry-run",))
        self.assertEqual(code, 0)
        self.assertIn('"embeds"', out)


class SkipGate(unittest.TestCase):
    def test_decisions(self):
        cases = [
            ("workflow_dispatch", meta(), False),                              # dispatched runs always proceed
            ("schedule", meta("2026-09-30T13:02:00+00:00"), True),             # 09:02 ET today already ran
            ("schedule", meta("2026-09-29T20:13:00+00:00"), False),            # yesterday's late run
            ("schedule", meta("2026-09-30T06:00:00+00:00"), False),            # 02:00 ET: not this morning's
            ("schedule", None, False),
        ]
        for event, m, want in cases:
            with self.subTest(event=event, m=m):
                self.assertEqual(brief_ran_today.decide(event, m, NOW.replace(hour=14))[0], want)

    def test_writes_github_output(self):
        with tempfile.TemporaryDirectory() as d:
            m, out = Path(d) / "meta.json", Path(d) / "out.txt"
            m.write_text(json.dumps(meta("2026-09-30T13:02:00+00:00")), encoding="utf-8")
            with mock.patch.dict(os.environ, {"GITHUB_OUTPUT": str(out)}), contextlib.redirect_stdout(io.StringIO()):
                brief_ran_today.main(["--event", "schedule", "--meta", str(m)], now=NOW.replace(hour=14))
            self.assertEqual(out.read_text(encoding="utf-8"), "skip=true\n")


if __name__ == "__main__":
    unittest.main()
