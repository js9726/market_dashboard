"""Exercise the installed LangGraph with offline collectors/providers/API doubles."""
from copy import deepcopy
import builtins
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import workflow


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.cancelled = threading.Event()
        self.operations = []
        self.checkpoints = []
        self.receipt = {"id": "job", "persisted": True, "verdictId": "saved", "status": "partial"}

        def post(operation, **fields):
            self.operations.append(operation)
            if operation == "checkpoint":
                self.checkpoints.append(deepcopy(fields["context"]))
            return self.receipt if operation == "receipt" else {}

        self.options = dict(
            client=Mock(post=Mock(side_effect=post)),
            job={"id": "job", "leaseToken": "private-lease", "ticker": "NTAP",
                 "provider": "claude", "template": {}, "thread": {"sessionId": "exact-session"}},
            wiki_root=Path("wiki"), mode="lexical", evidence_dir=None,
            generator=Mock(return_value=({}, None)), builder=Mock(return_value={}),
            evidence_loader=Mock(return_value=([], "no files")),
            market_collector=Mock(return_value=([], [])), news_collector=Mock(return_value=([], [])),
            cancelled=self.cancelled)

    def test_real_graph_has_explicit_nodes_and_no_second_checkpoint_store(self):
        from langgraph.graph.state import CompiledStateGraph
        graph = workflow.build_workflow(**self.options)
        self.assertIsInstance(graph, CompiledStateGraph)
        self.assertIsNone(graph.checkpointer)
        self.assertEqual(set(graph.get_graph().nodes), {
            "__start__", "__end__", "evidence_file", "wiki_context", "checkpoint_context",
            "provider_synthesis", "checkpoint_usage", "complete", "readback"})
        self.assertEqual(workflow.run_workflow(**self.options), self.receipt)
        self.options["market_collector"].assert_not_called()
        self.options["news_collector"].assert_not_called()
        self.options["generator"].assert_called_once()

    def test_collectors_replace_ids_then_cap_sources_with_charts_first(self):
        self.options.update(live_market=True, grounded_news=True)
        self.options["evidence_loader"].return_value = ([
            {"id": "quote", "kind": "quote", "text": "old"},
            *[{"id": str(i), "kind": "other"} for i in range(110)],
            {"id": "daily", "kind": "chart_daily"}, {"id": "weekly", "kind": "chart_weekly"}], "loaded")
        self.options["market_collector"].return_value = ([{"id": "quote", "kind": "quote", "text": "new"}], ["market gap"])
        self.options["news_collector"].return_value = ([{"id": "news", "kind": "search_grounded"}], ["news gap"])
        workflow.run_workflow(**self.options)
        evidence = self.options["builder"].call_args.args[3]
        self.assertEqual(len(evidence), 100)
        self.assertEqual([s["id"] for s in evidence[:4]], ["daily", "weekly", "quote", "news"])
        self.assertEqual(evidence[2]["text"], "new")
        self.assertEqual(self.checkpoints[0]["collectorGaps"][:2], ["market gap", "news gap"])
        self.assertIn("truncated", self.checkpoints[0]["collectorGaps"][2])

    def test_provider_observed_usage_is_checkpointed_after_synthesis(self):
        def generate(provider, context, template, cancelled, **options):
            self.assertEqual(self.operations, ["checkpoint"])
            self.assertEqual(provider, "claude")
            self.assertEqual(options["session_id"], "exact-session")
            context["providerUsage"] = {"tokens": 12}
            return {"same": "report"}, "resumed-session"
        self.options["generator"].side_effect = generate
        workflow.run_workflow(**self.options)
        self.assertNotIn("providerUsage", self.checkpoints[0])
        self.assertEqual(self.checkpoints[1]["providerUsage"], {"tokens": 12})
        self.assertEqual(self.operations, ["checkpoint", "checkpoint", "complete", "receipt"])
        complete = self.options["client"].post.call_args_list[2]
        self.assertEqual(complete.kwargs["sessionId"], "resumed-session")

    def test_cancel_after_checkpoint_prevents_provider_and_further_writes(self):
        def post(operation, **fields):
            self.operations.append(operation)
            self.cancelled.set()
            return {}
        self.options["client"].post.side_effect = post
        with self.assertRaisesRegex(workflow.WorkerError, "LEASE_LOST"):
            workflow.run_workflow(**self.options)
        self.options["generator"].assert_not_called()
        self.assertEqual(self.operations, ["checkpoint"])

    def test_cancel_before_completion_blocks_commit(self):
        original = self.options["client"].post.side_effect
        def post(operation, **fields):
            result = original(operation, **fields)
            if len(self.checkpoints) == 2:
                self.cancelled.set()
            return result
        self.options["client"].post.side_effect = post
        with self.assertRaisesRegex(workflow.WorkerError, "LEASE_LOST"):
            workflow.run_workflow(**self.options)
        self.assertEqual(self.operations, ["checkpoint", "checkpoint"])

    def test_invalid_readback_is_not_success(self):
        self.receipt["id"] = "different-job"
        with self.assertRaisesRegex(workflow.WorkerError, "INGEST_READBACK_FAILED"):
            workflow.run_workflow(**self.options)

    def test_checkpoint_failure_prevents_generation(self):
        self.options["client"].post.side_effect = workflow.WorkerError("WORKER_HTTP_500")
        with self.assertRaisesRegex(workflow.WorkerError, "WORKER_HTTP_500"):
            workflow.run_workflow(**self.options)
        self.options["generator"].assert_not_called()

    def test_wiki_failure_stops_graph_before_checkpoint_or_provider(self):
        self.options.update(mode="hybrid", wiki_store="pg")
        self.options["builder"].side_effect = ValueError("stale wiki generation")
        with self.assertRaisesRegex(ValueError, "stale wiki generation"):
            workflow.run_workflow(**self.options)
        self.options["builder"].assert_called_once()
        self.options["client"].post.assert_not_called()
        self.options["generator"].assert_not_called()

    def test_missing_langgraph_fails_clearly_without_legacy_execution(self):
        original_import = builtins.__import__
        def import_module(name, *args, **kwargs):
            if name == "langgraph.graph":
                raise ImportError("offline missing dependency")
            return original_import(name, *args, **kwargs)
        with patch("builtins.__import__", side_effect=import_module):
            with self.assertRaisesRegex(workflow.WorkerError, "LANGGRAPH_DEPENDENCY_REQUIRED"):
                workflow.run_workflow(**self.options)
        self.options["builder"].assert_not_called()
        self.options["generator"].assert_not_called()
        self.options["client"].post.assert_not_called()

    def test_pg_selection_is_explicit_and_requires_hybrid(self):
        self.options["wiki_store"] = "pg"
        with self.assertRaisesRegex(workflow.WorkerError, "REQUIRES_HYBRID"):
            workflow.run_workflow(**self.options)
        self.options["builder"].assert_not_called()
        self.options["mode"] = "hybrid"
        workflow.run_workflow(**self.options)
        self.assertEqual(self.options["builder"].call_args.kwargs, {"mode": "hybrid", "store_type": "pg"})

    def test_environment_enabled_langsmith_does_not_trace_private_context(self):
        from langsmith import utils
        def generate(*args, **kwargs):
            self.assertFalse(utils.tracing_is_enabled())
            return {}, None
        self.options["generator"].side_effect = generate
        with patch.dict("os.environ", {"LANGSMITH_TRACING": "true", "LANGCHAIN_TRACING_V2": "true",
                                       "LANGSMITH_API_KEY": "offline-test"}), \
                patch("langsmith.client.Client.create_run") as create, \
                patch("langsmith.client.Client.update_run") as update:
            workflow.run_workflow(**self.options)
            create.assert_not_called()
            update.assert_not_called()


if __name__ == "__main__":
    unittest.main()
