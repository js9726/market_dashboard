"""Offline transport/publication regressions without provider imports or credentials."""
import argparse
import ast
import datetime
import io
import json
import os
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import Mock, patch


class ScreenerFetchStatus(unittest.TestCase):
    def setUp(self):
        # Compile the actual two entry points, bypassing module-level env/provider setup.
        path = Path(__file__).with_name("tv_screener_fetch.py")
        tree = ast.parse(path.read_text(encoding="utf-8"))
        tree.body = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in ("fetch_screener", "main")]
        self.ns = dict(globals(), SCANNER_URL="https://example.invalid/scan", HEADERS={}, _MAX_RETRIES=1, _RETRY_DELAY=0)
        exec(compile(tree, str(path), "exec"), self.ns)
        self.config = {"id": "test", "name": "Test", "query": {}}

    def test_successful_empty_scan(self):
        with patch.object(urllib.request, "urlopen", return_value=io.BytesIO(b'{"data":[]}')):
            self.assertEqual(self.ns["fetch_screener"](self.config, []), [])

    def test_http_failure_is_not_an_empty_scan(self):
        error = urllib.error.HTTPError("https://example.invalid", 403, "Forbidden", {}, io.BytesIO(b"blocked"))
        self.addCleanup(error.close)
        with patch.object(urllib.request, "urlopen", side_effect=error):
            with self.assertRaises(RuntimeError):
                self.ns["fetch_screener"](self.config, [])

    def test_malformed_success_response_fails(self):
        with patch.object(urllib.request, "urlopen", return_value=io.BytesIO(b'{"error":"failed"}')):
            with self.assertRaises(RuntimeError):
                self.ns["fetch_screener"](self.config, [])

    def test_partial_failure_preserves_output_and_does_not_ingest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / "config.json"
            config.write_text(json.dumps({"screeners": [self.config, self.config]}))
            output = root / "tv_screeners.json"
            output.write_text("previous output")
            ingest = Mock()
            self.ns.update(fetch_screener=Mock(side_effect=[[], RuntimeError("second request failed")]),
                           _eastern_timezone=lambda: datetime.timezone.utc,
                           regular_session_open=lambda _: False, session_volume_fraction=lambda _: 1,
                           screener_daily_bar_complete=lambda *_: False,
                           filter_screener_instruments=lambda _, hits: hits,
                           push_alist_candidates=ingest)
            with patch.object(sys, "argv", ["test", "--out-dir", directory, "--config", str(config)]):
                with self.assertRaises(RuntimeError):
                    self.ns["main"]()
            self.assertEqual(output.read_text(), "previous output")
            ingest.assert_not_called()


if __name__ == "__main__":
    unittest.main()
