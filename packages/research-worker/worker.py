"""Outbound research worker. Nothing runs without --execute; no service installation."""
from __future__ import annotations
import argparse
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

from workflow import ConcurrentUpdate, WorkerError, run_workflow

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
            if error.code == 409:
                try:
                    payload = json.loads(error.read(4096))
                    if isinstance(payload, dict) and payload.get("error") == "CONCURRENT_UPDATE_RETRY":
                        raise ConcurrentUpdate("CONCURRENT_UPDATE_RETRY") from None
                except (ValueError, OSError):
                    pass
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

def process_job(client, job, wiki_root, mode="lexical", evidence_dir=None, generator=generate, builder=build_context, heartbeat_seconds=30, live_market=False, grounded_news=False, wiki_store="local"):
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
        return run_workflow(client=client, job=job, wiki_root=wiki_root, mode=mode,
                            evidence_dir=evidence_dir, generator=generator, builder=builder,
                            evidence_loader=evidence_for, market_collector=collect_market,
                            news_collector=collect_news, cancelled=cancelled,
                            live_market=live_market, grounded_news=grounded_news,
                            wiki_store=wiki_store)
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
    parser.add_argument("--wiki-store", choices=["local", "pg"], default="local", help="Hybrid index backend; pg requires --retrieval hybrid")
    parser.add_argument("--execute", action="store_true", help="Explicitly allow claiming jobs and selected provider calls")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--live-market", action="store_true", help="Fetch read-only Yahoo market/fundamental evidence")
    parser.add_argument("--grounded-news", action="store_true", help="Explicitly enable Gemini search-grounded news collection (metered)")
    parser.add_argument("--poll-seconds", type=int, default=15)
    args = parser.parse_args(argv)
    if args.wiki_store == "pg" and args.retrieval != "hybrid":
        parser.error("--wiki-store pg requires --retrieval hybrid")
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
                receipt = process_job(client, job, wiki_root, args.retrieval, os.environ.get("RESEARCH_EVIDENCE_DIR"), live_market=args.live_market, grounded_news=args.grounded_news, wiki_store=args.wiki_store)
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
