"""Offline tests for tools/screener.py: live TradingView hits, printed only, no secrets.

The network call is replaced by a fake `send`, so no request leaves the machine.

    python -m unittest discover -s packages/bot-box/tests -p "test_screener.py" -v
"""
from __future__ import annotations

import ast
import contextlib
import importlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
import urllib.error

TOOLS = Path(__file__).resolve().parents[1] / "tools"
# Mutation checks point this at a folder of weakened copies; the real tool is never edited.
TOOLS = Path(os.environ.get("SCREENER_UNDER_TEST") or TOOLS)
CANONICAL = Path(__file__).resolve().parents[3] / "apps/market_dashboard_backend/scripts/tv-screeners.json"
COLUMNS = ["name", "close", "change", "volume", "relative_volume_10d_calc", "sector", "industry"]
CONFIG = {"columns_to_fetch": COLUMNS,
          "screeners": [{"id": "top-gainer", "name": "Top gainers", "query": {"range": [0, 50]}},
                        {"id": "vcp-200ma", "name": "VCP", "query": {"range": [0, 50]}}]}


def row(symbol, close):
    return {"s": symbol, "d": ["Corp", close, 5.5, 1e6, 2.1, "Technology", "Semiconductors"]}


class Screener(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(TOOLS))
        cls.tool = importlib.import_module("screener")

    @classmethod
    def tearDownClass(cls):
        sys.path.remove(str(TOOLS))
        sys.modules.pop("screener", None)

    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.config = Path(temp.name) / "tv-screeners.json"
        self.config.write_text(json.dumps(CONFIG), encoding="utf-8")
        self.sent = []
        self.tool.RETRY_SECONDS = 0

    def run_tool(self, *args, send=None):
        def default(body):
            self.sent.append(body)
            return {"data": [row("NASDAQ:NVDA", 110.0), row("NYSE:ANET", 90.0), row("AMEX:SPY", 500.0)]}
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            buffer = io.BytesIO()
            real = sys.stdout
            sys.stdout = type("S", (), {"buffer": buffer, "write": real.write, "flush": lambda s: None})()
            try:
                code = self.tool.main(["--config", str(self.config), *args], send=send or default)
            finally:
                sys.stdout = real
        return code, json.loads(buffer.getvalue().decode("utf-8"))

    def test_all_screeners_print_mapped_hits_with_the_configured_query(self):
        code, report = self.run_tool("--limit", "2")
        self.assertEqual((code, report["status"]), (0, "OK"))
        first = report["screeners"][0]
        self.assertEqual((first["id"], first["total"], len(first["hits"])), ("top-gainer", 3, 2))
        self.assertEqual(first["hits"][0], {"ticker": "NVDA", "exchange": "NASDAQ", "name": "Corp", "close": 110.0,
                                            "change_pct": 5.5, "volume": 1e6, "relative_volume": 2.1,
                                            "sector": "Technology", "industry": "Semiconductors"})
        self.assertEqual(self.sent[0], {"range": [0, 50], "columns": COLUMNS})

    def test_one_screener_by_id_and_unknown_ids_are_refused(self):
        code, report = self.run_tool("--screener", "vcp-200ma")
        self.assertEqual([s["id"] for s in report["screeners"]], ["vcp-200ma"])
        self.assertEqual(len(self.sent), 1)
        code, report = self.run_tool("--screener", "nope")
        self.assertEqual((code, report["status"]), (2, "UNKNOWN_SCREENER"))
        self.assertEqual(report["available"], ["top-gainer", "vcp-200ma"])

    def test_a_failed_screener_does_not_hide_the_others(self):
        def flaky(body):
            self.sent.append(body)
            if len(self.sent) <= 2:                 # first screener: 503 then 403
                raise urllib.error.HTTPError("u", 503 if len(self.sent) == 1 else 403, "x", {}, None)
            return {"data": [row("NASDAQ:NVDA", 110.0)]}
        code, report = self.run_tool(send=flaky)
        self.assertEqual((code, report["status"]), (0, "PARTIAL"))
        self.assertEqual([(s["status"], len(s["hits"])) for s in report["screeners"]], [("HTTP_403", 0), ("OK", 1)])

    def test_every_screener_failing_is_unavailable(self):
        def down(body):
            raise urllib.error.URLError("offline")
        code, report = self.run_tool(send=down)
        self.assertEqual((code, report["status"]), (3, "UNAVAILABLE"))
        self.assertTrue(all(s["hits"] == [] for s in report["screeners"]))

    def test_no_cookie_secret_or_file_write(self):
        self.assertNotIn("Cookie", self.tool.HEADERS)
        source = (TOOLS / "screener.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        names = {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)} | \
                {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}
        for forbidden in ("environ", "getenv", "write_text", "write_bytes", "open", "deepseek", "call_deepseek_json"):
            self.assertNotIn(forbidden, names, forbidden)
        self.assertNotIn(".env", source.replace("repository .env", ""))

    def test_canonical_config_has_the_fields_the_tool_uses(self):
        config = json.loads(CANONICAL.read_text(encoding="utf-8"))
        self.assertTrue(config["screeners"])
        for screener in config["screeners"]:
            self.assertTrue(screener["id"] and isinstance(screener["query"], dict))
        self.assertIn("close", config["columns_to_fetch"])


if __name__ == "__main__":
    unittest.main()
