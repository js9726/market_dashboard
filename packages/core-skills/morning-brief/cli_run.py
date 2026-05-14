"""
cli_run.py
==========
End-to-end CLI morning-brief runner.

Generates a StructuredBrief using an AI provider (DeepSeek / Gemini / OpenAI /
Claude) then optionally POSTs the result to the dashboard's Postgres cache.

Reads the prompt from `prompt.md` (same directory).  Feeds in the trader-style
framework, date, and watchlist. If `--post` is set it pipes the output to
`ingest_to_dashboard.py` automatically.

Usage:
    python cli_run.py                       # DeepSeek, no push
    python cli_run.py --provider gemini     # Gemini, no push
    python cli_run.py --provider deepseek --post   # generate + push to dashboard
    python cli_run.py --out brief.json      # save JSON to file

Required env vars per provider:
    deepseek  → DEEPSEEK_API_KEY
    gemini    → GEMINI_API_KEY
    openai    → OPENAI_API_KEY
    claude    → ANTHROPIC_API_KEY

For --post, also set:
    VERCEL_INGEST_URL
    BRIEF_INGEST_KEY

Optional:
    WATCHLIST   comma-separated list of tickers (overrides hardcoded default)
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

# Load .env / .env.local before anything touches os.environ
from _env_loader import load_env as _load_env
_load_env()

# ── same as ingest_to_dashboard.py (inline to keep CLI standalone) ───────────
import hashlib


def _hash(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()[:16]


def _push(structured_json: object, provider: str) -> dict:
    base = os.environ.get("VERCEL_INGEST_URL", "").rstrip("/")
    key = os.environ.get("BRIEF_INGEST_KEY", "")
    if not base or not key:
        print("VERCEL_INGEST_URL and BRIEF_INGEST_KEY must be set for --post.", file=sys.stderr)
        sys.exit(2)
    url = f"{base}/api/morning-verdict/ingest"
    payload_str = json.dumps(structured_json)
    ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M")
    body = json.dumps(
        {
            "provider": provider,
            "htmlBody": "",
            "structuredJson": structured_json,
            "verdictJson": structured_json,
            "generatedBy": f"cli_run:{provider}:{ts}",
            "inputHash": _hash(payload_str),
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"Ingest HTTP {e.code}: {e.read().decode()}", file=sys.stderr)
        sys.exit(1)


# ── prompt loading ────────────────────────────────────────────────────────────
ROOT = Path(__file__).parent


def _build_prompt(date_str: str, watchlist: list[str]) -> str:
    template = (ROOT / "prompt.md").read_text(encoding="utf-8")
    return (
        template
        .replace("{date_str}", date_str)
        .replace("{watchlist_str}", ", ".join(watchlist))
    )


# ── provider callers ──────────────────────────────────────────────────────────

def _call_deepseek(prompt: str) -> str:
    api_key = os.environ.get("DEEPSEEK_API_KEY", "")
    if not api_key:
        print("DEEPSEEK_API_KEY not set.", file=sys.stderr)
        sys.exit(2)
    body = json.dumps(
        {
            "model": "deepseek-chat",
            "messages": [{"role": "user", "content": prompt}],
            "response_format": {"type": "json_object"},
            "max_tokens": 6000,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        "https://api.deepseek.com/v1/chat/completions",
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.loads(r.read().decode("utf-8"))
    return data["choices"][0]["message"]["content"]


def _call_openai(prompt: str) -> str:
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        print("OPENAI_API_KEY not set.", file=sys.stderr)
        sys.exit(2)
    body = json.dumps(
        {
            "model": "gpt-4o",
            "messages": [{"role": "user", "content": prompt}],
            "response_format": {"type": "json_object"},
            "max_tokens": 6000,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.loads(r.read().decode("utf-8"))
    return data["choices"][0]["message"]["content"]


def _call_gemini(prompt: str) -> str:
    """Calls Gemini via the REST API with JSON-mode response."""
    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        print("GEMINI_API_KEY not set.", file=sys.stderr)
        sys.exit(2)
    model = "gemini-2.5-pro"
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        f"?key={api_key}"
    )
    body = json.dumps(
        {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "maxOutputTokens": 6000,
            },
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.loads(r.read().decode("utf-8"))
    return data["candidates"][0]["content"]["parts"][0]["text"]


def _call_claude(prompt: str) -> str:
    """Calls Claude via the Anthropic Messages API (no streaming)."""
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        print("ANTHROPIC_API_KEY not set.", file=sys.stderr)
        sys.exit(2)
    body = json.dumps(
        {
            "model": "claude-opus-4-5",
            "max_tokens": 6000,
            "messages": [{"role": "user", "content": prompt}],
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.loads(r.read().decode("utf-8"))
    return data["content"][0]["text"]


CALLERS = {
    "deepseek": _call_deepseek,
    "openai": _call_openai,
    "gemini": _call_gemini,
    "claude": _call_claude,
}

def _fetch_dashboard_watchlist() -> list[str]:
    """Fetch the owner's watchlist from the dashboard API."""
    base = os.environ.get("VERCEL_INGEST_URL", "").rstrip("/")
    key = os.environ.get("BRIEF_INGEST_KEY", "")
    if not base or not key:
        return []
    url = f"{base}/api/watchlist/export"
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {key}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read().decode("utf-8"))
            return data.get("tickers", [])
    except Exception as e:
        print(f"[cli_run] watchlist fetch failed ({e}), will use fallback.", file=sys.stderr)
        return []


