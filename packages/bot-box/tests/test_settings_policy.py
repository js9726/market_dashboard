"""Policy regression tests for private-bot.settings.json (review findings B1, B5 and B6).

Claude Code's Write/Edit rules do not restrict files a program writes itself, so every
program the bot may run must be write-free, and the bot may write only to its own
gitignored scratch folder. Since B6 the bot runs programs only through lib/botrun.py,
named by absolute path and run by a fixed interpreter in isolated mode; the runner, not
the command text, decides what executes (tests/test_botrun.py). These tests pin that
policy; widening it must be deliberate.

    python -m unittest discover -s packages/bot-box/tests -v
"""
from __future__ import annotations

import importlib.util
import json
import re
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
SETTINGS = json.loads((KIT / "private-bot.settings.json").read_text(encoding="utf-8"))
ALLOW = SETTINGS["permissions"]["allow"]
DENY = SETTINGS["permissions"]["deny"]

_spec = importlib.util.spec_from_file_location("botrun", KIT / "lib" / "botrun.py")
BOTRUN = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(BOTRUN)

# Every tool the runner may start, with why it cannot write files. Reviewed 2026-09-27
# against the scripts' own file writes and output-path flags.
WRITE_FREE_PROGRAMS = {
    "lint_wiki": "reads the wiki, prints findings",
    "carry_forward": "reads verdict files, prints",
    "breadth_ma": "network read, prints",
    "market_edge": "OpenD/Finviz-cache read, prints",
    "industry_proxies": "OpenD read, prints",
    "measure_tickers": "stdout only, no output option (tests/test_measure_tickers.py)",
    # Gate 2, 2026-09-28.
    "positions": "OpenD read-only position query, no options, stdout only (tests/test_positions.py)",
    "wiki_search": "query.py pinned by the runner to --lexical-only: reads current files, no index/key/network",
    # Gate 3, 2026-09-29.
    "wiki_rag": "query.py pinned to --no-repair: reads the index, never rebuilds it; one Gemini query embedding",
    "quotes": "OpenD market snapshot, quote context only, stdout (tests/test_opend_tools.py)",
    "trades": "OpenD fill/fee history queries, stdout, no identifiers (tests/test_opend_tools.py)",
    "screener": "anonymous TradingView scan of the canonical config, stdout, no secret (tests/test_screener.py)",
    "theme_radar": "OpenD klines + Finviz read; --out refused; its cache write lands in the runner's temp copy",
    # 2026-09-29.
    "orders": "OpenD read-only order list and positions, no options, stdout (tests/test_opend_tools.py)",
    "render_report": "writes one PNG beside the report, only inside outputs/bot-box (root fixed by the runner, "
                     "links refused; tests/test_render_report.py)",
}
# The launcher turns the prompt's double quotes into single quotes (PowerShell 5.1), so the
# same absolute paths are allowed in either quote style and in no other form.
RUNNER_RULE = re.compile(
    r"""Bash\((?P<q>["'])(?P<python>[A-Za-z]:/[^"']+/python\.exe)(?P=q) -I """
    r"""(?P=q)(?P<runner>[A-Za-z]:/[^"']+/lib/botrun\.py)(?P=q) \*\)\Z""")
# Removed because they write where an argument says or into tracked shared-checkout files.
WRITERS = [
    "session_guard.py", "submit_verdict.py", "fetch_tv_snapshot.py", "build_desk.py", "preflight.py",
    "holdings_review.py", "compute_index_technicals.py", "fetch_market_internals.py",
    "finviz_classify.py", "fetch_opend_live.py", "ingest_to_dashboard.py", "tv_screener_fetch.py",
    "morning_brief.py",
]
# theme_radar.py left WRITERS on 2026-09-29 (gate 3): its --out option is refused by the
# runner, and the Finviz cache it writes beside itself lands in the runner's temporary copy
# of committed code, never in the checkout (tests/test_botrun.py proves the second part).


class SettingsPolicy(unittest.TestCase):
    def test_dont_ask_mode(self):
        self.assertEqual(SETTINGS["permissions"]["defaultMode"], "dontAsk")

    def test_the_only_program_rule_is_the_trusted_runner(self):
        programs = [a for a in ALLOW if a.startswith(("Bash", "PowerShell"))]
        self.assertEqual(len(programs), 2, programs)
        matches = [RUNNER_RULE.match(a) for a in programs]
        self.assertTrue(all(matches), programs)
        self.assertEqual(sorted(m["q"] for m in matches), ['"', "'"])
        self.assertEqual(len({(m["python"], m["runner"]) for m in matches}), 1)
        self.assertEqual(Path(matches[0]["runner"]).resolve(), (KIT / "lib" / "botrun.py").resolve())
        self.assertTrue(Path(matches[0]["python"]).is_absolute())

    def test_prompt_shows_the_runner_command_the_rule_allows(self):
        prompt = (KIT / "private-bot-prompt.md").read_text(encoding="utf-8").replace('"', "'")
        rule = [a for a in ALLOW if a.startswith("Bash('")][0][len("Bash("):-len(" *)")]
        self.assertIn(rule + " <tool>", prompt)

    def test_no_cd_or_relative_script_rules(self):
        for a in ALLOW:
            self.assertFalse(a.startswith(("Bash(cd", "Bash(python ", "Bash(py ")), a)

    def test_interpreters_shells_and_cd_are_denied(self):
        for d in ("Bash(cd *)", "Bash(pushd *)", "Bash(python *)", "Bash(python3 *)", "Bash(py *)",
                  "Bash(pip *)", "Bash(node *)", "Bash(bun *)", "Bash(npx *)", "Bash(bash *)", "Bash(sh *)",
                  "Bash(cmd *)", "Bash(powershell *)", "Bash(pwsh *)", "Bash(source *)"):
            self.assertIn(d, DENY)
        # A deny rule beats every allow rule, so none may cover the runner command itself.
        for rule in [a for a in ALLOW if a.startswith("Bash(")]:
            runner = rule[len("Bash("):-len(" *)")]
            for d in DENY:
                if d.startswith("Bash(") and d.endswith(" *)"):
                    self.assertFalse(runner.startswith(d[len("Bash("):-len(" *)")] + " "), d)

    def test_every_runner_tool_is_reviewed_write_free(self):
        self.assertEqual(sorted(BOTRUN.TOOLS), sorted(WRITE_FREE_PROGRAMS))

    def test_no_writer_is_allowed(self):
        for w in WRITERS:
            self.assertFalse([a for a in ALLOW if w in a], w)
            self.assertFalse([t for t in BOTRUN.TOOLS.values() if t[1].endswith("/" + w)], w)

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
