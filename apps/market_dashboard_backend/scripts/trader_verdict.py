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
# Trader profiles — styles define how each trader evaluates market conditions
# ---------------------------------------------------------------------------

TRADER_PROFILES = [
    {
        "handle": "@markminervini",
        "name": "Mark Minervini",
        "style": (
            "SEPA / Superperformance. Requires: Stage 2 uptrend confirmed (price above 50/150/200-day SMAs "
            "in order), VCP or tight consolidation base, EPS/RS acceleration, market in confirmed uptrend. "
            "Max 5-8% stop, never averages down, cuts losses fast. Will only enter from a proper base, "
            "never from an extended position. Verdict YES only if market structure is clearly Stage 2 "
            "with leaders setting up. WAIT if distribution or wide/loose action. SELECTIVE if mixed signals."
        ),
    },
    {
        "handle": "@Clement_Ang17",
        "name": "Clement Ang",
        "style": (
            "Swing + Superperformance, process-driven. Looks for liquid leaders, pocket pivots, A-rated "
            "entries. Market context is paramount — only trades in confirmed uptrends. Keeps monthly "
            "drawdowns small, sells into strength, chips up. Avoids overtrading. Verdict YES if market "
            "is in clear uptrend with high-RS leaders setting up. SELECTIVE if earnings risk is elevated "
            "or market is extended. WAIT if choppy or distribution phase."
        ),
    },
    {
        "handle": "@jftrev",
        "name": "Jeff (jftrev)",
        "style": (
            "Mechanical / robust system with high failure rate built in. Systematic entry signals with "
            "pre-defined sell rules. Hard stop-loss triggers, never deviates from rules. A-rated entries "
            "only (clean base, no extended). Rigid process over discretion. Verdict YES if mechanically "
            "valid setups are present and market conditions are favourable. WAIT if no A-rated setups. "
            "SELECTIVE if setups exist but market context is marginal. NO if breadth is severely negative."
        ),
    },
    {
        "handle": "@TedHZhang",
        "name": "Ted Zhang",
        "style": (
            "Portfolio Manager / institutional-quality trend trading (TURBOTECTION® style). Looks for "
            "high-quality growth names, market leaders, sector rotation, institutional accumulation "
            "signals. Asymmetric risk management at portfolio level. Verdict YES if leading sectors show "
            "institutional accumulation and market is in uptrend. SELECTIVE if rotating between sectors. "
            "WAIT if defensive positioning is warranted. Focus on the best-in-class setups only."
        ),
    },
    {
        "handle": "@SRxTrades",
        "name": "SRxTrades",
        "style": (
            "Technical swing + momentum. Breakouts with volume confirmation, momentum continuation setups. "
            "Defined stop below key technical level, disciplined R:R (minimum 2:1). Avoids choppy, "
            "low-volume entries. Verdict YES if clean breakouts with volume support and RS ≥ 70 leaders "
            "are present. SELECTIVE if setups exist but volume/breadth is mixed. WAIT if market is "
            "choppy or extended without consolidation."
        ),
    },
    {
        "handle": "@PrimeTrading_",
        "name": "Alex Desjardins (PrimeTrading_)",
        "style": (
            "Momentum + price action precision. Entry timing is critical — avoids overheated/extended "
            "conditions. Volume confirmation at key levels. Quick exits if thesis breaks. Tight stops. "
            "Verdict YES if momentum is confirmed with clean price action at key levels. SELECTIVE if "
            "price action is extended and needs a pullback entry. WAIT if market is overextended "
            "or key support levels are broken. Focus on timing over frequency."
        ),
    },
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
# Prompt builder
# ---------------------------------------------------------------------------

def build_prompt(date_str: str, market_context: str) -> str:
    profiles_text = "\n\n".join(
        f"  {p['handle']} ({p['name']}):\n  {p['style']}"
        for p in TRADER_PROFILES
    )

    handles_list = ", ".join(p["handle"] for p in TRADER_PROFILES)
    schema_example = json.dumps({
        "date": date_str,
        "traders": [
            {"handle": "@markminervini", "verdict": "YES", "note": "One or two sentences explaining why, in this trader's voice."},
            {"handle": "@Clement_Ang17", "verdict": "SELECTIVE", "note": "..."},
        ],
        "open_positions": [],
        "planning_entries": [],
    }, indent=2)

    return f"""You are simulating how 6 professional traders would assess today's market conditions ({date_str}).
Analyse the market snapshot below and produce a JSON verdict for each trader.

MARKET SNAPSHOT:
{market_context}

TRADER PROFILES (6 traders — one JSON entry each):
{profiles_text}

TASK:
For each of the 6 traders ({handles_list}), produce a verdict based on their specific style and the market data above.
- verdict must be exactly one of: "YES" (enter new positions now), "WAIT" (stand aside), "SELECTIVE" (only the very best setups), "NO" (close longs / avoid)
- note must be 1-2 tight sentences (≤180 chars) in that trader's voice — specific, actionable, referencing the actual data
- Be consistent: the same snapshot should yield the same verdict if run again

OUTPUT:
Return ONLY a raw JSON object — no markdown fences, no explanation, no preamble.
The JSON must match this exact schema:
{schema_example}

Rules:
- Include all 6 trader handles — no additions, no omissions
- open_positions and planning_entries must be empty arrays [] — do not fabricate user portfolio data
- Verdict labels must be uppercase: YES | WAIT | SELECTIVE | NO
- Notes must not exceed 200 characters each
"""


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
        "@jftrev": ("WAIT" if market_verdict == "YES" else market_verdict,
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
        json.dump(result, f, indent=2, ensure_ascii=False)

    source = result.get("_source", "?")
    n = len(result.get("traders", []))
    print(f"\nWrote {out_path}  [{n} trader verdicts, source={source}]")


if __name__ == "__main__":
    main()
