import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from check_daily_freshness import validate


class FreshnessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.backend = Path(self.temp.name) / "backend"
        self.public = Path(self.temp.name) / "public"
        self.now = datetime(2026, 10, 4, 12, tzinfo=timezone.utc)
        self.stamp = "2026-10-04T11:30:00Z"
        self.payloads = {
            "snapshot.json": {"built_at": self.stamp, "groups": {"indices": [{"ticker": "SPY"}]}},
            "tv_screeners.json": {"fetched_at": self.stamp, "screeners": [{"id": "test", "status": "success", "hits": []}]},
            "breadth.json": {"as_of": self.stamp, "market": {"universe_size": 3000}},
        }
        for root in (self.backend, self.public):
            root.mkdir()
            for name, data in self.payloads.items():
                self.write(root, name, data)

    def write(self, root, name, data):
        (root / name).write_text(json.dumps(data), encoding="utf-8")

    def check(self, **kwargs):
        return validate(self.backend, self.public, now=self.now, **kwargs)

    def test_valid_zero_hits_and_parity(self):
        self.assertTrue(self.check()["ok"])
        self.write(self.public, "snapshot.json", {**self.payloads["snapshot.json"], "extra": 1})
        self.assertIn("snapshot: backend/public content differs", self.check()["errors"])

    def test_stale_future_naive_and_missing_all_reported(self):
        for stamp in ("2026-10-02T11:30:00Z", "2026-10-04T12:10:00Z", "2026-10-04T11:30:00"):
            with self.subTest(stamp=stamp):
                self.write(self.backend, "snapshot.json", {**self.payloads["snapshot.json"], "built_at": stamp})
                self.assertFalse(self.check()["ok"])
        (self.backend / "tv_screeners.json").unlink()
        self.assertGreaterEqual(len(self.check()["errors"]), 2)

    def test_nonfinite_and_error_payloads_fail(self):
        (self.backend / "snapshot.json").write_text('{"built_at":"'+self.stamp+'","groups":NaN}')
        self.write(self.backend, "tv_screeners.json", {**self.payloads["tv_screeners.json"], "error": "fetch failed"})
        errors = self.check()["errors"]
        self.assertEqual(len(errors), 2)
        self.assertIn("non-finite", errors[0])
        (self.backend / "snapshot.json").write_text('{"nested":{"value":1e400}}')
        self.assertIn("non-finite JSON number", self.check()["errors"][0])

    def test_selected_artifacts(self):
        (self.backend / "breadth.json").unlink()
        self.assertTrue(self.check(artifacts=("snapshot", "screeners"))["ok"])
        self.assertFalse(self.check()["ok"])

    def test_ambiguous_partial_scan_fails(self):
        self.write(self.backend, "tv_screeners.json", {"fetched_at": self.stamp, "screeners": [
            {"id": "ok", "status": "success", "hits": [{"ticker": "SPY"}]},
            {"id": "ambiguous", "hits": []},
        ]})
        self.assertIn("successful-fetch provenance", self.check()["errors"][0])

    def test_bad_shapes(self):
        self.write(self.backend, "tv_screeners.json", {"fetched_at": self.stamp, "screeners": [{"hits": {}, "error": "bad"}]})
        self.write(self.backend, "breadth.json", {"as_of": self.stamp, "market": {}, "universe_size": 5})
        self.assertEqual(len(self.check()["errors"]), 2)


if __name__ == "__main__":
    unittest.main()
