"""
ingest_to_dashboard.py
======================
Push a StructuredBrief JSON result into the dashboard's Postgres cache via
the /api/morning-verdict/ingest endpoint.

Usage — pipe from Claude CLI or Codex:

    claude --skill morning-brief | python ingest_to_dashboard.py

Or from a saved JSON file:

    python ingest_to_dashboard.py brief_output.json

Or inline:

    python ingest_to_dashboard.py --json '{"mood": {...}, ...}'

Required env vars:
    VERCEL_INGEST_URL      Base URL of the deployed dashboard, e.g.
                           https://market-dashboard.vercel.app
    BRIEF_INGEST_KEY       Secret that matches BRIEF_INGEST_KEY on Vercel.

Optional:
    BRIEF_PROVIDER         "deepseek" | "gemini" | "openai" | "claude"
                           Defaults to "claude" (appropriate for CLI runs).
    BRIEF_GENERATED_BY     Tag shown in the dashboard's provenance field.
                           Defaults to "cli:<provider>".
"""
from __future__ import annotations

import datetime
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request

# Load .env / .env.local before anything touches os.environ
from _env_loader import load_env as _load_env
_load_env()


def _read_input(argv: list[str]) -> str:
    """Read JSON string from: positional arg file, --json flag, or stdin."""
    if len(argv) >= 2:
        if argv[1] == "--json":
            if len(argv) < 3:
                print("--json requires an argument", file=sys.stderr)
                sys.exit(2)
            return argv[2]
        # treat first arg as a file path
        path = argv[1]
        if not os.path.exists(path):
            print(
                f"\nERROR: File not found: {path!r}\n\n"
                "Options:\n"
                "  1. Re-run and push in one step:  python cli_run.py --provider gemini --post\n"
                "  2. Save first, then ingest:       python cli_run.py --out brief_output.json\n"
                "                                    python ingest_to_dashboard.py brief_output.json\n"
                "  3. Pipe JSON via stdin:            echo '{...}' | python ingest_to_dashboard.py\n",
                file=sys.stderr,
            )
            sys.exit(2)
        with open(path, encoding="utf-8") as fh:
            return fh.read()
    # read from stdin
    return sys.stdin.read()


def _hash(payload: str) -> str:
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def _push(structured_json: object, provider: str, generated_by: str) -> dict:
    base = os.environ.get("VERCEL_INGEST_URL", "").rstrip("/")
    key = os.environ.get("BRIEF_INGEST_KEY", "")
    if not base or not key:
        print(
            "ERROR: VERCEL_INGEST_URL and BRIEF_INGEST_KEY must be set.",
            file=sys.stderr,
        )
        sys.exit(2)

    url = f"{base}/api/morning-verdict/ingest"
    payload_str = json.dumps(structured_json, ensure_ascii=False)
    body = json.dumps(
        {
            "provider": provider,
            "htmlBody": "",
            "structuredJson": structured_json,
            "verdictJson": structured_json,
            "generatedBy": generated_by,
            "inputHash": _hash(payload_str),
        },
        ensure_ascii=False,
    ).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace")
        print(f"HTTP {e.code}: {body_text}", file=sys.stderr)
        sys.exit(1)


def main() -> None:
    raw = _read_input(sys.argv)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"JSON parse error: {exc}", file=sys.stderr)
        sys.exit(1)

    provider = os.environ.get("BRIEF_PROVIDER", "claude")
    generated_by = os.environ.get(
        "BRIEF_GENERATED_BY",
        f"cli:{provider}:{datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M')}",
    )

    result = _push(data, provider, generated_by)
    print(json.dumps(result, indent=2))
    print(
        f"\n✓ Ingested as provider={provider!r}, bucketAt={result.get('bucketAt', '?')}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
