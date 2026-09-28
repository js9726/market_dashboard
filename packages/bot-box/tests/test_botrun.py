"""B6 regressions for lib/botrun.py in a disposable, isolated setup.

Two throwaway Git repositories mirror the real layout (market_dashboard and jie_wiki as
siblings) with a copy of the runner and harmless fake tools that report where they run
from. A scratch folder holds same-named look-alikes that would drop a marker file if
they ever executed. Every case runs the runner as a real child process, as the bot
would; no real tool, token, network, bot login or Claude session is involved.

    python -m unittest discover -s packages/bot-box/tests -v
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

RUNNER = Path(__file__).resolve().parents[1] / "lib" / "botrun.py"
# Mutation checks point this at a weakened copy; the real runner is never edited for them.
RUNNER = Path(os.environ.get("BOTRUN_UNDER_TEST") or RUNNER)

REPORT = '''import json, os, sys
payload = {"tool": __file__, "cwd": os.getcwd(), "path0": sys.path[0], "argv": sys.argv[1:],
           "pythonpath": os.environ.get("PYTHONPATH"), "ignore_env": sys.flags.ignore_environment,
           "pycache_prefix": sys.pycache_prefix}
'''
TRUSTED_TOOL = REPORT + "print(json.dumps(payload))\n"
TRUSTED_EDGE = REPORT + "import finviz_classify\npayload['imported'] = finviz_classify.__file__\nprint(json.dumps(payload))\n"
EVIL = "from pathlib import Path\nPath(r'{marker}').write_text('executed')\nprint('EVIL')\n"


def git(repo, *args):
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True)


def commit(repo):
    git(repo, "add", "-A")
    git(repo, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture")


class BotRunIsolation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.dash, self.wiki = root / "market_dashboard", root / "jie_wiki"
        self.marker = root / "PWNED"
        files = {
            self.dash / "packages/bot-box/lib/botrun.py": RUNNER.read_text(encoding="utf-8"),
            self.dash / "packages/bot-box/tools/measure_tickers.py": TRUSTED_TOOL,
            self.dash / "packages/core-skills/morning-brief/market_edge.py": TRUSTED_EDGE,
            self.dash / "packages/core-skills/morning-brief/finviz_classify.py": "MARK = 'trusted'\n",
            self.dash / "packages/core-skills/morning-brief/breadth_ma.py": TRUSTED_TOOL,
            self.dash / "packages/core-skills/morning-brief/industry_proxies.py": TRUSTED_TOOL,
            self.dash / "packages/core-skills/morning-brief/watchlist.json": "{}\n",
            self.wiki / "scripts/lint_wiki.py": TRUSTED_TOOL,
            self.wiki / "skills/tradingview-daily-screener/scripts/carry_forward.py": TRUSTED_TOOL,
            self.wiki / "wiki/verdicts/.keep": "",
            self.wiki / ".gitignore": "outputs/\n",
        }
        for path, text in files.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
        for repo in (self.dash, self.wiki):
            git(repo, "init", "-q")
            commit(repo)
        self.runner = self.dash / "packages/bot-box/lib/botrun.py"
        self.tools = self.dash / "packages/bot-box/tools"
        self.brief = self.dash / "packages/core-skills/morning-brief"
        # The bot's writable scratch, full of same-named look-alikes.
        self.scratch = self.wiki / "outputs/bot-box"
        self.scratch.mkdir(parents=True)
        evil = EVIL.format(marker=self.marker)
        for name in ("measure_tickers.py", "finviz_classify.py", "botrun.py", "sitecustomize.py",
                     "usercustomize.py", "json.py", "startup.py"):
            (self.scratch / name).write_text(evil, encoding="utf-8")

    def run_bot(self, *args, cwd=None, env_extra=None):
        env = dict(os.environ)
        env.update(env_extra or {})
        proc = subprocess.Popen([sys.executable, "-I", str(self.runner), *args], cwd=cwd or self.scratch,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL,
                                text=True, encoding="utf-8", env=env, start_new_session=os.name != "nt")
        try:
            out, err = proc.communicate(timeout=60)
        except subprocess.TimeoutExpired:
            # A leaked environment can leave a grandchild waiting interactively and holding the
            # pipes; kill the whole tree so the case fails instead of hanging the suite.
            if os.name == "nt":
                subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True)
            else:
                os.killpg(proc.pid, 9)
            proc.communicate(timeout=30)
            self.fail("runner did not finish within 60 s: a child process was left waiting")
        return subprocess.CompletedProcess(proc.args, proc.returncode, out, err)

    def assertNotExecuted(self):
        self.assertFalse(self.marker.exists(), "scratch code executed")

    def assertRefused(self, done, fragment=""):
        self.assertEqual(done.returncode, 2, done.stdout + done.stderr)
        self.assertIn("BOTRUN REFUSED", done.stderr)
        self.assertIn(fragment, done.stderr)
        self.assertNotIn("EVIL", done.stdout)
        self.assertNotExecuted()

    # --- the canonical trusted call stays usable ---------------------------------------

    def test_canonical_measurement_runs_the_trusted_tool_from_a_scratch_cwd(self):
        done = self.run_bot("measure_tickers", "--tickers", "VEEV,CRM", "--source", "yahoo")
        self.assertEqual(done.returncode, 0, done.stderr)
        report = json.loads(done.stdout)
        self.assertEqual(Path(report["tool"]).resolve(), (self.tools / "measure_tickers.py").resolve())
        self.assertEqual(Path(report["cwd"]).resolve(), self.tools.resolve())
        self.assertEqual(report["argv"], ["--tickers", "VEEV,CRM", "--source", "yahoo"])
        self.assertEqual(report["ignore_env"], 1)
        self.assertTrue(report["pycache_prefix"])
        self.assertNotIn(str(self.tools), report["pycache_prefix"])
        self.assertNotExecuted()

    # --- scratch substitution ------------------------------------------------------------

    def test_same_named_scratch_script_is_refused_as_a_tool_name(self):
        for name in ("measure_tickers.py", "./measure_tickers.py", str(self.scratch / "measure_tickers.py"),
                     "../../outputs/bot-box/measure_tickers", "outputs/bot-box/measure_tickers.py"):
            with self.subTest(name=name):
                self.assertRefused(self.run_bot(name, "--tickers", "VEEV"), "unknown tool")

    # --- cwd, import and environment shadowing -------------------------------------------

    def test_sibling_import_comes_from_the_trusted_directory_not_the_cwd(self):
        done = self.run_bot("market_edge", "--ticker", "VEEV")
        self.assertEqual(done.returncode, 0, done.stderr)
        report = json.loads(done.stdout)
        self.assertEqual(Path(report["imported"]).resolve(), (self.brief / "finviz_classify.py").resolve())
        self.assertNotExecuted()

    def test_python_environment_variables_cannot_inject_code(self):
        done = self.run_bot("market_edge", "--ticker", "VEEV", env_extra={
            "PYTHONPATH": str(self.scratch), "PYTHONSTARTUP": str(self.scratch / "startup.py"),
            "PYTHONUSERBASE": str(self.scratch), "PYTHONINSPECT": "1", "PYTHONSAFEPATH": ""})
        self.assertEqual(done.returncode, 0, done.stderr)
        report = json.loads(done.stdout)
        self.assertIsNone(report["pythonpath"])
        self.assertEqual(Path(report["imported"]).resolve(), (self.brief / "finviz_classify.py").resolve())
        self.assertNotExecuted()

    def test_untracked_or_ignored_code_beside_a_tool_is_refused(self):
        cases = [(self.brief / "pandas.py", "untracked code"), (self.brief / "yfinance/__init__.py", "untracked code"),
                 (self.brief / "finviz_classify.pyc", "untracked code")]
        for path, fragment in cases:
            with self.subTest(path=path.name):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(EVIL.format(marker=self.marker), encoding="utf-8")
                self.assertRefused(self.run_bot("market_edge", "--ticker", "VEEV"), fragment)
                path.unlink()
        (self.dash / ".gitignore").write_text("packages/core-skills/morning-brief/evil.py\n", encoding="utf-8")
        (self.brief / "evil.py").write_text("x = 1\n", encoding="utf-8")
        self.assertRefused(self.run_bot("market_edge", "--ticker", "VEEV"), "evil.py")

    def test_data_files_beside_a_tool_may_change(self):
        (self.brief / "watchlist.json").write_text('{"changed": true}\n', encoding="utf-8")
        self.assertEqual(self.run_bot("market_edge", "--ticker", "VEEV").returncode, 0)

    # --- modified trusted code -------------------------------------------------------------

    def test_modified_tool_is_refused_before_it_runs(self):
        target = self.tools / "measure_tickers.py"
        target.write_text(EVIL.format(marker=self.marker), encoding="utf-8")
        self.assertRefused(self.run_bot("measure_tickers", "--tickers", "VEEV"), "differs from the last commit")
        git(self.dash, "add", "-A")
        self.assertRefused(self.run_bot("measure_tickers", "--tickers", "VEEV"), "differs from the last commit")

    def test_modified_sibling_module_is_refused(self):
        (self.brief / "finviz_classify.py").write_text(EVIL.format(marker=self.marker), encoding="utf-8")
        self.assertRefused(self.run_bot("market_edge", "--ticker", "VEEV"), "finviz_classify.py")

    def test_untracked_tool_is_refused(self):
        (self.tools / "measure_tickers.py").unlink()
        commit(self.dash)
        (self.tools / "measure_tickers.py").write_text(TRUSTED_TOOL, encoding="utf-8")
        self.assertRefused(self.run_bot("measure_tickers", "--tickers", "VEEV"), "not tracked")

    @unittest.skipUnless(os.name == "nt", "directory junctions are Windows-only")
    def test_tool_directory_swapped_for_a_junction_is_refused(self):
        copy = self.scratch / "tools"
        shutil.copytree(self.tools, copy)
        (copy / "measure_tickers.py").write_text(TRUSTED_TOOL, encoding="utf-8")
        shutil.rmtree(self.tools)
        subprocess.run(["cmd", "/c", "mklink", "/J", str(self.tools), str(copy)], check=True, capture_output=True)
        self.assertRefused(self.run_bot("measure_tickers", "--tickers", "VEEV"), "outside its repository")

    # --- argument validation ---------------------------------------------------------------

    def test_arguments_outside_each_tool_schema_are_refused(self):
        cases = [("measure_tickers", "--tickers", "VEEV", "--out", "x.json"),
                 ("measure_tickers", "--tickers", "veev; rm"),
                 ("measure_tickers", "--source", "yahoo"),
                 ("measure_tickers", "--tickers", "VEEV", "--tickers", "CRM"),
                 ("lint_wiki", "--wiki-root", "C:/"),
                 ("industry_proxies", "--host", "10.0.0.5"),
                 ("breadth_ma", "--min-cap", "-5"),
                 ("carry_forward", "--verdicts-dir", str(self.scratch.parents[3]), "--asof", "2026-09-25",
                  "--universe", "VEEV"),
                 ("carry_forward", "--verdicts-dir", "wiki/verdicts", "--asof", "2026-13-40", "--universe", "VEEV")]
        for args in cases:
            with self.subTest(args=args):
                self.assertRefused(self.run_bot("--check", *args))

    def test_valid_arguments_pass_and_data_paths_become_absolute(self):
        done = self.run_bot("carry_forward", "--verdicts-dir", "wiki/verdicts", "--asof", "2026-09-25",
                            "--universe", "VEEV,CRM", "--drop", "TEAM=earnings week", "--drop", "CRM=held", "--json")
        self.assertEqual(done.returncode, 0, done.stderr)
        argv = json.loads(done.stdout)["argv"]
        self.assertEqual(Path(argv[1]), (self.wiki / "wiki/verdicts").resolve())
        self.assertEqual(argv.count("--drop"), 2)
        self.assertEqual(self.run_bot("--check", "breadth_ma", "--universe=sp500", "--min-cap", "2e9").returncode, 0)

    def test_list_names_every_tool(self):
        done = self.run_bot("--list")
        self.assertEqual(done.returncode, 0)
        for tool in ("measure_tickers", "breadth_ma", "market_edge", "industry_proxies", "lint_wiki", "carry_forward"):
            self.assertIn(tool, done.stdout)


if __name__ == "__main__":
    unittest.main()
