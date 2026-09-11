from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import _env_loader as loader


class EnvLoaderTests(unittest.TestCase):
    def test_public_ingest_url_defaults_without_a_project_checkout(self):
        with mock.patch.dict(os.environ, {"LOCALAPPDATA": ""}, clear=True), mock.patch.object(
            loader, "_find_project_root", return_value=None,
        ):
            loaded = loader.load_env()

            self.assertEqual(
                os.environ["VERCEL_INGEST_URL"],
                loader.DEFAULT_VERCEL_INGEST_URL,
            )
            self.assertEqual(loaded, 1)

    def test_explicit_ingest_url_wins_over_public_default(self):
        explicit = "https://dashboard.example.test"
        with mock.patch.dict(
            os.environ,
            {"LOCALAPPDATA": "", "VERCEL_INGEST_URL": explicit},
            clear=True,
        ), mock.patch.object(loader, "_find_project_root", return_value=None):
            loaded = loader.load_env()

            self.assertEqual(os.environ["VERCEL_INGEST_URL"], explicit)
            self.assertEqual(loaded, 0)

    def test_personal_store_fills_keys_missing_from_project_env(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            app_env = root / "project" / "apps" / "market_dashboard" / ".env.local"
            app_env.parent.mkdir(parents=True)
            app_env.write_text(
                "MORNING_BRIEF_TEST_PRIORITY=project\n",
                encoding="utf-8",
            )
            personal = root / "Jie" / "secrets" / "market-dashboard.env"
            personal.parent.mkdir(parents=True)
            personal.write_text(
                "MORNING_BRIEF_TEST_PRIORITY=personal\n"
                "MORNING_BRIEF_TEST_FALLBACK=available\n",
                encoding="utf-8",
            )

            env = {
                "LOCALAPPDATA": str(root),
                "MORNING_BRIEF_TEST_PRIORITY": "",
                "MORNING_BRIEF_TEST_FALLBACK": "",
            }
            with mock.patch.dict(os.environ, env, clear=False), mock.patch.object(
                loader, "_find_project_root", return_value=root / "project",
            ):
                loader.load_env()
                self.assertEqual(os.environ["MORNING_BRIEF_TEST_PRIORITY"], "project")
                self.assertEqual(os.environ["MORNING_BRIEF_TEST_FALLBACK"], "available")


if __name__ == "__main__":
    unittest.main()
