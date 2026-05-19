"""
AI Trader Verdict Generator
Reads snapshot.json, feeds market context to an AI, and outputs trader_verdict.json.
Runs after build_data.py. No web search needed — all data is in snapshot.json.

Usage:
  python scripts/trader_verdict.py [--out-dir data] [--providers gemini,claude,openai]

Outputs:
  <out-dir>/trader_verdict.json

Requires at least one of: GEMINI_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY
"""
from __future__ import print_function
import argparse
import json
import os
import re
import sys
import time
import datetime

# Shared JSON safety helpers — keep bare NaN out of browser-facing files.
from build_data import sanitize_json, safe_json_dumps  # noqa: E402

# ---------------------------------------------------------------------------
# Load .env from repo root (no-op in CI where secrets are already exported)
# ---------------------------------------------------------------------------

def _load_env():
    here = os.path.dirname(os.path.abspath(__file__))
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
# Trader profiles — loaded from packages/core-skills/_shared/trader-profiles.json
# (single source of truth shared with the TS frontend)
# ---------------------------------------------------------------------------

_HERE = os.path.dirname(os.path.abspath(__file__))
_SHARED_DIR = os.path.normpath(
    os.path.join(_HERE, "..", "..", "..", "packages", "core-skills", "_shared")
)
if _SHARED_DIR not in sys.path:
    sys.path.insert(0, _SHARED_DIR)

from prompt_loader import load_trader_profiles  # noqa: E402

TRADER_PROFILES = [
    {"handle": p["handle"], "name": p["name"], "style": p["styleLong"]}
    for p in load_trader_profiles()
]

REQUIRED_HANDLES = {p["handle"] for p in TRADER_PROFILES}
VALID_VERDICTS = {"YES", "WAIT", "SELECTIVE", "NO"}


# ---------------------------------------------------------------------------
# Snapshot reader + market context builder
# ---------------------------------------------------------------------------

def load_snapshot(snapshot_dir: str) -> dict:
    path = os.path.join(snapshot_dir, "snapshot.json")
    if not os.path.exists(path):
        raise FileNotFoundError(f"snapshot.json not found in {snapshot_dir}. Run build_data.py first.")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _pct(v) -> str:
    if v is None:
        return "N/A"
    return f"{'+' if v > 0 else ''}{v:.2f}%"


def build_market_context(snapshot: dict) -> str:
    """Extract a concise market context string from snapshot.json for the AI prompt."""
    built_at = snapshot.get("built_at", "unknown")
    groups = snapshot.get("groups", {})
    lines = [f"Market snapshot built at: {built_at}", ""]

    # Key indices
    indices = {r["ticker"]: r for r in groups.get("Indices", [])}
    key = ["SPY", "QQQ", "IWM", "DIA", "TLT", "IBIT"]
    lines.append("KEY INDICES (daily | 5d | 20d | ABC | RS):")
    for t in key:
        r = indices.get(t)
        if r:
            lines.append(
                f"  {t:6s}  day={_pct(r.get('daily'))}  "
                f"5d={_pct(r.get('5d'))}  "
                f"20d={_pct(r.get('20d'))}  "
                f"ABC={r.get('abc') or '?'}  "
                f"RS={int(r['rs']) if r.get('rs') is not None else 'N/A'}"
            )
    lines.append("")

    # Sector breadth
    sectors = groups.get("Sel Sectors", groups.get("Sectors", []))
    if sectors:
        up   = sum(1 for r in sectors if (r.get("daily") or 0) > 0)
        down = sum(1 for r in sectors if (r.get("daily") or 0) < 0)
        lines.append(f"SECTOR BREADTH: {up} up / {down} down ({len(sectors)} sectors)")
        top = sorted(sectors, key=lambda r: r.get("daily") or -999, reverse=True)[:3]
        bot = sorted(sectors, key=lambda r: r.get("daily") or 999)[:3]
        lines.append(f"  Leaders: {', '.join(r['ticker'] + ' ' + _pct(r.get('daily')) for r in top)}")
        lines.append(f"  Laggards: {', '.join(r['ticker'] + ' ' + _pct(r.get('daily')) for r in bot)}")
        lines.append("")

    # Breadth across all groups
    all_rows = [r for rows in groups.values() for r in rows]
    valid = [r for r in all_rows if r.get("daily") is not None]
    if valid:
        total_up   = sum(1 for r in valid if r["daily"] > 0)
        total_down = sum(1 for r in valid if r["daily"] < 0)
        above_sma  = sum(1 for r in all_rows if (r.get("dist_sma50_atr") or -1) > 0)
        high_rs    = sum(1 for r in all_rows if (r.get("rs") or 0) >= 70)
        lines.append(f"COMPOSITE BREADTH ({len(valid)} ETFs): "
                     f"Up={total_up}  Down={total_down}  "
                     f"Ratio={total_up/max(total_down,1):.2f}  "
                     f"Above-SMA50={above_sma}  HighRS(≥70)={high_rs}")
        lines.append("")

    # RS leaders from all groups
    deduped: dict = {}
    for r in all_rows:
        if (r.get("rs") or 0) >= 70:
            t = r["ticker"]
            if t not in deduped or (r.get("rs") or 0) > (deduped[t].get("rs") or 0):
                deduped[t] = r
    leaders = sorted(deduped.values(), key=lambda r: r.get("rs") or 0, reverse=True)[:10]
    if leaders:
        lines.append("TOP RS LEADERS (RS ≥ 70):")
        for r in leaders:
            lines.append(
                f"  {r['ticker']:6s}  RS={int(r['rs'])}  ABC={r.get('abc') or '?'}  "
                f"day={_pct(r.get('daily'))}  5d={_pct(r.get('5d'))}"
            )

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Prompt builder — delegated to packages/core-skills/trader-scorer-market
# ---------------------------------------------------------------------------

