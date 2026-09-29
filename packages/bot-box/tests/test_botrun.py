"""B6 regressions for lib/botrun.py in a disposable, isolated setup.

Two throwaway Git repositories mirror the real layout (market_dashboard and jie_wiki as
siblings) with a copy of the runner and harmless fake tools that report where they run
from, what sits beside them and what they imported. A scratch folder holds same-named
look-alikes that would drop a marker file if they ever executed. Every case runs the
runner as a real child process, as the bot would; no real tool, token, network, bot
login or Claude session is involved.

The runner executes a copy of each tool's committed code, so these cases prove that
untracked, ignored, modified, staged or linked files in the checkout never run and never
make a tool unavailable (review 2026-09-28: 14 ignored scratch scripts beside the
morning-brief tools had made three real tools refuse).

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
here = os.path.dirname(os.path.abspath(__file__))
payload = {"tool": __file__, "cwd": os.getcwd(), "path0": sys.path[0], "argv": sys.argv[1:],
           "pythonpath": os.environ.get("PYTHONPATH"), "ignore_env": sys.flags.ignore_environment,
           "pycache_prefix": sys.pycache_prefix, "folder": sorted(os.listdir(here)), "prefix": sys.prefix}
'''
TRUSTED_TOOL = REPORT + "print(json.dumps(payload))\n"
# Like the real market_edge.py: puts its own folder first on sys.path, then imports a sibling.
TRUSTED_EDGE = REPORT + ("sys.path.insert(0, here)\nimport finviz_classify\n"
                         "payload['imported'] = finviz_classify.__file__\npayload['mark'] = finviz_classify.MARK\n"
                         "print(json.dumps(payload))\n")
BRIEF_CODE = ["breadth_ma.py", "finviz_classify.py", "industry_proxies.py", "market_edge.py", "theme_radar.py"]
TOOLS_CODE = ["measure_tickers.py", "orders.py", "positions.py", "quotes.py", "render_report.py", "screener.py",
              "trades.py"]
ALL_TOOLS = ("measure_tickers", "breadth_ma", "market_edge", "industry_proxies", "lint_wiki", "carry_forward",
             "positions", "wiki_search", "wiki_rag", "quotes", "trades", "screener", "theme_radar", "orders",
             "render_report")
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
            self.dash / "packages/bot-box/tools/positions.py": TRUSTED_TOOL,
            self.dash / "packages/bot-box/tools/quotes.py": TRUSTED_TOOL,
            self.dash / "packages/bot-box/tools/trades.py": TRUSTED_TOOL,
            self.dash / "packages/bot-box/tools/screener.py": TRUSTED_TOOL,
            self.dash / "packages/bot-box/tools/orders.py": TRUSTED_TOOL,
            self.dash / "packages/bot-box/tools/render_report.py": TRUSTED_TOOL,
            # Like the real one: writes its Finviz cache beside itself, which must land in the copy.
            self.dash / "packages/core-skills/morning-brief/theme_radar.py": REPORT + (
                "open(os.path.join(here, 'finviz_cache.json'), 'w').write('1')\n"
                "payload['cache'] = os.path.join(here, 'finviz_cache.json')\n"
                "print(json.dumps(payload))\n"),
            self.dash / "packages/core-skills/morning-brief/market_edge.py": TRUSTED_EDGE,
            self.dash / "packages/core-skills/morning-brief/finviz_classify.py": "MARK = 'trusted'\n",
            self.dash / "packages/core-skills/morning-brief/breadth_ma.py": TRUSTED_TOOL,
            self.dash / "packages/core-skills/morning-brief/industry_proxies.py": TRUSTED_TOOL,
            self.dash / "packages/core-skills/morning-brief/watchlist.json": "{}\n",
            self.wiki / "scripts/lint_wiki.py": TRUSTED_TOOL,
            self.wiki / "skills/tradingview-daily-screener/scripts/carry_forward.py": TRUSTED_TOOL,
            self.wiki / "scripts/retrieval/query.py": TRUSTED_TOOL,
            self.wiki / "wiki/verdicts/.keep": "",
            self.wiki / ".gitignore": "outputs/\n",
        }
        for path, text in files.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
        for repo in (self.dash, self.wiki):
            git(repo, "init", "-q")
            commit(repo)
        # Where the runner looks for the wiki retrieval environment. A placeholder is enough
        # for the preflight; the wiki_search run test builds a real one.
        self.retrieval_python = self.wiki / "scripts/retrieval/.venv" / (
            "Scripts/python.exe" if os.name == "nt" else "bin/python")
        self.retrieval_python.parent.mkdir(parents=True)
        self.retrieval_python.write_text("placeholder", encoding="utf-8")
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

    def assertCommittedCopy(self, report, folder):
        """The tool ran from a temporary copy of committed code, never from a repository."""
        tool = Path(report["tool"]).resolve()
        self.assertEqual(Path(report["cwd"]).resolve(), tool.parent)
        for repo in (self.dash, self.wiki):
            self.assertNotIn(repo.resolve(), tool.parents, "tool ran from the working tree")
            self.assertNotIn(str(repo), report["pycache_prefix"] or "")
        self.assertEqual(report["folder"], folder)

    def run_edge(self, **kwargs):
        done = self.run_bot("market_edge", "--ticker", "VEEV", **kwargs)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertNotExecuted()
        report = json.loads(done.stdout)
        self.assertCommittedCopy(report, BRIEF_CODE)
        self.assertEqual(Path(report["imported"]).parent.resolve(), Path(report["tool"]).parent.resolve())
        self.assertEqual(report["mark"], "trusted")
        return report

    # --- the canonical trusted call stays usable ---------------------------------------

    def test_canonical_measurement_runs_a_committed_copy_from_a_scratch_cwd(self):
        done = self.run_bot("measure_tickers", "--tickers", "VEEV,CRM", "--source", "yahoo")
        self.assertEqual(done.returncode, 0, done.stderr)
        report = json.loads(done.stdout)
        self.assertEqual(Path(report["tool"]).name, "measure_tickers.py")
        self.assertCommittedCopy(report, TOOLS_CODE)
        self.assertEqual(report["argv"], ["--tickers", "VEEV,CRM", "--source", "yahoo"])
        self.assertEqual(report["ignore_env"], 1)
        self.assertTrue(report["pycache_prefix"])
        self.assertNotExecuted()

    def test_every_tool_passes_the_preflight_without_running(self):
        done = self.run_bot("--check-all")
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        for tool in ALL_TOOLS:
            self.assertRegex(done.stdout, r"(?m)^ok +{} ".format(tool))
        self.assertNotIn('"argv"', done.stdout)     # the fake tools print JSON only when run
        self.assertNotExecuted()

    # --- scratch substitution ------------------------------------------------------------

    def test_same_named_scratch_script_is_refused_as_a_tool_name(self):
        for name in ("measure_tickers.py", "./measure_tickers.py", str(self.scratch / "measure_tickers.py"),
                     "../../outputs/bot-box/measure_tickers", "outputs/bot-box/measure_tickers.py"):
            with self.subTest(name=name):
                self.assertRefused(self.run_bot(name, "--tickers", "VEEV"), "unknown tool")

    # --- cwd, import and environment shadowing -------------------------------------------

    def test_sibling_import_comes_from_the_committed_copy(self):
        self.run_edge()

    def test_python_environment_variables_cannot_inject_code(self):
        report = self.run_edge(env_extra={
            "PYTHONPATH": str(self.scratch), "PYTHONSTARTUP": str(self.scratch / "startup.py"),
            "PYTHONUSERBASE": str(self.scratch), "PYTHONINSPECT": "1", "PYTHONSAFEPATH": ""})
        self.assertIsNone(report["pythonpath"])

    def test_stray_code_beside_a_tool_never_runs_and_never_blocks_it(self):
        (self.dash / ".gitignore").write_text("**/morning-brief/_account_check_*.py\n**/morning-brief/evil.py\n",
                                              encoding="utf-8")
        evil = EVIL.format(marker=self.marker)
        for name in ("json.py", "pandas.py", "finviz_classify.pyc", "yfinance/__init__.py",
                     "_account_check_2026-06-22.py", "evil.py"):
            path = self.brief / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(evil, encoding="utf-8")
        self.run_edge()
        self.assertEqual(self.run_bot("--check-all").returncode, 0)

    # --- modified, staged, missing or linked code ------------------------------------------

    def test_modified_or_staged_code_runs_the_committed_version(self):
        evil = EVIL.format(marker=self.marker)
        (self.brief / "market_edge.py").write_text(evil, encoding="utf-8")
        (self.brief / "finviz_classify.py").write_text(evil, encoding="utf-8")
        self.run_edge()
        git(self.dash, "add", "-A")
        self.run_edge()

    def test_tool_missing_from_the_last_commit_is_refused(self):
        git(self.dash, "rm", "-q", "--cached", "packages/bot-box/tools/measure_tickers.py")
        git(self.dash, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "drop")
        self.assertTrue((self.tools / "measure_tickers.py").exists())
        self.assertRefused(self.run_bot("measure_tickers", "--tickers", "VEEV"), "not in the last commit")
        done = self.run_bot("--check-all")
        self.assertEqual(done.returncode, 2)
        self.assertRegex(done.stdout, r"(?m)^REFUSED +measure_tickers ")

    def test_link_committed_as_tool_code_is_refused(self):
        blob = subprocess.run(["git", "hash-object", "-w", "--stdin"], cwd=self.dash, input=str(self.scratch / "json.py"),
                              check=True, capture_output=True, text=True).stdout.strip()
        git(self.dash, "update-index", "--add", "--cacheinfo",
            "120000,{},packages/core-skills/morning-brief/linked.py".format(blob))
        git(self.dash, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "link")
        self.assertRefused(self.run_bot("market_edge", "--ticker", "VEEV"), "link")

    @unittest.skipUnless(os.name == "nt", "directory junctions are Windows-only")
    def test_tool_directory_swapped_for_a_junction_still_runs_committed_code(self):
        copy = self.scratch / "tools"
        shutil.copytree(self.tools, copy)
        (copy / "measure_tickers.py").write_text(EVIL.format(marker=self.marker), encoding="utf-8")
        shutil.rmtree(self.tools)
        subprocess.run(["cmd", "/c", "mklink", "/J", str(self.tools), str(copy)], check=True, capture_output=True)
        done = self.run_bot("measure_tickers", "--tickers", "VEEV")
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertCommittedCopy(json.loads(done.stdout), TOOLS_CODE)
        self.assertNotExecuted()

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

    def test_lint_wiki_is_given_the_canonical_wiki_root_by_the_runner(self):
        done = self.run_bot("lint_wiki")
        self.assertEqual(done.returncode, 0, done.stderr)
        argv = json.loads(done.stdout)["argv"]
        self.assertEqual(argv[0], "--wiki-root")
        self.assertEqual(Path(argv[1]).resolve(), (self.wiki / "wiki").resolve())

    # --- gate 2 tools ---------------------------------------------------------------------

    def test_positions_takes_no_options(self):
        done = self.run_bot("positions")
        self.assertEqual(done.returncode, 0, done.stderr)
        report = json.loads(done.stdout)
        self.assertEqual(report["argv"], [])
        self.assertCommittedCopy(report, TOOLS_CODE)
        for args in (("--acc-id", "1"), ("--trd-env", "SIMULATE"), ("--host", "10.0.0.1"), ("unlock",)):
            with self.subTest(args=args):
                self.assertRefused(self.run_bot("positions", *args))

    def test_wiki_search_runs_keyword_only_in_its_environment_with_the_question_last(self):
        venv = self.retrieval_python.parents[1]
        shutil.rmtree(venv)
        subprocess.run([sys.executable, "-m", "venv", "--without-pip", str(venv)], check=True, capture_output=True)
        question = "what is my rule -- on stops?"
        done = self.run_bot("wiki_search", "--question", question, "--limit", "3")
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        report = json.loads(done.stdout)
        argv = report["argv"]
        self.assertEqual(argv[:3], ["--limit", "3", "--repo"])
        self.assertEqual(Path(argv[3]).resolve(), self.wiki.resolve())
        self.assertEqual(argv[4:], ["--provider", "gemini", "--lexical-only", "--json", "--", question])
        self.assertEqual(Path(report["prefix"]).resolve(), venv.resolve())
        self.assertCommittedCopy(report, ["query.py"])
        self.assertNotExecuted()

    def test_wiki_search_cannot_leave_keyword_mode_or_take_bad_questions(self):
        cases = [("--question", "x", "--mode", "hybrid"), ("--question", "x", "--index", "C:/x"),
                 ("--question", "x", "--repo", "C:/"), ("--question", "x", "--no-repair"),
                 ("--question", "x", "--provider", "openai"), ("--question", "x", "--lexical-only"),
                 ("--question", "a\nb"), ("--question", "x" * 301), ("--question", "   "),
                 ("--question", "--mode"), ("--question", "x", "--limit", "21"),
                 ("--question", "x", "--limit", "0"), ("--limit", "3"), ("--question", "x", "--question", "y")]
        for args in cases:
            with self.subTest(args=args):
                self.assertRefused(self.run_bot("--check", "wiki_search", *args))
        self.assertEqual(self.run_bot("--check", "wiki_search", "--question", "x" * 300).returncode, 0)

    def test_wiki_search_without_its_environment_is_refused(self):
        shutil.rmtree(self.retrieval_python.parents[1])
        self.assertRefused(self.run_bot("wiki_search", "--question", "stops"), "Python environment")
        done = self.run_bot("--check-all")
        self.assertEqual(done.returncode, 2)
        self.assertRegex(done.stdout, r"(?m)^REFUSED +wiki_search ")

    # --- gate 3 tools ---------------------------------------------------------------------

    def test_wiki_rag_is_hybrid_read_only_on_the_named_index_with_the_question_last(self):
        venv = self.retrieval_python.parents[1]
        shutil.rmtree(venv)
        subprocess.run([sys.executable, "-m", "venv", "--without-pip", str(venv)], check=True, capture_output=True)
        question = "how do I place stops?"
        done = self.run_bot("wiki_rag", "--question", question, "--limit", "4")
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        report = json.loads(done.stdout)
        argv = report["argv"]
        self.assertEqual(argv[:3], ["--limit", "4", "--repo"])
        self.assertEqual(Path(argv[3]).resolve(), self.wiki.resolve())
        self.assertEqual(argv[4:6], ["--provider", "gemini"])
        self.assertEqual(argv[6], "--index")
        self.assertEqual(Path(argv[7]).resolve(), (self.wiki / "scripts/retrieval/.index-gemini").resolve())
        self.assertEqual(argv[8:], ["--no-repair", "--json", "--", question])
        self.assertEqual(Path(report["prefix"]).resolve(), venv.resolve())

    def test_screener_always_reads_the_canonical_config(self):
        done = self.run_bot("screener", "--screener", "top-gainer", "--limit", "5")
        self.assertEqual(done.returncode, 0, done.stderr)
        argv = json.loads(done.stdout)["argv"]
        self.assertEqual(argv[:4], ["--screener", "top-gainer", "--limit", "5"])
        self.assertEqual(argv[4], "--config")
        self.assertEqual(Path(argv[5]).resolve(),
                         (self.dash / "apps/market_dashboard_backend/scripts/tv-screeners.json").resolve())

    def test_theme_radar_cache_write_lands_in_the_copy_not_the_checkout(self):
        checkout_cache = self.brief / "finviz_cache.json"
        self.assertFalse(checkout_cache.exists())
        done = self.run_bot("theme_radar", "--json", "--book", "NVDA")
        self.assertEqual(done.returncode, 0, done.stderr)
        report = json.loads(done.stdout)
        self.assertCommittedCopy(report, BRIEF_CODE)          # listed before the write
        self.assertNotIn(self.dash.resolve(), Path(report["cache"]).resolve().parents)
        self.assertFalse(checkout_cache.exists(), "the cache write reached the checkout")

    def test_gate3_tool_schemas(self):
        refused = [("quotes",), ("quotes", "--tickers", "nvda;rm"), ("quotes", "--tickers", "NVDA", "--host", "x"),
                   ("trades", "--days", "0"), ("trades", "--days", "91"), ("trades", "--acc-id", "1"),
                   ("screener", "--screener", "../x"), ("screener", "--limit", "51"), ("screener", "--config", "x"),
                   ("theme_radar", "--out", "x.json"), ("theme_radar", "--book", "a;b"),
                   ("wiki_rag", "--question", "x", "--mode", "dense"), ("wiki_rag", "--question", "x", "--index", "C:/"),
                   ("wiki_rag", "--question", "x", "--lexical-only"), ("wiki_rag", "--question", "x", "--repo", "C:/")]
        for args in refused:
            with self.subTest(args=args):
                self.assertRefused(self.run_bot("--check", *args))
        for args in (("quotes", "--tickers", "NVDA,BRK.B"), ("trades",), ("trades", "--days", "90"),
                     ("screener",), ("screener", "--screener", "vcp-200ma", "--limit", "50"),
                     ("theme_radar", "--json", "--book", "NVDA,AMD"), ("wiki_rag", "--question", "stops")):
            with self.subTest(args=args):
                self.assertEqual(self.run_bot("--check", *args).returncode, 0, args)

    def test_orders_takes_no_options(self):
        done = self.run_bot("orders")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(json.loads(done.stdout)["argv"], [])
        for args in (("--acc-id", "1"), ("--trd-env", "SIMULATE"), ("--cancel",), ("unlock",)):
            with self.subTest(args=args):
                self.assertRefused(self.run_bot("orders", *args))

    def test_render_report_root_is_fixed_and_file_must_be_an_html_path(self):
        done = self.run_bot("render_report", "--file", "2026-09-29/SMCI-report.html")
        self.assertEqual(done.returncode, 0, done.stderr)
        argv = json.loads(done.stdout)["argv"]
        self.assertEqual(argv[:2], ["--file", "2026-09-29/SMCI-report.html"])
        self.assertEqual(argv[2], "--root")
        self.assertEqual(Path(argv[3]).resolve(), (self.wiki / "outputs/bot-box").resolve())
        for args in (("render_report",), ("render_report", "--file", "../x.html"),
                     ("render_report", "--file", "a/../../x.html"), ("render_report", "--file", "C:/x.html"),
                     ("render_report", "--file", "/etc/x.html"), ("render_report", "--file", "x.png"),
                     ("render_report", "--file", "x.html", "--root", "C:/"),
                     ("render_report", "--file", "a/b/c/d/e.html")):
            with self.subTest(args=args):
                self.assertRefused(self.run_bot("--check", *args))

    def test_list_names_every_tool(self):
        done = self.run_bot("--list")
        self.assertEqual(done.returncode, 0)
        for tool in ALL_TOOLS:
            self.assertIn(tool, done.stdout)


if __name__ == "__main__":
    unittest.main()