def _top_screener_tickers(max_per_screener: int = 5) -> list[str]:
    """
    Pull the top tickers from the latest tv_screeners.json if available.
    Looks in the project's public/market-dashboard/ folder relative to this script.
    """
    candidates = [
        ROOT.parent.parent.parent / "apps" / "market_dashboard" / "public" / "market-dashboard" / "tv_screeners.json",
        ROOT / "tv_screeners.json",
    ]
    for path in candidates:
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                tickers: list[str] = []
                for screener in data.get("screeners", []):
                    hits = screener.get("hits", [])
                    for hit in hits[:max_per_screener]:
                        t = hit.get("ticker")
                        if t and t not in tickers:
                            tickers.append(t)
                return tickers
            except Exception:
                pass
    return []


def _parse_tickers(raw: str) -> list[str]:
    """Split a comma/space/newline-separated string into clean uppercase tickers."""
    return [t.strip().upper() for t in raw.replace("\n", ",").split(",") if t.strip()]


def _build_watchlist(cli_override: str | None, tv_tickers: list[str] | None = None) -> list[str]:
    """
    Build the final watchlist for the morning brief.

    Layer 1 — Personal watchlist (your curated holds + watchlist)
    ---------------------------------------------------------------
    Priority:
      a) --watchlist flag (manual one-off override)
      b) --tv-watchlist tickers extracted from Chrome MCP (passed via tv_tickers)
      c) WATCHLIST env var in .env.local
      d) Dashboard DB via /api/watchlist/export

    Layer 2 — Screener top tickers (new opportunities from today's TV screeners)
    ---------------------------------------------------------------
    Always merged on top of Layer 1 (deduplicated, max 8 new tickers).
    Read from tv_screeners.json (generated by tv_screener_fetch.py).

    Layer 3 — Empty fallback
    ---------------------------------------------------------------
    If nothing is available, return [] and let the LLM work with the snapshot.
    """
    personal: list[str] = []

    # a. CLI --watchlist flag
    if cli_override:
        personal = _parse_tickers(cli_override)

    # b. TV tickers extracted by Claude CLI via Chrome MCP
    if not personal and tv_tickers:
        personal = tv_tickers

    # c. Env var
    if not personal:
        env_raw = os.environ.get("WATCHLIST", "")
        if env_raw:
            personal = _parse_tickers(env_raw)

    # d. Dashboard DB
    if not personal:
        personal = _fetch_dashboard_watchlist()

    # Layer 2 — always merge screener top tickers
    screener = _top_screener_tickers()
    screener_extras = [t for t in screener if t not in personal][:8]
    combined = personal + screener_extras

    return combined


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a StructuredBrief via an AI provider.")
    parser.add_argument(
        "--provider",
        default="deepseek",
        choices=list(CALLERS),
        help="Which AI provider to use (default: deepseek)",
    )
    parser.add_argument("--post", action="store_true", help="Push result to the dashboard ingest API")
    parser.add_argument("--out", default=None, help="Save JSON output to a file")
    parser.add_argument(
        "--watchlist",
        default=None,
        help="Comma-separated tickers — overrides WATCHLIST env var and dashboard DB",
    )
    parser.add_argument(
        "--tv-watchlist",
        default=None,
        dest="tv_watchlist",
        help="Tickers extracted from TradingView by Claude CLI Chrome MCP (comma-separated). "
             "Used by the morning-brief SKILL.md step that navigates the TV watchlist URL.",
    )
    args = parser.parse_args()

    tv_tickers = _parse_tickers(args.tv_watchlist) if args.tv_watchlist else None
    watchlist = _build_watchlist(args.watchlist, tv_tickers=tv_tickers)

    # Build date string (Malaysia time)
    now_myt = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=8)
    # %-d (Linux) and %#d (Windows) both mean "day without leading zero".
    # Use a portable alternative that works on all platforms.
    date_str = now_myt.strftime("%A, %B {day}, %Y").replace(
        "{day}", str(now_myt.day)
    )  # e.g. "Thursday, May 14, 2026"

    prompt = _build_prompt(date_str, watchlist)

    print(f"[cli_run] provider={args.provider}  date={date_str}  watchlist={watchlist}", file=sys.stderr)
    print("[cli_run] Calling provider...", file=sys.stderr)

    caller = CALLERS[args.provider]
    try:
        raw = caller(prompt)
    except urllib.error.HTTPError as e:
        print(f"Provider HTTP {e.code}: {e.read().decode()}", file=sys.stderr)
        sys.exit(1)

    # Parse JSON — strip any accidental markdown fences
    raw_stripped = raw.strip()
    if raw_stripped.startswith("```"):
        lines = raw_stripped.split("\n")
        raw_stripped = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

    try:
        structured = json.loads(raw_stripped)
    except json.JSONDecodeError as exc:
        print(f"JSON parse error: {exc}", file=sys.stderr)
        print("Raw response:\n", raw_stripped[:2000], file=sys.stderr)
        sys.exit(1)

    print("[cli_run] ✓ JSON parsed successfully.", file=sys.stderr)

    # Save to file if requested
    if args.out:
        out_path = Path(args.out)
        out_path.write_text(json.dumps(structured, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"[cli_run] Saved to {out_path}", file=sys.stderr)

    # Print JSON to stdout (so it can be piped to ingest_to_dashboard.py)
    print(json.dumps(structured, indent=2, ensure_ascii=False))

    # Push to dashboard if requested
    if args.post:
        print("[cli_run] Pushing to dashboard...", file=sys.stderr)
        result = _push(structured, args.provider)
        print(
            f"[cli_run] ✓ Pushed: bucketAt={result.get('bucketAt','?')} id={result.get('id','?')}",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