_SKILL_DIR = os.path.normpath(
    os.path.join(_HERE, "..", "..", "..", "packages", "core-skills", "trader-scorer-market")
)
if _SKILL_DIR not in sys.path:
    sys.path.insert(0, _SKILL_DIR)

from handler import build_prompt  # noqa: E402,F401


# ---------------------------------------------------------------------------
# JSON extraction + schema validation
# ---------------------------------------------------------------------------

def extract_json(text: str) -> str:
    """Strip markdown fences and extract the outermost JSON object."""
    text = text.strip()
    # Remove ```json ... ``` or ``` ... ``` fences
    text = re.sub(r'^```(?:json)?\s*', '', text)
    text = re.sub(r'\s*```$', '', text)
    text = text.strip()
    # Find outermost { ... }
    start = text.find('{')
    if start == -1:
        raise ValueError("No JSON object found in response")
    depth, end = 0, -1
    for i, ch in enumerate(text[start:], start):
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                end = i
                break
    if end == -1:
        raise ValueError("Unterminated JSON object in response")
    return text[start:end + 1]


def validate_verdict(data: dict) -> dict:
    """Validate and normalise trader_verdict.json schema. Raises ValueError on failure."""
    if not isinstance(data, dict):
        raise ValueError("Root must be a JSON object")

    # date
    if "date" not in data or not isinstance(data["date"], str):
        raise ValueError("Missing or invalid 'date' field")

    # traders
    traders = data.get("traders")
    if not isinstance(traders, list) or len(traders) == 0:
        raise ValueError("'traders' must be a non-empty array")

    seen_handles = set()
    for i, t in enumerate(traders):
        if not isinstance(t, dict):
            raise ValueError(f"traders[{i}] is not an object")
        handle = t.get("handle", "")
        if not handle:
            raise ValueError(f"traders[{i}] missing 'handle'")
        verdict = t.get("verdict", "")
        if verdict.upper() not in VALID_VERDICTS:
            raise ValueError(f"traders[{i}] verdict '{verdict}' not in {VALID_VERDICTS}")
        t["verdict"] = verdict.upper()  # normalise
        note = t.get("note", "")
        if not isinstance(note, str) or len(note) < 5:
            raise ValueError(f"traders[{i}] note too short or missing")
        if len(note) > 250:
            t["note"] = note[:247] + "..."
        seen_handles.add(handle)

    missing = REQUIRED_HANDLES - seen_handles
    if missing:
        raise ValueError(f"Missing required trader handles: {missing}")

    # open_positions and planning_entries must be lists
    for key in ("open_positions", "planning_entries"):
        if key in data and not isinstance(data[key], list):
            raise ValueError(f"'{key}' must be an array")
        if key not in data:
            data[key] = []

    return data


