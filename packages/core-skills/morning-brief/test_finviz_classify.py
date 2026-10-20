"""Regression tests for the Finviz scraper behind preflight's `themes` and `universe`.

Run either way:
    python -m pytest test_finviz_classify.py
    python -m unittest test_finviz_classify

Background
----------
On 2026-10-20 preflight's hard `themes` check reported "only 0 industries parsed" and
`universe` reported 72 of 80 tickers unclassified. Finviz had not changed its markup.
Since 2026-09-30 every finviz.com URL has answered python-requests with Cloudflare's
"Just a moment..." challenge (HTTP 403, cf-mitigated: challenge). The scraper never
checked the status, regex-scanned the challenge page and found nothing. classify()
then cached each blocked lookup as a null record over the good one.

`tests/finviz_groups_industry_2026-10-20.html` keeps the real groups page's data
script verbatim, captured in a browser that day.
`tests/finviz_cloudflare_challenge_2026-10-20.html` is the challenge page that
python-requests received, with its tokens redacted. Do not regenerate either fixture
to make a failing test pass.
"""
import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest import mock

import finviz_classify as fc
import preflight

TESTS = Path(__file__).parent / "tests"
GROUPS_HTML = (TESTS / "finviz_groups_industry_2026-10-20.html").read_text(encoding="utf-8")
CHALLENGE_HTML = (TESTS / "finviz_cloudflare_challenge_2026-10-20.html").read_text(encoding="utf-8")
QUOTE_HTML = (
    '<a class="quote-header_category" href="screener.ashx?v=111&f=sec_technology">Technology</a>'
    '<a class="quote-header_category" href="screener.ashx?v=111&f=ind_softwareinfrastructure">'
    'Software - Infrastructure</a>'
    '<a class="quote-header_category" href="screener.ashx?v=111&f=geo_usa">USA</a>'
)


def response(status: int, text: str, headers: dict | None = None) -> mock.Mock:
    return mock.Mock(status_code=status, text=text, headers=headers or {})


CHALLENGE = response(403, CHALLENGE_HTML, {"server": "cloudflare", "cf-mitigated": "challenge"})


class GroupsPageParserTests(unittest.TestCase):
    def test_real_page_parses_every_industry(self):
        rows = fc.parse_industry_performance(GROUPS_HTML)
        self.assertEqual(len(rows), 144)
        self.assertGreater(len(rows), preflight.MIN_INDUSTRIES)
        self.assertEqual(len({r["industry"] for r in rows}), 144)

    def test_rows_rank_by_one_month_performance(self):
        rows = fc.parse_industry_performance(GROUPS_HTML)
        perf = [r["perf_1m"] for r in rows]
        self.assertEqual(perf, sorted(perf, reverse=True))
        self.assertEqual((rows[0]["industry"], rows[0]["perf_1m"]),
                         ("Business Equipment & Supplies", 15.6))

    def test_fields_and_escaped_labels_decode(self):
        by = {r["industry"]: r for r in fc.parse_industry_performance(GROUPS_HTML)}
        self.assertIn("Aerospace & Defense", by)        # & in the page JSON
        self.assertIn("Oil & Gas E&P", by)
        self.assertEqual(by["Consulting Services"], {
            "industry": "Consulting Services", "slug": "consultingservices",
            "perf_1d": 4.6, "perf_1w": 10.12, "perf_1m": 8.64, "perf_3m": 5.24,
        })

    def test_challenge_page_is_named_as_a_bot_check(self):
        with self.assertRaises(fc.FinvizUnavailable) as ctx:
            fc.parse_industry_performance(CHALLENGE_HTML)
        self.assertEqual(ctx.exception.kind, "bot_check")

    def test_page_without_group_json_is_a_markup_change(self):
        html = "<html><head><title>Group Screener</title></head><body><table></table></body></html>"
        with self.assertRaises(fc.FinvizUnavailable) as ctx:
            fc.parse_industry_performance(html)
        self.assertEqual(ctx.exception.kind, "markup")
        self.assertIn("Group Screener", str(ctx.exception))


class FetchTests(unittest.TestCase):
    def test_403_challenge_raises_a_bot_check_instead_of_an_empty_list(self):
        with mock.patch.object(fc.requests, "get", return_value=CHALLENGE):
            with self.assertRaises(fc.FinvizUnavailable) as ctx:
                fc.industry_performance()
        self.assertEqual(ctx.exception.kind, "bot_check")
        self.assertIn("HTTP 403", str(ctx.exception))
        self.assertIn("cf-mitigated=challenge", str(ctx.exception))

    def test_other_http_errors_name_the_status(self):
        with mock.patch.object(fc.requests, "get", return_value=response(500, "oops")):
            with self.assertRaises(fc.FinvizUnavailable) as ctx:
                fc.industry_performance()
        self.assertEqual(ctx.exception.kind, "http")
        self.assertIn("HTTP 500", str(ctx.exception))

    def test_network_errors_are_named(self):
        with mock.patch.object(fc.requests, "get",
                               side_effect=fc.requests.ConnectionError("refused")):
            with self.assertRaises(fc.FinvizUnavailable) as ctx:
                fc.industry_performance()
        self.assertEqual(ctx.exception.kind, "network")

    def test_served_page_parses(self):
        with mock.patch.object(fc.requests, "get", return_value=response(200, GROUPS_HTML)):
            self.assertEqual(len(fc.industry_performance()), 144)


class ClassifyCacheTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.cache = Path(tmp.name) / "finviz_cache.json"
        patcher = mock.patch.object(fc, "CACHE", self.cache)
        patcher.start()
        self.addCleanup(patcher.stop)

    def write(self, data: dict) -> None:
        self.cache.write_text(json.dumps(data), encoding="utf-8")

    def test_bot_check_never_overwrites_a_good_record(self):
        self.write({"OKTA": {"sector": "Technology", "industry": "Software - Infrastructure",
                             "country": "USA", "fetched_at": "2026-09-10T22:18:54"}})
        before = self.cache.read_bytes()
        with mock.patch.object(fc.requests, "get", return_value=CHALLENGE) as get:
            out = fc.classify(["OKTA", "FFIV", "CRWD"], throttle=0)
        self.assertEqual(self.cache.read_bytes(), before)
        self.assertEqual(out["OKTA"]["industry"], "Software - Infrastructure")
        self.assertIn("Cloudflare bot-check", out["OKTA"]["error"])
        self.assertIsNone(out["FFIV"]["industry"])
        self.assertTrue(out["CRWD"]["error"].startswith("skipped after Cloudflare bot-check"))
        self.assertEqual(get.call_count, 1, "every Finviz URL is challenged; stop after one")

    def test_cached_null_record_is_a_miss_not_an_answer(self):
        self.write({"OKTA": {"sector": None, "industry": None, "country": None,
                             "fetched_at": datetime.now().isoformat()}})
        with mock.patch.object(fc.requests, "get", return_value=response(200, QUOTE_HTML)):
            out = fc.classify(["OKTA"], throttle=0)
        self.assertEqual(out["OKTA"], {"sector": "Technology",
                                       "industry": "Software - Infrastructure",
                                       "country": "USA"})
        self.assertEqual(json.loads(self.cache.read_text(encoding="utf-8"))["OKTA"]["industry"],
                         "Software - Infrastructure")

    def test_quote_page_without_categories_is_named_and_not_cached(self):
        with mock.patch.object(fc.requests, "get", return_value=response(200, "<html></html>")):
            out = fc.classify(["ZZZZ"], throttle=0)
        self.assertIsNone(out["ZZZZ"]["industry"])
        self.assertIn("no sector/industry links", out["ZZZZ"]["error"])
        self.assertFalse(self.cache.exists())


class PreflightGateTests(unittest.TestCase):
    def test_themes_check_names_the_bot_check(self):
        with mock.patch.object(fc.requests, "get", return_value=CHALLENGE):
            result = preflight.check_themes()
        self.assertFalse(result["ok"])
        self.assertTrue(result["hard"])
        self.assertEqual(result["reason"], "bot_check")
        self.assertIn("Cloudflare bot-check", result["detail"])
        self.assertNotIn("only 0 industries", result["detail"])

    def test_themes_check_passes_on_the_real_page(self):
        with mock.patch.object(fc.requests, "get", return_value=response(200, GROUPS_HTML)):
            result = preflight.check_themes()
        self.assertTrue(result["ok"])
        self.assertEqual(result["count"], 144)
        self.assertEqual(result["top"][0]["industry"], "Business Equipment & Supplies")

    def test_universe_check_names_the_lookup_failure(self):
        blocked = "Cloudflare bot-check on https://finviz.com/quote.ashx?t=OKTA (HTTP 403)"
        cls = {
            "OKTA": {"sector": "Technology", "industry": "Software - Infrastructure",
                     "country": "USA", "error": blocked},
            "FFIV": {"sector": None, "industry": None, "country": None, "error": blocked},
        }
        with mock.patch.object(fc, "universe", return_value=["FFIV", "OKTA"]), \
                mock.patch.object(fc, "classify", return_value=cls):
            result = preflight.check_universe({"tickers": ["OKTA"]})
        self.assertTrue(result["ok"])
        self.assertEqual(result["unclassified"], ["FFIV"])
        self.assertEqual(result["stale_classified"], 1)
        self.assertIn("Cloudflare bot-check", result["detail"])
        self.assertNotIn("scraper suspect", result["detail"])


if __name__ == "__main__":
    unittest.main()
