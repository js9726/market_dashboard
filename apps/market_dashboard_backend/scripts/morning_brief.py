"""
Multi-AI Morning Brief Generator
Generates a structured-JSON morning brief using Gemini, OpenAI, and/or Claude.
Each provider uses live web search to gather real-time market data.

Run from repo root:
  python apps/market_dashboard_backend/scripts/morning_brief.py [--out-dir data]

Outputs:
  <out-dir>/morning_brief_gemini.json    (structured shape per prompt.md)
  <out-dir>/morning_brief_openai.json
  <out-dir>/morning_brief_claude.json
  <out-dir>/morning_brief_meta.json

When --post-to is provided, also POSTs each provider's structured JSON to the
Vercel /api/morning-verdict/ingest endpoint so the unified Conviction Desk
picks it up immediately (no commit needed).

Required env vars (at least one):
  GEMINI_API_KEY    — Google Gemini 2.5 Pro with Search Grounding
  OPENAI_API_KEY    — OpenAI GPT-4o with web_search_preview
  ANTHROPIC_API_KEY — Anthropic Claude claude-sonnet-4-6 with web search beta
"""
from __future__ import print_function
import argparse
import json
import os
import sys
import time
import datetime

import requests


# ---------------------------------------------------------------------------
# Load .env from the repo root so the script works locally without manually
# exporting env vars. In CI, GitHub Secrets are already in the environment
# and this is a no-op (existing env vars are never overwritten).
# ---------------------------------------------------------------------------

def _load_env():
    here = os.path.dirname(os.path.abspath(__file__))
    # scripts/ -> market_dashboard_backend/ -> apps/ -> repo root
    repo_root = os.path.normpath(os.path.join(here, "..", "..", ".."))
    env_path = os.path.join(repo_root, ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value

_load_env()


# ---------------------------------------------------------------------------
# Skill handler — morning-brief skill at packages/core-skills/morning-brief/
# Owns the prompt template + watchlist defaults. Provider calls below stay
# here because each SDK has bespoke web-search tool wiring.
# ---------------------------------------------------------------------------

_HERE = os.path.dirname(os.path.abspath(__file__))
_SKILL_DIR = os.path.normpath(
    os.path.join(_HERE, "..", "..", "..", "packages", "core-skills", "morning-brief")
)
if _SKILL_DIR not in sys.path:
    sys.path.insert(0, _SKILL_DIR)

from handler import build_prompt, DEFAULT_WATCHLIST as WATCHLIST  # noqa: E402,F401


# ---------------------------------------------------------------------------
# Gemini (Google Search Grounding via REST)
# ---------------------------------------------------------------------------

GEMINI_API_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent"
)


def generate_gemini(prompt: str, out_dir: str) -> bool:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("[Gemini] GEMINI_API_KEY not set — skipping.")
        return False

    print("[Gemini] Calling Gemini 2.5 Pro with Search Grounding...")
    headers = {"Content-Type": "application/json"}
    params = {"key": api_key}
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "tools": [{"google_search": {}}],
        "generationConfig": {
            "temperature": 0.4,
            "maxOutputTokens": 8192,
        },
    }

    for attempt in range(3):
        try:
            resp = requests.post(
                GEMINI_API_URL, headers=headers, params=params, json=payload, timeout=120
            )
            if resp.status_code == 429:
                wait = 2 ** attempt
                print(f"[Gemini] Rate limit, retrying in {wait}s...")
                time.sleep(wait)
                continue
            resp.raise_for_status()
            data = resp.json()
            candidate = data.get("candidates", [{}])[0]
            parts = candidate.get("content", {}).get("parts")
            if not parts:
                finish = candidate.get("finishReason", "unknown")
                print(f"[Gemini] No content parts (finishReason={finish})")
                return False
            body = parts[0]["text"].strip()
            body = _strip_fences(body)
            if not _validate_json(body, "Gemini"):
                return False
            out_path = os.path.join(out_dir, "morning_brief_gemini.json")
            with open(out_path, "w", encoding="utf-8") as f:
                f.write(body)
            print(f"[Gemini] Written to {out_path}")
            return True
        except Exception as e:
            print(f"[Gemini] Error (attempt {attempt + 1}): {e}")
            if attempt < 2:
                time.sleep(2 ** attempt)

    return False