# ---------------------------------------------------------------------------
# AI providers
# ---------------------------------------------------------------------------

def _call_gemini(prompt: str) -> dict | None:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("[Gemini] GEMINI_API_KEY not set — skipping.")
        return None

    import requests as req
    url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 2048},
    }
    for attempt in range(3):
        try:
            resp = req.post(url, params={"key": api_key}, json=payload, timeout=60)
            if resp.status_code == 429:
                time.sleep(2 ** attempt)
                continue
            resp.raise_for_status()
            data = resp.json()
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            raw  = extract_json(text)
            return validate_verdict(json.loads(raw))
        except (ValueError, KeyError) as e:
            print(f"[Gemini] Validation error (attempt {attempt + 1}): {e}")
        except Exception as e:
            print(f"[Gemini] Error (attempt {attempt + 1}): {e}")
        if attempt < 2:
            time.sleep(2 ** attempt)
    return None


def _call_claude(prompt: str) -> dict | None:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("[Claude] ANTHROPIC_API_KEY not set — skipping.")
        return None

    try:
        import anthropic
    except ImportError:
        print("[Claude] anthropic not installed — run: pip install anthropic")
        return None

    client = anthropic.Anthropic(api_key=api_key)
    for attempt in range(3):
        try:
            response = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=2048,
                messages=[{"role": "user", "content": prompt}],
            )
            text = response.content[0].text
            raw  = extract_json(text)
            return validate_verdict(json.loads(raw))
        except (ValueError, KeyError) as e:
            print(f"[Claude] Validation error (attempt {attempt + 1}): {e}")
        except Exception as e:
            print(f"[Claude] Error (attempt {attempt + 1}): {e}")
        if attempt < 2:
            time.sleep(2 ** attempt)
    return None


def _call_openai(prompt: str) -> dict | None:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("[OpenAI] OPENAI_API_KEY not set — skipping.")
        return None

    try:
        import openai
    except ImportError:
        print("[OpenAI] openai not installed — run: pip install openai")
        return None

    client = openai.OpenAI(api_key=api_key)
    for attempt in range(3):
        try:
            resp = client.chat.completions.create(
                model="gpt-4o",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=2048,
                temperature=0.2,
                response_format={"type": "json_object"},
            )
            text = resp.choices[0].message.content
            raw  = extract_json(text)
            return validate_verdict(json.loads(raw))
        except (ValueError, KeyError) as e:
            print(f"[OpenAI] Validation error (attempt {attempt + 1}): {e}")
        except Exception as e:
            print(f"[OpenAI] Error (attempt {attempt + 1}): {e}")
        if attempt < 2:
            time.sleep(2 ** attempt)
    return None


# ---------------------------------------------------------------------------
# Rule-based fallback (no AI needed)
# ---------------------------------------------------------------------------

