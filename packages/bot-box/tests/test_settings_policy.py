"""Policy regression tests for private-bot.settings.json (review findings B1 and B5).

Claude Code's Write/Edit rules do not restrict files a program writes itself, so every
allow-listed program must be write-free, and the bot may write only to its own
gitignored scratch folder. These tests pin that policy; widening it must be deliberate.

    python -m unittest discover -s packages/bot-box/tests -v
"""
from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
SETTINGS = json.loads((KIT / "private-bot.settings.json").read_text(encoding="utf-8"))
ALLOW = SETTINGS["permissions"]["allow"]
DENY = SETTINGS["permissions"]["deny"]

# Every program the bot may run, with why it cannot write files. Reviewed 2026-09-27
# against the scripts' own file writes and output-path flags.
WRITE_FREE_PROGRAMS = {
    "Bash(python scripts/lint_wiki.py:*)": "reads the wiki, prints findings",
    "Bash(python skills/tradingview-daily-screener/scripts/carry_forward.py:*)": "reads verdict files, prints",
    "Bash(python breadth_ma.py:*)": "network read, prints",
    "Bash(python market_edge.py:*)": "OpenD/Finviz-cache read, prints",
    "Bash(python industry_proxies.py:*)": "OpenD read, prints",
    "Bash(python measure_tickers.py:*)": "stdout only, no output option (tests/test_measure_tickers.py)",
}
# Removed because they write where an argument says or into tracked shared-checkout files.
WRITERS = [
    "session_guard.py", "submit_verdict.py", "fetch_tv_snapshot.py", "build_desk.py", "preflight.py",
    "holdings_review.py", "compute_index_technicals.py", "fetch_market_internals.py", "theme_radar.py",
    "finviz_classify.py", "fetch_opend_live.py", "ingest_to_dashboard.py",
]


class SettingsPolicy(unittest.TestCase):
    def test_dont_ask_mode(self):
        self.assertEqual(SETTINGS["permissions"]["defaultMode"], "dontAsk")

    def test_every_allowed_program_is_reviewed_write_free(self):
        programs = [a for a in ALLOW if a.startswith("Bash(") and not a.startswith("Bash(cd:")]
        self.assertEqual(sorted(programs), sorted(WRITE_FREE_PROGRAMS))

    def test_no_writer_is_allowed(self):
        for w in WRITERS:
            self.assertFalse([a for a in ALLOW if w in a], w)

    def test_no_git_allow_rules_and_output_flag_denied(self):
        self.assertFalse([a for a in ALLOW if re.match(r"Bash\(git\b", a)])
        for d in ("Bash(git pull:*)", "Bash(git fetch:*)", "Bash(git * --ou*)", "Bash(git push:*)",
                  "Bash(git commit:*)", "Bash(git reset:*)", "Bash(git stash:*)", "Bash(git checkout:*)"):
            self.assertIn(d, DENY)

    def test_writes_only_to_the_bot_scratch_folder(self):
        writes = [a for a in ALLOW if a.split("(")[0] in ("Write", "Edit", "NotebookEdit", "MultiEdit")]
        self.assertEqual(sorted(writes), ["Edit(outputs/bot-box/**)", "Write(outputs/bot-box/**)"])
        self.assertNotIn("Write", ALLOW)
        self.assertNotIn("Edit", ALLOW)

    def test_no_blanket_bash(self):
        for a in ALLOW:
            self.assertNotIn(a, ("Bash", "Bash(*)", "Bash(python:*)", "Bash(python *)"))

    def test_json_is_valid_and_lf(self):
        raw = (KIT / "private-bot.settings.json").read_bytes()
        self.assertNotIn(b"\r", raw)
        self.assertTrue(all(b < 128 for b in raw))


if __name__ == "__main__":
    unittest.main()
