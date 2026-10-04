import hashlib
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import worker
import provider_adapter as adapter

class WorkerTests(unittest.TestCase):
    def job(self):
        return {"id": "job", "leaseToken": "lease", "ticker": "NTAP", "provider": "claude", "template": {}, "thread": {"sessionId": "exact-session"}}

    def client(self):
        client = Mock()
        client.post.side_effect = lambda operation, **fields: {"id": "job", "verdictId": "saved", "persisted": True, "status": "partial"} if operation == "receipt" else {"ok": True}
        return client

    def test_requires_explicit_execution(self):
        with patch.object(worker, "Client") as client:
            self.assertEqual(worker.main(["--provider", "claude"]), 0)
            client.assert_not_called()

    def test_url_and_credential_scope(self):
        for url in ["http://example.com", "https://user:pass@example.com", "https://example.com/path", "https://example.com/?token=x"]:
            with self.assertRaises(worker.WorkerError):
                worker.Client(url, "x" * 32)
        self.assertTrue(worker.Client("http://localhost:3000", "x" * 32).url.endswith("/api/research/worker"))
        with self.assertRaises(worker.WorkerError):
            worker.Client("https://example.com", "short")

    def test_context_precedes_generation_and_readback(self):
        client = self.client()
        generate = Mock(return_value=({"report": "partial"}, None))
        result = worker.process_job(client, self.job(), Path("wiki"), generator=generate, builder=Mock(return_value={}))
        self.assertTrue(result["persisted"])
        self.assertEqual([c.args[0] for c in client.post.call_args_list], ["checkpoint", "checkpoint", "complete", "receipt"])
        self.assertEqual(generate.call_args.kwargs["session_id"], "exact-session")

    def test_lost_completion_response_recovers_by_receipt_without_regeneration(self):
        client = self.client()
        def post(operation, **_):
            if operation == "complete":
                raise worker.WorkerError("response lost")
            return {"id": "job", "verdictId": "saved", "persisted": True, "status": "partial"}
        client.post.side_effect = post
        generate = Mock(return_value=({}, None))
        self.assertTrue(worker.process_job(client, self.job(), Path("wiki"), generator=generate, builder=Mock(return_value={}))["persisted"])
        generate.assert_called_once()

    def test_provider_failure_does_not_complete_or_change_provider(self):
        client = self.client()
        with self.assertRaises(RuntimeError):
            worker.process_job(client, self.job(), Path("wiki"), generator=Mock(side_effect=RuntimeError("failed")), builder=Mock(return_value={}))
        self.assertEqual([c.args[0] for c in client.post.call_args_list], ["checkpoint", "fail"])

    def test_lease_loss_prevents_completion(self):
        client = self.client()
        client.post.side_effect = lambda op, **_: (_ for _ in ()).throw(worker.WorkerError("lost")) if op == "heartbeat" else {}
        def generate(provider, context, template, cancel, **_):
            self.assertTrue(cancel.wait(.5))
            return {}, None
        with self.assertRaises(worker.WorkerError):
            worker.process_job(client, self.job(), Path("wiki"), generator=generate, builder=Mock(return_value={}), heartbeat_seconds=.01)
        self.assertNotIn("complete", [c.args[0] for c in client.post.call_args_list])

    def test_evidence_hash_and_ticker_verified(self):
        with tempfile.TemporaryDirectory() as folder:
            p = Path(folder) / "NTAP.json"
            source = {"text": "source", "contentHash": hashlib.sha256(b"source").hexdigest()}
            p.write_text(json.dumps({"ticker": "NTAP", "sources": [source]}))
            self.assertEqual(worker.evidence_for("NTAP", folder)[0], [source])
            source["text"] = "changed"
            p.write_text(json.dumps({"ticker": "NTAP", "sources": [source]}))
            with self.assertRaises(worker.WorkerError): worker.evidence_for("NTAP", folder)
        self.assertEqual(worker.evidence_for("NTAP", None)[0], [])

class ProviderTests(unittest.TestCase):
    def test_no_nonfinite_or_non_object_json(self):
        for raw in ['{"score": NaN}', '[]', 'not json']:
            with self.assertRaises(adapter.ProviderError): adapter.parse_json(raw)

    def test_provider_selection_fail_closed(self):
        with self.assertRaises(adapter.ProviderError): adapter.generate("other", {}, {}, threading.Event())
        with patch.dict("os.environ", {}, clear=True), patch.object(adapter.urllib.request, "urlopen") as network:
            with self.assertRaises(adapter.ProviderError): adapter.generate("deepseek", {}, {}, threading.Event())
            network.assert_not_called()

    def test_deepseek_requires_complete_json_and_explicit_model(self):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = json.dumps({"choices": [{"finish_reason": "length", "message": {"content": "{}"}}]}).encode()
        with patch.dict("os.environ", {"DEEPSEEK_API_KEY": "test", "RESEARCH_DEEPSEEK_MODEL": "explicit-model"}), patch.object(adapter.urllib.request, "urlopen", return_value=response) as network:
            with self.assertRaisesRegex(adapter.ProviderError, "TRUNCATED"): adapter.generate("deepseek", {}, {}, threading.Event())
            body = json.loads(network.call_args.args[0].data)
            self.assertEqual(body["model"], "explicit-model")
            self.assertEqual(body["response_format"], {"type": "json_object"})

    def test_claude_scrubs_paid_credentials_and_resumes_exact_thread(self):
        session = "00000000-0000-4000-8000-000000000001"
        process = Mock(returncode=0)
        process.communicate.return_value = (json.dumps({"subtype": "success", "session_id": session, "result": "{}"}), "")
        with patch.dict("os.environ", {"ANTHROPIC_API_KEY": "secret", "ANTHROPIC_AUTH_TOKEN": "secret", "CLAUDE_CODE_USE_BEDROCK": "1", "CLAUDE_CODE_OAUTH_TOKEN": "oauth"}), patch.object(adapter.shutil, "which", return_value="claude.exe"), patch.object(adapter.subprocess, "Popen", return_value=process) as spawn:
            report, returned = adapter.generate("claude", {}, {}, threading.Event(), session_id=session)
            self.assertEqual(returned, session)
            command = spawn.call_args.args[0]
            self.assertEqual(command[command.index("--resume") + 1], session)
            self.assertNotIn("--continue", command)
            self.assertEqual(command[command.index("--tools") + 1], "")
            self.assertIn("--safe-mode", command)
            env = spawn.call_args.kwargs["env"]
            self.assertNotIn("ANTHROPIC_API_KEY", env)
            self.assertNotIn("CLAUDE_CODE_USE_BEDROCK", env)
            self.assertEqual(env["CLAUDE_CODE_OAUTH_TOKEN"], "oauth")

if __name__ == "__main__": unittest.main()
