"""Offline context tests against the canonical chunker and ranker; no provider calls."""
from copy import deepcopy
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

WORKER = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("research_context", WORKER / "context.py")
context = importlib.util.module_from_spec(spec)
spec.loader.exec_module(context)
WIKI = WORKER.parents[1].parent / "jie_wiki"


class ContextTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.modules = context._retrieval_modules(WIKI)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.git("init", "-q")
        self.text = "# Exact rule\nNTAP risk must remain 0.5%, not a paraphrase.\n" * 35
        for path in context.MANDATORY_PATHS:
            self.write(path, self.text)
        for path in ("wiki/operations/secret.md", "wiki/trading/journal/private.md",
                     "wiki/trading/companies/ntap.md", "wiki/_private/secret.md"):
            self.write(path, "NTAP NTAP NTAP question private unrelated\n")
        self.git("add", ".")
        self.git("-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                 "commit", "-qm", "test corpus")
        self.job = dict(id="job-1", userId="owner-1", threadId="thread-1", ticker="NTAP",
                        question="What are the risk rules?", horizon="swing",
                        provider="claude", asOf="2026-10-04T10:00:00Z")
        self.state = dict(userId="owner-1", threadId="thread-1", summary="Review the trigger",
                          previousResultId="result-1")
        self.loader = patch.object(context, "_retrieval_modules", return_value=self.modules)
        self.loader.start()
        self.addCleanup(self.loader.stop)
        self.no_embed = patch.object(self.modules[0], "embed_texts",
                                     side_effect=AssertionError("No API calls in tests"))
        self.no_embed.start()
        self.addCleanup(self.no_embed.stop)

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.root, stderr=subprocess.PIPE)

    def write(self, path, text):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(text.encode("utf-8"))

    def build(self, **kwargs):
        return context.build_context(self.root, self.job, self.state, [], **kwargs)

    def test_mandatory_preserved_in_full_with_provenance_and_state(self):
        result = self.build()
        self.assertEqual(result["promptVersion"], "research-2026-10-04")
        self.assertEqual([p["path"] for p in result["mandatory"]], list(context.MANDATORY_PATHS))
        for passage in result["mandatory"]:
            self.assertEqual(passage["text"], self.text)
            self.assertEqual(passage["startLine"], 1)
            self.assertEqual(passage["endLine"], 70)
            self.assertEqual(len(passage["sourceSha256"]), 64)
            self.assertEqual(passage["revision"], self.git("rev-parse", "HEAD").decode().strip())
        self.assertEqual(result["state"], dict(summary="Review the trigger", previousResultId="result-1"))
        self.assertEqual(result["retrieval"]["mode"], "lexical")
        self.assertIsNone(result["retrieval"]["index"])
        self.assertLessEqual(len(result["supplemental"]), 6)

    def test_lexical_scope_filtered_before_ranking(self):
        query = self.modules[1]
        original = query.search_detailed

        def check(question, rows, vectors, meta, mode, limit):
            self.assertTrue(rows)
            self.assertTrue(all(context.allowed_path(row["path"]) for row in rows))
            return original(question, rows, vectors, meta, mode, limit)

        with patch.object(query, "search_detailed", side_effect=check) as rank:
            self.build()
            rank.assert_called_once()

    def test_hybrid_rows_and_vectors_filtered_before_ranking_and_no_repair(self):
        store, query, providers = self.modules
        documents = store.read_corpus(self.root)
        rows = store.build_chunks(documents)
        vectors = store.np.arange(len(rows) * 2).reshape(len(rows), 2)
        provider = providers.named("gemini")
        meta = dict(source="worktree", embedding=provider.as_meta(), model=provider.model,
                    dimensions=2, chunker=store.CHUNKER, built_at="2026-10-04T10:00:00Z")
        selected = [i for i, row in enumerate(rows) if context.allowed_path(row["path"])]

        def check(question, ranked_rows, ranked_vectors, metadata, mode, limit):
            self.assertEqual(ranked_rows, [rows[i] for i in selected])
            self.assertTrue(store.np.array_equal(ranked_vectors, vectors[selected]))
            self.assertEqual(mode, "hybrid")
            return []

        with patch.object(store, "prepare_index", return_value=(rows, vectors, meta, {"status": "clean"})) as prepare, \
                patch.object(store, "assert_fresh") as fresh, \
                patch.object(query, "search_detailed", side_effect=check):
            result = self.build(mode="hybrid")
            self.assertFalse(prepare.call_args.kwargs["allow_embed"])
            fresh.assert_called_once_with(self.root, rows, meta)
            self.assertEqual(result["retrieval"]["index"]["scopedChunks"], len(selected))

    def test_stale_sources_fail_after_ranking(self):
        query = self.modules[1]
        original = query.search_detailed

        def change(*args):
            hits = original(*args)
            self.write(context.MANDATORY_PATHS[0], self.text + "Changed\n")
            return hits

        with patch.object(query, "search_detailed", side_effect=change):
            with self.assertRaisesRegex(context.ContextError, "changed"):
                self.build()

    def test_missing_mandatory_and_untracked_replacement_fail(self):
        path = context.MANDATORY_PATHS[0]
        self.git("rm", "--cached", path)
        with self.assertRaisesRegex(context.ContextError, "mandatory"):
            self.build()

    def test_cross_user_and_cross_thread_state_fail_before_retrieval(self):
        for key in ("userId", "threadId"):
            state = deepcopy(self.state)
            state[key] = "someone-else"
            with patch.object(context, "_retrieval_modules") as loader:
                with self.assertRaisesRegex(context.ContextError, "belong"):
                    context.build_context(self.root, self.job, state, [])
                loader.assert_not_called()

    def test_hybrid_failure_has_no_silent_fallback(self):
        store, query, _ = self.modules
        with patch.object(store, "prepare_index", side_effect=ValueError("stale index")), \
                patch.object(query, "search_detailed") as rank:
            with self.assertRaisesRegex(context.ContextError, "retrieval failed"):
                self.build(mode="hybrid")
            rank.assert_not_called()

    def test_evidence_is_preserved_without_invention_or_aliasing(self):
        evidence = [{"id": "source-1", "status": "unavailable", "reason": "No news feed"}]
        result = context.build_context(self.root, self.job, self.state, evidence)
        self.assertEqual(result["evidence"], evidence)
        for passage in result["mandatory"] + result["supplemental"]:
            self.assertNotIn("No news feed", passage["text"])
            self.assertTrue(context.allowed_path(passage["path"]))
        result["evidence"][0]["reason"] = "changed"
        self.assertEqual(evidence[0]["reason"], "No news feed")

    def test_invalid_json_evidence_and_naive_timestamp_rejected(self):
        with self.assertRaisesRegex(context.ContextError, "finite JSON"):
            context.build_context(self.root, self.job, self.state, [float("nan")])
        self.job["asOf"] = "2026-10-04T10:00:00"
        with self.assertRaisesRegex(context.ContextError, "timezone"):
            self.build()

    def test_path_policy(self):
        for path in ("wiki/trading/concepts/../journal/secret.md", "wiki/trading/concepts/_private/a.md",
                     "wiki/trading/concepts/.hidden.md", "wiki/trading/concepts\\file.md"):
            self.assertFalse(context.allowed_path(path))


if __name__ == "__main__":
    unittest.main()
