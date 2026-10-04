"""Outbound research worker. Nothing runs without --execute; no service installation."""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import threading
import urllib.error
import urllib.parse
import urllib.request

from context import build_context
from provider_adapter import generate
from collectors import collect_market, collect_news

class WorkerError(RuntimeError):
    pass

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward the dedicated worker token to another origin/login route.
        raise WorkerError("UNEXPECTED_REDIRECT")

class Client:
    def __init__(self, base, token):
        parsed = urllib.parse.urlsplit(base)
        if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
            raise WorkerError("INVALID_DASHBOARD_URL")
        if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}):
            raise WorkerError("HTTPS_REQUIRED")
        if not parsed.hostname or len(token) < 32:
            raise WorkerError("WORKER_CONFIGURATION_REQUIRED")
        self.url, self.token = base.rstrip("/") + "/api/research/worker", token
        self.opener = urllib.request.build_opener(NoRedirect())

    def post(self, operation, **fields):
        body = json.dumps({"operation": operation, **fields}, allow_nan=False).encode()
        request = urllib.request.Request(self.url, data=body, headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/json"})
        try:
            with self.opener.open(request, timeout=30) as response:
                return json.loads(response.read(2_000_001))
        except urllib.error.HTTPError as error:
            raise WorkerError(f"WORKER_HTTP_{error.code}") from None
        except (OSError, ValueError) as error:
            raise WorkerError("WORKER_CONNECTION_FAILED") from error

def evidence_for(ticker, directory):
    if not directory:
        return [], "No collector evidence directory configured"
    if not re.fullmatch(r"[A-Z][A-Z0-9.-]{0,9}", ticker):
        raise WorkerError("INVALID_TICKER")
    root = Path(directory).resolve()
    path = root / (ticker + ".json")
    if path.is_symlink() or not path.resolve().is_relative_to(root):
        raise WorkerError("EVIDENCE_PATH_ESCAPE")
    if not path.exists():
        return [], "Collector evidence unavailable"
    if path.stat().st_size > 1_000_000:
        raise WorkerError("EVIDENCE_TOO_LARGE")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if payload["ticker"] != ticker or not isinstance(payload["sources"], list):
            raise ValueError()
        for source in payload["sources"]:
            if source["contentHash"] != hashlib.sha256(source["text"].encode()).hexdigest():
                raise ValueError()
        json.dumps(payload, allow_nan=False)
        return payload["sources"], "Collector evidence loaded; server validates timestamps and citations"
    except (KeyError, TypeError, ValueError) as error:
        raise WorkerError("INVALID_COLLECTOR_EVIDENCE") from error

def process_job(client, job, wiki_root, mode="lexical", evidence_dir=None, generator=generate, builder=build_context, heartbeat_seconds=30, live_market=False, grounded_news=False):
    identity = {"id": job["id"], "leaseToken": job["leaseToken"]}
    stop, cancelled = threading.Event(), threading.Event()
    def heartbeat():
        while not stop.wait(heartbeat_seconds):
            try:
                client.post("heartbeat", **identity)
            except Exception:
                cancelled.set()
                return
    thread = threading.Thread(target=heartbeat, daemon=True)
    thread.start()
    try:
        evidence, evidence_status = evidence_for(job["ticker"], evidence_dir)
        collector_gaps = []
        for enabled, collector in [(live_market, collect_market), (grounded_news, collect_news)]:
            if enabled and not cancelled.is_set():
                collected, gaps = collector(job["ticker"])
                collected_ids = {s["id"] for s in collected}
                evidence = [s for s in evidence if s.get("id") not in collected_ids] + collected
                collector_gaps.extend(gaps)
        if len(evidence) > 100:
            priority = {"chart_daily": 0, "chart_weekly": 0, "quote": 1, "fundamental": 2, "search_grounded": 3}
            evidence = sorted(evidence, key=lambda s: priority.get(s.get("kind"), 4))[:100]
            collector_gaps.append("Evidence truncated to 100 sources; charts and market evidence retained first")
        context = builder(wiki_root, job, job["thread"], evidence, mode=mode)
        context["evidenceStatus"] = evidence_status
        context["collectorGaps"] = collector_gaps
        if cancelled.is_set():
            raise WorkerError("LEASE_LOST")
        client.post("checkpoint", **identity, context=context)
        report, session_id = generator(job["provider"], context, job["template"], cancelled,
                                       session_id=job["thread"].get("sessionId"), cwd=str(Path(__file__).resolve().parent))
        if cancelled.is_set():
            raise WorkerError("LEASE_LOST")
        # Persist the observed model/usage alongside the same source-hashed context.
        client.post("checkpoint", **identity, context=context)
        fields = {**identity, "report": report}
        if session_id:
            fields["sessionId"] = session_id
        try:
            client.post("complete", **fields)
        except WorkerError:
            # Response may have been lost AFTER commit. Read the receipt before retrying.
            receipt = client.post("receipt", **identity)
            if not receipt.get("persisted"):
                raise
        receipt = client.post("receipt", **identity)
        if receipt.get("id") != job["id"] or not receipt.get("persisted") or not receipt.get("verdictId") or receipt.get("status") not in {"partial", "succeeded"}:
            raise WorkerError("INGEST_READBACK_FAILED")
        return receipt
    except Exception:
        if not cancelled.is_set():
            try:
                client.post("fail", **identity)
            except Exception:
                pass
        raise
    finally:
        stop.set()
        thread.join(timeout=2)

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--provider", choices=["claude", "deepseek"], required=True)
    parser.add_argument("--retrieval", choices=["lexical", "hybrid"], default="lexical")
    parser.add_argument("--execute", action="store_true", help="Explicitly allow claiming jobs and selected provider calls")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--live-market", action="store_true", help="Fetch read-only Yahoo market/fundamental evidence")
    parser.add_argument("--grounded-news", action="store_true", help="Explicitly enable Gemini search-grounded news collection (metered)")
    parser.add_argument("--poll-seconds", type=int, default=15)
    args = parser.parse_args(argv)
    if not args.execute:
        print("Not started. Add --execute only after configuration, migration and live-run approval.")
        return 0
    if args.poll_seconds < 5:
        parser.error("poll-seconds must be >=5")
    client = Client(os.environ.get("DASHBOARD_URL", ""), os.environ.get("RESEARCH_WORKER_TOKEN", ""))
    wiki_root = Path(os.environ["JIE_WIKI_ROOT"])
    if not (wiki_root / "scripts/retrieval/query.py").is_file():
        raise WorkerError("WIKI_ROOT_REQUIRED")
    while True:
        try:
            job = client.post("claim", provider=args.provider).get("job")
            if job:
                receipt = process_job(client, job, wiki_root, args.retrieval, os.environ.get("RESEARCH_EVIDENCE_DIR"), live_market=args.live_market, grounded_news=args.grounded_news)
                print(json.dumps({"id": receipt["id"], "status": receipt["status"], "persisted": True}))
        except Exception:
            # Deliberately exclude exception payloads (provider/HTTP messages may contain secrets).
            print("Research attempt failed; inspect the dashboard job status.")
            if args.once:
                return 1
        if args.once:
            return 0
        threading.Event().wait(args.poll_seconds)

if __name__ == "__main__":
    raise SystemExit(main())
