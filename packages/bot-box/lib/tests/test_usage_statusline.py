"""Offline tests for lib/usage-statusline.py (the bot's usage recorder).

    python -m unittest discover -s packages/bot-box/lib/tests -v
"""
from __future__ import annotations

import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "usage-statusline.py"
_spec = importlib.util.spec_from_file_location("usage_statusline", SCRIPT)
us = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(us)

SAMPLE = {
    "session_id": "abc", "transcript_path": "C:/x/abc.jsonl",
    "rate_limits": {"five_hour": {"used_percentage": 23.44, "resets_at": 1790650000},
                    "seven_day": {"used_percentage": 41.2, "resets_at": 1791000000}},
}


def run(payload, state: Path) -> tuple[str, dict]:
    env = {**os.environ, "BOTBOX_STATE_DIR": str(state)}
    out = subprocess.run([sys.executable, str(SCRIPT)], input=payload, capture_output=True, text=True, env=env,
                         timeout=30)
    assert out.returncode == 0, out.stderr
    f = state / "usage.json"
    return out.stdout.strip(), (json.loads(f.read_text(encoding="utf-8")) if f.exists() else {})


class StatusLine(unittest.TestCase):
    def test_records_both_windows(self):
        with tempfile.TemporaryDirectory() as d:
            text, doc = run(json.dumps(SAMPLE), Path(d))
            self.assertEqual(text, "Claude plan: 5h 23% used | 7d 41% used")
            self.assertEqual(doc["rate_limits"]["five_hour"], {"used_percentage": 23.4, "resets_at": 1790650000})
            self.assertEqual(doc["transcript_path"], "C:/x/abc.jsonl")
            self.assertIsInstance(doc["rate_limits_observed_at"], int)
            raw = (Path(d) / "usage.json").read_bytes()
            self.assertNotIn(b"\r", raw)
            self.assertEqual(sorted(p.name for p in Path(d).iterdir()), ["usage.json"])  # no temp file left

    def test_missing_rate_limits_keeps_the_last_reading(self):
        with tempfile.TemporaryDirectory() as d:
            run(json.dumps(SAMPLE), Path(d))
            first = json.loads((Path(d) / "usage.json").read_text())
            text, doc = run(json.dumps({"session_id": "abc", "transcript_path": "C:/x/abc.jsonl"}), Path(d))
            self.assertEqual(doc["rate_limits"], first["rate_limits"])
            self.assertEqual(doc["rate_limits_observed_at"], first["rate_limits_observed_at"])
            self.assertIn("5h 23% used", text)

    def test_first_run_without_limits(self):
        with tempfile.TemporaryDirectory() as d:
            text, doc = run(json.dumps({"session_id": "s"}), Path(d))
            self.assertEqual(text, "Claude plan: usage appears after the first reply")
            self.assertEqual(doc["rate_limits"], {})
            self.assertIsNone(doc["rate_limits_observed_at"])

    def test_one_window_only_and_bad_values(self):
        doc = us.update({"rate_limits": {"five_hour": {"used_percentage": float("nan")},
                                         "seven_day": {"used_percentage": 12, "resets_at": True}}}, {}, 100.0)
        self.assertEqual(doc["rate_limits"], {"seven_day": {"used_percentage": 12.0}})
        doc = us.update({"rate_limits": {"five_hour": {"used_percentage": "50"}}}, {}, 100.0)
        self.assertEqual(doc["rate_limits"], {})

    def test_garbage_input_never_breaks_the_status_line(self):
        with tempfile.TemporaryDirectory() as d:
            for payload in ("not json", "[1,2]", ""):
                text, _ = run(payload, Path(d))
                self.assertTrue(text.startswith("Claude plan:"), text)

    def test_unwritable_state_dir_still_prints(self):
        with tempfile.TemporaryDirectory() as d:
            blocker = Path(d) / "file"
            blocker.write_text("x")
            env = {**os.environ, "BOTBOX_STATE_DIR": str(blocker / "sub")}
            out = subprocess.run([sys.executable, str(SCRIPT)], input=json.dumps(SAMPLE), capture_output=True,
                                 text=True, env=env, timeout=30)
            self.assertEqual(out.returncode, 0)
            self.assertIn("usage not recorded", out.stdout)


if __name__ == "__main__":
    unittest.main()
