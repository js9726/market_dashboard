"""Opt-in local HTTP smoke helper; invoked by postgres-smoke.test.ts."""
import argparse
import json
import os
import re
from pathlib import Path
import sys
import urllib.parse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from worker import Client, process_job


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--provider", choices=["fixture", "claude"], required=True)
    args = parser.parse_args()
    base = os.environ["DASHBOARD_URL"]
    if urllib.parse.urlsplit(base).hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise RuntimeError("SMOKE_REQUIRES_LOOPBACK")
    client = Client(base, os.environ["RESEARCH_WORKER_TOKEN"])
    job = client.post("claim", provider="claude")["job"]
    if not job:
        raise RuntimeError("SMOKE_JOB_MISSING")
    kwargs = {}
    if args.provider == "fixture":
        def fixture(provider, context, template, cancel, **_):
            return template, None
        kwargs["generator"] = fixture
    receipt = process_job(client, job, Path(os.environ["JIE_WIKI_ROOT"]), **kwargs)
    print(json.dumps(receipt))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        code = str(error)
        print(json.dumps({"error": code if re.fullmatch(r"[A-Z][A-Z0-9_]{0,79}", code) else type(error).__name__}))
        raise SystemExit(1)