# ---------------------------------------------------------------------------
# OpenAI (GPT-4o via Responses API with web_search_preview)
# ---------------------------------------------------------------------------

def generate_openai(prompt: str, out_dir: str) -> bool:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("[OpenAI] OPENAI_API_KEY not set — skipping.")
        return False

    try:
        import openai
    except ImportError:
        print("[OpenAI] openai package not installed — run: pip install openai")
        return False

    print("[OpenAI] Calling GPT-4o with web_search_preview...")
    client = openai.OpenAI(api_key=api_key)

    for attempt in range(3):
        try:
            response = client.responses.create(
                model="gpt-4o",
                tools=[{"type": "web_search_preview"}],
                input=prompt,
                max_output_tokens=8192,
            )
            # Extract text from the response output items
            body = ""
            for item in response.output:
                if hasattr(item, "type") and item.type == "message":
                    for content in item.content:
                        if hasattr(content, "type") and content.type == "output_text":
                            body += content.text
            body = body.strip()
            if not body:
                print("[OpenAI] Empty response.")
                return False
            body = _strip_fences(body)
            if not _validate_json(body, "OpenAI"):
                return False
            out_path = os.path.join(out_dir, "morning_brief_openai.json")
            with open(out_path, "w", encoding="utf-8") as f:
                f.write(body)
            print(f"[OpenAI] Written to {out_path}")
            return True
        except Exception as e:
            print(f"[OpenAI] Error (attempt {attempt + 1}): {e}")
            if attempt < 2:
                time.sleep(2 ** attempt)

    return False


# ---------------------------------------------------------------------------
# Claude (claude-sonnet-4-6 with web search beta)
# ---------------------------------------------------------------------------

def generate_claude(prompt: str, out_dir: str) -> bool:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("[Claude] ANTHROPIC_API_KEY not set — skipping.")
        return False

    try:
        import anthropic
    except ImportError:
        print("[Claude] anthropic package not installed — run: pip install anthropic")
        return False

    print("[Claude] Calling Claude claude-sonnet-4-6 with web search...")
    client = anthropic.Anthropic(api_key=api_key)

    for attempt in range(3):
        try:
            response = client.beta.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=8192,
                messages=[{"role": "user", "content": prompt}],
                tools=[{
                    "type": "web_search_20250305",
                    "name": "web_search",
                    "max_uses": 15,
                }],
                betas=["web-search-2025-03-05"],
            )
            # Collect all text blocks from the response
            body = ""
            for block in response.content:
                if hasattr(block, "type") and block.type == "text":
                    body += block.text
            body = body.strip()
            if not body:
                print("[Claude] Empty response.")
                return False
            body = _strip_fences(body)
            if not _validate_json(body, "Claude"):
                return False
            out_path = os.path.join(out_dir, "morning_brief_claude.json")
            with open(out_path, "w", encoding="utf-8") as f:
                f.write(body)
            print(f"[Claude] Written to {out_path}")
            return True
        except Exception as e:
            print(f"[Claude] Error (attempt {attempt + 1}): {e}")
            if attempt < 2:
                time.sleep(2 ** attempt)

    return False


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _strip_fences(text: str) -> str:
    """Remove ```json / ```html / ``` fences if the model wrapped output in them."""
    if text.startswith("```"):
        lines = text.splitlines()
        # Drop first line (```json/```html/```) and last line (```)
        if lines[-1].strip() == "```":
            lines = lines[1:-1]
        elif lines[0].strip().startswith("```"):
            lines = lines[1:]
        text = "\n".join(lines)
    return text.strip()


def _validate_json(body: str, label: str) -> bool:
    """Verify the model output parses as JSON. Logs a sample on failure."""
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError as e:
        print(f"[{label}] JSON parse failed at line {e.lineno}: {e.msg}")
        print(f"[{label}] First 300 chars: {body[:300]!r}")
        return False
    if not isinstance(parsed, dict):
        print(f"[{label}] Top-level is {type(parsed).__name__}, expected dict")
        return False
    return True


