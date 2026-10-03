"""Offline checks for source identity and publication gate ordering."""
import unittest
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[1]


class WorkflowContracts(unittest.TestCase):
    def steps(self, name):
        raw = (ROOT / ".github/workflows" / (name + ".yml")).read_text(encoding="utf-8")
        doc = yaml.safe_load(raw)
        return raw, [s for job in doc["jobs"].values() for s in job["steps"]]

    def test_canonical_wiki_is_required_from_repo_root(self):
        for name in ("refresh_premarket", "refresh_brief_provider", "refresh_codex_selfhosted", "journal_close"):
            with self.subTest(workflow=name):
                raw, steps = self.steps(name)
                self.assertNotIn("trade-analyser_skill", raw)
                step = next(s for s in steps if s.get("name") == "Fetch pinned canonical wiki")
                self.assertEqual(step["working-directory"], ".")
                self.assertFalse(step.get("continue-on-error", False))
                self.assertNotIn("||", step["run"])
                self.assertIn("git submodule sync", step["run"])
                self.assertIn("test -f", step["run"])
                check = next(s for s in steps if s.get("name") == "Verify pinned runtime knowledge")
                self.assertIn("--strict", check["run"])
                self.assertIn("/packages/core-skills/wiki-source", check["env"]["JIE_WIKI_ROOT"])

    def test_freshness_gates_precede_generation_and_publication(self):
        for name in ("refresh_premarket", "refresh_data_intraday", "refresh_brief_provider", "refresh_codex_selfhosted"):
            with self.subTest(workflow=name):
                _, steps = self.steps(name)
                names = [s.get("name", "") for s in steps]
                gate = names.index("Validate market inputs before consumers")
                self.assertLess(names.index("Refresh breadth"), gate)
                for i, step in enumerate(steps):
                    if step.get("name", "").startswith("Fetch TV screeners"):
                        self.assertFalse(step.get("continue-on-error", False))
                    if step.get("name", "").startswith("Generate "):
                        self.assertLess(gate, i)
                if name in ("refresh_premarket", "refresh_data_intraday"):
                    sync = names.index("Sync validated data into Next.js public folder")
                    parity = names.index("Gate producer and consumer freshness before publication")
                    commit = next(i for i, n in enumerate(names) if n.startswith("Commit updated"))
                    self.assertLess(sync, parity)
                    self.assertLess(parity, commit)
                    self.assertIn("--public-dir", steps[parity]["run"])
                    self.assertIn("apps/market_dashboard_backend/data", steps[commit]["run"])
                    self.assertIn("apps/market_dashboard/public/market-dashboard", steps[commit]["run"])


if __name__ == "__main__":
    unittest.main()