def _rule_based_verdict(snapshot: dict, date_str: str) -> dict:
    """Deterministic fallback when all AI providers are unavailable."""
    groups = snapshot.get("groups", {})
    all_rows = [r for rows in groups.values() for r in rows]
    valid = [r for r in all_rows if r.get("daily") is not None]
    total_up   = sum(1 for r in valid if r["daily"] > 0)
    total_down = sum(1 for r in valid if r["daily"] < 0)
    ratio = total_up / max(total_down, 1)

    spy = next((r for r in groups.get("Indices", []) if r["ticker"] == "SPY"), None)
    spy_abc  = (spy or {}).get("abc", "C")
    spy_day  = (spy or {}).get("daily", 0) or 0
    spy_5d   = (spy or {}).get("5d", 0) or 0

    if ratio >= 1.5 and spy_abc == "A" and spy_5d > 0:
        market_verdict = "YES"
        market_note    = f"SPY ABC={spy_abc}, breadth ratio={ratio:.2f}. Broad participation, trend intact."
    elif ratio <= 0.67 or spy_abc == "C":
        market_verdict = "WAIT"
        market_note    = f"SPY ABC={spy_abc}, breadth ratio={ratio:.2f}. Distribution/weak structure — avoid new longs."
    else:
        market_verdict = "SELECTIVE"
        market_note    = f"SPY ABC={spy_abc}, breadth ratio={ratio:.2f}. Mixed signals — best setups only."

    style_overrides = {
        "@jfsrev": ("WAIT" if market_verdict == "YES" else market_verdict,
                    "Systematic rules require A-rated base + confirm. Raise bar in current conditions."),
        "@TedHZhang": (market_verdict,
                       f"Sector rotation monitor active. {market_note}"),
    }

    traders = []
    for p in TRADER_PROFILES:
        handle = p["handle"]
        if handle in style_overrides:
            v, n = style_overrides[handle]
        else:
            v, n = market_verdict, f"{market_note} Applied via {p['name']} style framework."
        traders.append({"handle": handle, "verdict": v, "note": n[:200]})

    return {
        "date": date_str,
        "traders": traders,
        "open_positions": [],
        "planning_entries": [],
    }


# ---------------------------------------------------------------------------
# Merge: preserve user-maintained open_positions + planning_entries
# ---------------------------------------------------------------------------

def merge_user_data(new_data: dict, existing_path: str) -> dict:
    """Copy open_positions and planning_entries from existing file if present."""
    if not os.path.exists(existing_path):
        return new_data
    try:
        with open(existing_path, encoding="utf-8") as f:
            existing = json.load(f)
        for key in ("open_positions", "planning_entries"):
            if existing.get(key):
                new_data[key] = existing[key]
                print(f"  Preserved {len(existing[key])} existing {key}")
    except Exception as e:
        print(f"  Could not read existing trader_verdict.json: {e}")
    return new_data


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir",  default="data", help="Output directory (same as build_data --out-dir)")
    parser.add_argument("--providers", default="gemini,claude,openai",
                        help="Comma-separated AI providers to try in order (default: gemini,claude,openai)")
    args = parser.parse_args()

    out_dir  = args.out_dir
    enabled  = [p.strip().lower() for p in args.providers.split(",")]
    date_str = datetime.date.today().isoformat()
    out_path = os.path.join(out_dir, "trader_verdict.json")

    os.makedirs(out_dir, exist_ok=True)

    print("Loading snapshot.json...")
    try:
        snapshot = load_snapshot(out_dir)
    except FileNotFoundError as e:
        print(f"ERROR: {e}")
        sys.exit(1)

    market_context = build_market_context(snapshot)
    print("Market context extracted:")
    print(market_context[:800] + ("..." if len(market_context) > 800 else ""))
    print()

    prompt = build_prompt(date_str, market_context)

    # Try each enabled provider in order, stop at first success
    PROVIDERS = {
        "gemini": _call_gemini,
        "claude": _call_claude,
        "openai": _call_openai,
    }

    result = None
    for name in enabled:
        fn = PROVIDERS.get(name)
        if fn is None:
            print(f"Unknown provider '{name}' — skipping.")
            continue
        print(f"[{name.capitalize()}] Generating trader verdicts...")
        result = fn(prompt)
        if result:
            print(f"[{name.capitalize()}] Success.")
            result["_source"] = name
            break
        print(f"[{name.capitalize()}] Failed or skipped.")

    if result is None:
        print("\nAll AI providers failed — using rule-based fallback.")
        result = _rule_based_verdict(snapshot, date_str)
        result["_source"] = "fallback"

    result = merge_user_data(result, out_path)
    result["date"] = date_str  # always stamp today

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(safe_json_dumps(sanitize_json(result), indent=2))

    source = result.get("_source", "?")
    n = len(result.get("traders", []))
    print(f"\nWrote {out_path}  [{n} trader verdicts, source={source}]")


if __name__ == "__main__":
    main()