def write_meta(out_dir: str, results: dict):
    meta = {
        "built_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "providers": {
            "gemini": {
                "available": bool(os.environ.get("GEMINI_API_KEY")),
                "generated": results.get("gemini", False),
                "label": "Gemini 2.5 Pro",
            },
            "openai": {
                "available": bool(os.environ.get("OPENAI_API_KEY")),
                "generated": results.get("openai", False),
                "label": "GPT-4o",
            },
            "claude": {
                "available": bool(os.environ.get("ANTHROPIC_API_KEY")),
                "generated": results.get("claude", False),
                "label": "Claude claude-sonnet-4-6",
            },
        },
    }
    path = os.path.join(out_dir, "morning_brief_meta.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    print(f"Meta written to {path}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def _post_to_ingest(post_to, post_key, provider, json_body_str, generated_by):
    """POST a structured JSON brief to /api/morning-verdict/ingest.

    `json_body_str` is the raw JSON text the model produced (already validated).
    We attach it as `structuredJson` (parsed) and send an empty `htmlBody` for
    schema compatibility — the new frontend renders only `structuredJson`.
    """
    if not post_to or not post_key:
        return
    import hashlib
    import urllib.error
    import urllib.request as _ur
    try:
        structured = json.loads(json_body_str)
    except json.JSONDecodeError:
        print(f"[ingest] {provider}: cannot parse body — skipping post")
        return
    payload = {
        "provider": provider,
        "htmlBody": "",
        "structuredJson": structured,
        "generatedBy": generated_by,
        "inputHash": hashlib.sha256(json_body_str.encode("utf-8")).hexdigest(),
    }
    body = json.dumps(payload).encode("utf-8")
    req = _ur.Request(
        post_to,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + post_key,
        },
    )
    try:
        with _ur.urlopen(req, timeout=30) as r:
            r.read()
        print(f"[ingest] posted {provider} to {post_to}")
    except urllib.error.HTTPError as e:
        print(f"[ingest] {provider}: HTTP {e.code} {e.read().decode('utf-8', 'ignore')[:200]}")
    except Exception as e:
        print(f"[ingest] {provider}: {e}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", default="data", help="Output directory")
    parser.add_argument(
        "--providers",
        default="gemini,openai,claude",
        help="Comma-separated providers to run (gemini,openai,claude,deepseek)",
    )
    parser.add_argument("--post-to", default=os.environ.get("VERCEL_INGEST_URL_FULL"),
                        help="Optional URL of /api/morning-verdict/ingest to POST results")
    parser.add_argument("--post-key", default=os.environ.get("BRIEF_INGEST_KEY"),
                        help="Bearer token for the ingest endpoint")
    parser.add_argument("--generated-by", default="cron-premarket",
                        help="Tag stored in MorningBriefCache.generatedBy")
    args = parser.parse_args()

    out_dir = args.out_dir
    os.makedirs(out_dir, exist_ok=True)

    enabled = {p.strip().lower() for p in args.providers.split(",")}
    date_str = datetime.date.today().strftime("%A, %B %d, %Y")
    prompt = build_prompt(date_str)

    results = {}

    if "gemini" in enabled:
        results["gemini"] = generate_gemini(prompt, out_dir)

    if "openai" in enabled:
        results["openai"] = generate_openai(prompt, out_dir)

    if "claude" in enabled:
        results["claude"] = generate_claude(prompt, out_dir)

    # DeepSeek doesn't have web search — skipped here for the rich pre-market run.
    # Intraday DeepSeek refreshes are handled by the Next.js /api/morning-verdict
    # lazy-regen path (TS-side, snapshot-fed).

    if not any(results.values()):
        print("\nERROR: No providers succeeded. Set at least one of:")
        print("  GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY")
        sys.exit(1)

    write_meta(out_dir, results)

    # Push successful briefs to the Vercel cache so the unified Conviction Desk
    # picks them up immediately (no commit needed).
    if args.post_to and args.post_key:
        for provider, ok in results.items():
            if not ok:
                continue
            json_path = os.path.join(out_dir, f"morning_brief_{provider}.json")
            if not os.path.exists(json_path):
                continue
            with open(json_path, encoding="utf-8") as f:
                json_body_str = f.read()
            _post_to_ingest(args.post_to, args.post_key, provider, json_body_str, args.generated_by)

    successful = [p for p, ok in results.items() if ok]
    print(f"\nDone. Generated briefs for: {', '.join(successful)}")


if __name__ == "__main__":
    main()
