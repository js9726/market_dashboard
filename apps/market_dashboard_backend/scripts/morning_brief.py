"""
Multi-AI Morning Brief Generator
Generates a rich HTML morning brief using Gemini, OpenAI, and/or Claude.
Each provider uses live web search to gather real-time market data.

Run from repo root:
  python apps/market_dashboard_backend/scripts/morning_brief.py [--out-dir data]

Outputs:
  <out-dir>/morning_brief_gemini.html
  <out-dir>/morning_brief_openai.html
  <out-dir>/morning_brief_claude.html
  <out-dir>/morning_brief_meta.json

Required env vars (at least one):
  GEMINI_API_KEY   — Google Gemini 2.5 Pro with Search Grounding
  OPENAI_API_KEY   — OpenAI GPT-4o with web_search_preview
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
# Watchlist & trader styles (embedded so backend has no file dependency)
# ---------------------------------------------------------------------------

WATCHLIST = ["NVDA", "TSLA", "AAPL", "MSFT", "AMZN", "META", "GOOGL", "AMD", "SMCI", "PLTR", "CRWD", "MSTR"]

TRADER_STYLES = """
- **Minervini**: Stage 2 uptrends, VCP patterns, tight bases near highs, high RS stocks. Won't buy in weak market context.
- **Ted Zhang (TedHZhang)**: Sector rotation, institutional money flow, where smart money is accumulating/distributing.
- **Clement Ang**: Market context first — only A-rated setups in confirmed uptrends. Sits out choppy/distribution phases.
- **SRxTrades**: Technical setups with volume confirmation. Never chases extended moves. Waits for clean pivot entries.
- **Jeff (jfsrev)**: Mechanical discipline, pre-defined rules, hard stops. No averaging down. Rule-based, no emotion.
- **PrimeTrading**: Price action precision, momentum confirmation, clean entries at key levels.
""".strip()


# ---------------------------------------------------------------------------
# HTML CSS template (scoped to .brief — no global * or body resets)
# ---------------------------------------------------------------------------

BRIEF_CSS = """<style>
.brief { font-family: var(--brief-font-mono, ui-monospace, 'Cascadia Code', monospace); padding: 1rem 0; max-width: 100%; color: var(--brief-text-primary, #e2e8f0); }
.brief .b-header { border-bottom: 1px solid var(--brief-border-primary, #334155); padding-bottom: 0.75rem; margin-bottom: 1rem; }
.brief .b-header h1 { font-size: 13px; font-weight: 500; letter-spacing: 0.05em; text-transform: uppercase; }
.brief .b-header .b-sub { font-size: 11px; color: var(--brief-text-secondary, #94a3b8); margin-top: 2px; }
.brief .b-section { margin-bottom: 1.5rem; }
.brief .b-section-title { font-size: 11px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--brief-text-secondary, #94a3b8); border-bottom: 0.5px solid var(--brief-border-tertiary, #1e293b); padding-bottom: 4px; margin-bottom: 10px; }
.brief .b-row { display: flex; justify-content: space-between; align-items: baseline; padding: 4px 0; border-bottom: 0.5px solid var(--brief-border-tertiary, #1e293b); font-size: 13px; gap: 8px; }
.brief .b-row:last-child { border-bottom: none; }
.brief .b-ticker { font-weight: 500; min-width: 80px; flex-shrink: 0; }
.brief .b-level { color: var(--brief-text-secondary, #94a3b8); font-size: 12px; }
.brief .b-note { font-size: 11px; color: var(--brief-text-tertiary, #64748b); flex: 1; text-align: right; }
.brief .b-up { color: #1D9E75; }
.brief .b-down { color: #D85A30; }
.brief .b-neutral { color: var(--brief-text-secondary, #94a3b8); }
.brief .b-tag { display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 3px; font-weight: 500; margin-left: 4px; }
.brief .b-tag-warn { background: #FAEEDA; color: #854F0B; }
.brief .b-tag-up { background: #1a3d2b; color: #4ade80; }
.brief .b-tag-down { background: #3d1a1a; color: #f87171; }
.brief .b-tag-info { background: #1a2a3d; color: #60a5fa; }
.brief .b-mover { padding: 6px 0; border-bottom: 0.5px solid var(--brief-border-tertiary, #1e293b); }
.brief .b-mover:last-child { border-bottom: none; }
.brief .b-mover-name { font-size: 13px; font-weight: 500; }
.brief .b-mover-why { font-size: 11px; color: var(--brief-text-secondary, #94a3b8); margin-top: 2px; line-height: 1.4; }
.brief .b-mover-style { font-size: 10px; color: #60a5fa; margin-top: 2px; font-style: italic; }
.brief .b-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
.brief .b-cal-item { padding: 5px 0; border-bottom: 0.5px solid var(--brief-border-tertiary, #1e293b); font-size: 12px; }
.brief .b-cal-item:last-child { border-bottom: none; }
.brief .b-cal-time { color: var(--brief-text-secondary, #94a3b8); font-size: 11px; }
.brief .b-cal-name { font-weight: 500; }
.brief .b-cal-consensus { color: var(--brief-text-tertiary, #64748b); font-size: 11px; }
.brief .b-mood-box { background: var(--brief-bg-secondary, #1e293b); border-radius: 6px; padding: 0.75rem 1rem; font-size: 12px; line-height: 1.7; }
.brief .b-mood-label { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; color: var(--brief-text-secondary, #94a3b8); margin-bottom: 4px; }
.brief .b-trader-call { margin-top: 8px; font-size: 11px; color: var(--brief-text-secondary, #94a3b8); line-height: 1.6; }
.brief .b-trader-call strong { color: var(--brief-text-primary, #e2e8f0); }
.brief .b-earnings-beat { font-size: 13px; padding: 5px 0; border-bottom: 0.5px solid var(--brief-border-tertiary, #1e293b); }
.brief .b-earnings-beat:last-child { border-bottom: none; }
.brief .b-cite { font-size: 10px; color: var(--brief-text-tertiary, #64748b); font-style: italic; }
.brief .b-alert { background: #2d1f0a; border-left: 3px solid #EF9F27; padding: 6px 10px; border-radius: 0 4px 4px 0; margin-bottom: 1rem; font-size: 12px; color: #fbbf24; }
.brief .b-footer { font-size: 10px; color: var(--brief-text-tertiary, #64748b); padding-top: 0.5rem; border-top: 0.5px solid var(--brief-border-tertiary, #1e293b); margin-top: 1rem; }
</style>"""

HTML_STRUCTURE_GUIDE = """
Use these CSS classes (all scoped under .brief parent):
- Section wrapper: <div class="b-section">
- Section title: <div class="b-section-title">N. TITLE</div>
- Data row: <div class="b-row"><span class="b-ticker">SPY</span><span class="b-up">+1.2%</span><span class="b-note">note</span></div>
- Alert banner: <div class="b-alert">⚠ ALERT TEXT</div>  (only if major macro event)
- Mover block: <div class="b-mover"><div class="b-mover-name">TICKER <span class="b-tag b-tag-up">+12%</span></div><div class="b-mover-why">reason</div><div class="b-mover-style">Trader lens: ...</div></div>
- Mood box: <div class="b-mood-box"><div class="b-mood-label">Mood: ...</div><p>text</p><div class="b-trader-call"><strong>Minervini:</strong> ... <strong>Ted Zhang:</strong> ...</div></div>
- Tags: <span class="b-tag b-tag-up">BEAT</span> | b-tag-down | b-tag-warn | b-tag-info
- Colors: class="b-up" (green) | class="b-down" (red) | class="b-neutral" (grey)
- Citation: <span class="b-cite">Source: Reuters 07:12 ET</span>
"""


def build_prompt(date_str: str) -> str:
    watchlist_str = ", ".join(WATCHLIST)
    return f"""You are generating a morning market brief for {date_str} for an active trader based in Malaysia (MYT = UTC+8).

Search the web RIGHT NOW for real-time market data and generate a complete HTML morning brief.

OUTPUT FORMAT: Return ONLY the HTML snippet below. No markdown, no ```html fences, no explanation.
Start your response with the opening <div class="brief"> tag. End with </div>.

The full output must be:
{BRIEF_CSS}
<div class="brief">
  <div class="b-header">
    <h1>Morning Brief — {date_str}</h1>
    <div class="b-sub">Generated [TIME] MYT | US markets open 9:30 PM MYT | Powered by live web search</div>
  </div>
  [ALERT BANNER HERE — only if major macro news, else omit]
  [SECTION 1 THROUGH 9]
  <div class="b-footer">Generated via live web search · Not financial advice · [DATE] [TIME] MYT</div>
</div>

TRADER STYLE FRAMEWORK (apply to colour the analysis):
{TRADER_STYLES}

WATCHLIST: {watchlist_str}

{HTML_STRUCTURE_GUIDE}

SECTIONS TO GENERATE (search the web for each):

1. INDEX SNAPSHOT
Search: "S&P 500 futures today", "NASDAQ pre-market today", "Dow futures", "VIX today", "10 year treasury yield today"
- S&P 500, NASDAQ Composite, Dow Jones, Russell 2000: level + % change (futures or live)
- VIX level + change, 10Y yield, WTI oil price if relevant
- Include ALERT BANNER if there is breaking macro news (geopolitics, major Fed action, black swan)

2. OVERNIGHT ASIA & EUROPE — THE WHY
Search: "Asia markets today {date_str}", "Europe markets today {date_str}"
- Nikkei, Hang Seng, CSI 300, Kospi, ASX 200: level + % change
- Stoxx 600, DAX, CAC 40: level + % change
- CRITICAL: explain WHY each region moved — policy, data, earnings, geopolitics. Not just numbers.

3. PRE-MARKET MOVERS
Search: "pre-market movers today {date_str}", "biggest stock movers pre-market"
- Top 3–5 gainers with catalyst (earnings beat, upgrade, FDA approval, deal, etc.)
- Top 3 losers with catalyst
- For each significant mover: include a b-mover-style callout applying a trader lens (which style fits the setup?)

4. EARNINGS ON DECK
Search: "earnings reports {date_str}", "earnings before open today", "earnings after close today", "yesterday earnings surprise"
- Companies reporting today BMO (before market open) and AMC (after market close)
- Yesterday's notable earnings reactions: beat/miss vs estimate and stock % move

5. FED & MACRO CALENDAR — THIS WEEK
Search: "economic calendar {date_str}", "Fed speakers this week", "CPI PPI data this week"
- Use b-two-col grid layout for the calendar
- Key data releases: time (ET), event name, consensus estimate
- Fed speakers scheduled
- Rate cut/hike probability from futures if relevant

6. ANALYST UPGRADES / DOWNGRADES
Search: "analyst upgrades downgrades today {date_str}", "Wall Street ratings changes today"
- Top 3 upgrades: ticker, firm, new rating, price target
- Top 3 downgrades: ticker, firm, new rating, price target
- Note if any are watchlist stocks

7. MY WATCHLIST
For each ticker ({watchlist_str}):
Search "[TICKER] stock pre-market {date_str}" or use latest available data.
Show: last close or pre-market price | % change | one-line setup note
Apply trader-style lens: Is it Stage 2? Near a pivot? Volume confirming? Avoid or watch?

8. WHAT TO WATCH — MARKET MOOD (editorial closer)
- Overall market mood: risk-on / risk-off / choppy / trending + why
- The single most important variable to watch today
- Composite trader-style read:
  Minervini: [view on market structure/stage]
  Ted Zhang: [sector rotation play]
  Clement Ang: [market context / entry grade]
  SRxTrades: [technical setup quality]
  Jeff: [discipline/rule reminder]
  Composite: [synthesised view — what should the trader actually DO today?]

RULES:
- Every data point MUST cite its source inline using <span class="b-cite">Source: Name, time</span>
- All numbers must be color-coded with b-up / b-down / b-neutral classes
- Each section scannable in < 30 seconds
- Tone: confident, concise, professional — like a prop desk morning note
- If you cannot find data for something, write "(data unavailable at generation time)" — never fabricate numbers
- Output ONLY the HTML — start with the <style> block, then <div class="brief">
"""


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
            html = parts[0]["text"].strip()
            html = _strip_fences(html)
            out_path = os.path.join(out_dir, "morning_brief_gemini.html")
            with open(out_path, "w", encoding="utf-8") as f:
                f.write(html)
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
            html = ""
            for item in response.output:
                if hasattr(item, "type") and item.type == "message":
                    for content in item.content:
                        if hasattr(content, "type") and content.type == "output_text":
                            html += content.text
            html = html.strip()
            if not html:
                print("[OpenAI] Empty response.")
                return False
            html = _strip_fences(html)
            out_path = os.path.join(out_dir, "morning_brief_openai.html")
            with open(out_path, "w", encoding="utf-8") as f:
                f.write(html)
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
            html = ""
            for block in response.content:
                if hasattr(block, "type") and block.type == "text":
                    html += block.text
            html = html.strip()
            if not html:
                print("[Claude] Empty response.")
                return False
            html = _strip_fences(html)
            out_path = os.path.join(out_dir, "morning_brief_claude.html")
            with open(out_path, "w", encoding="utf-8") as f:
                f.write(html)
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
    """Remove ```html ... ``` fences if the model wrapped output in them."""
    if text.startswith("```"):
        lines = text.splitlines()
        # Drop first line (```html or ```) and last line (```)
        if lines[-1].strip() == "```":
            lines = lines[1:-1]
        elif lines[0].strip().startswith("```"):
            lines = lines[1:]
        text = "\n".join(lines)
    return text.strip()


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

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", default="data", help="Output directory")
    parser.add_argument(
        "--providers",
        default="gemini,openai,claude",
        help="Comma-separated providers to run (gemini,openai,claude)",
    )
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

    if not any(results.values()):
        print("\nERROR: No providers succeeded. Set at least one of:")
        print("  GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY")
        sys.exit(1)

    write_meta(out_dir, results)
    successful = [p for p, ok in results.items() if ok]
    print(f"\nDone. Generated briefs for: {', '.join(successful)}")


if __name__ == "__main__":
    main()
