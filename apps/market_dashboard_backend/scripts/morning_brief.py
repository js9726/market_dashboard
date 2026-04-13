"""
US Market Morning Brief Generator
Run from repo root: python apps/market_dashboard_backend/scripts/morning_brief.py [--out-dir data]

Reads snapshot.json (produced by build_data.py) and calls Gemini to generate
an institutional-quality morning brief covering:
  1. Industry performance & rotation
  2. Relative strength stock picks
  3. Market breadth interpretation
  4. 5 things to know before the open
  5. Upcoming catalysts

Requires: GEMINI_API_KEY environment variable
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
# Helpers
# ---------------------------------------------------------------------------

def load_snapshot(out_dir):
    path = os.path.join(out_dir, "snapshot.json")
    if not os.path.exists(path):
        sys.exit(f"ERROR: {path} not found. Run build_data.py first.")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_events(out_dir):
    path = os.path.join(out_dir, "events.json")
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def build_prompt(snapshot, events):
    today = datetime.date.today().strftime("%A, %B %d, %Y")
    industry_perf = snapshot.get("industry_performance", {})
    breadth = snapshot.get("breadth", {})

    top5 = industry_perf.get("top5", [])
    bottom5 = industry_perf.get("bottom5", [])

    top5_str = "\n".join(
        f"  {i+1}. {r['industry']}: 1D {r['perf_1d']}, 1W {r['perf_1w']}, 1M {r['perf_1m']}"
        for i, r in enumerate(top5)
    ) or "  (no data)"

    bottom5_str = "\n".join(
        f"  {i+1}. {r['industry']}: 1D {r['perf_1d']}, 1W {r['perf_1w']}, 1M {r['perf_1m']}"
        for i, r in enumerate(bottom5)
    ) or "  (no data)"

    breadth_str = (
        f"  % above 200-day SMA  : {breadth.get('above_200sma_pct', 'N/A')}%\n"
        f"  % in top 30% of 52wk : {breadth.get('near_52w_high_pct', 'N/A')}%\n"
        f"  Tickers sampled       : {breadth.get('tickers_sampled', 'N/A')}"
    )

    indices = snapshot.get("groups", {}).get("Indices", [])
    indices_str = "  " + "  ".join(
        f"{r['ticker']} {r.get('daily', 'N/A'):+.2f}%"
        for r in indices if r.get("daily") is not None
    )

    sectors = snapshot.get("groups", {}).get("Sel Sectors", [])
    sectors_str = "\n".join(
        f"  {r['ticker']}: {r.get('daily', 'N/A'):+.2f}% (1D)  {r.get('5d', 'N/A'):+.2f}% (5D)  ABC={r.get('abc', '?')}  RS={r.get('rs', '?')}"
        for r in sorted(sectors, key=lambda x: x.get("daily") or 0, reverse=True)
        if r.get("daily") is not None
    ) or "  (no sector data)"

    events_str = "\n".join(
        f"  {e.get('date','')} {e.get('time','')} — {e.get('event','')}"
        for e in events[:10]
    ) or "  (none scheduled)"

    # RS leaders: tickers with RS >= 70 and ABC = A
    all_tickers = []
    for group_rows in snapshot.get("groups", {}).values():
        all_tickers.extend(group_rows)
    rs_leaders = sorted(
        [r for r in all_tickers if (r.get("rs") or 0) >= 70 and r.get("abc") == "A"],
        key=lambda x: x.get("rs", 0), reverse=True
    )[:10]
    rs_str = "\n".join(
        f"  {r['ticker']}: RS={r['rs']}, ABC={r['abc']}, 1D={r.get('daily','?'):+.2f}%, 5D={r.get('5d','?'):+.2f}%"
        for r in rs_leaders
    ) or "  (none meet criteria)"

    return f"""Today is {today}.

=== MARKET DATA ===

[Index Performance]
{indices_str}

[Sector Performance (sorted by 1D)]
{sectors_str}

[Top 5 Strongest Industries (Finviz)]
{top5_str}

[Bottom 5 Weakest Industries (Finviz)]
{bottom5_str}

[Market Breadth]
{breadth_str}

[RS Leaders — RS>=70 & ABC=A]
{rs_str}

[Upcoming Key Events]
{events_str}

=== TASK ===
You are writing an institutional-quality US Market Morning Brief for professional traders.
Using ONLY the data above, produce a concise brief with exactly these sections:

## 1. Industry Rotation
- Top vs bottom industries; identify any rotation theme (e.g. growth->defensives, tech->energy)
- Note if 1W/1M trends confirm or contradict today's 1D move

## 2. Relative Strength Picks (RS Screener)
- From the RS leaders list, highlight 3-5 tickers worth watching
- For each: ticker, 1-line reason (trend, breakout, volume, sector tailwind)

## 3. Market Breadth Interpretation
- Is breadth expanding or contracting?
- Bullish / Neutral / Weakening -- and why
- Flag any divergence (e.g. indices up but breadth falling)

## 4. Five Things to Know Before the Open
- Five concise bullet points covering macro, rates, sentiment, flows, or geopolitics
- Derive from the sector/index moves and events; flag anything non-obvious

## 5. Upcoming Catalysts
- Same-day events (pre-market / intraday)
- This week's key events
- Note which could move markets and how

Rules:
- Bullet points only, no filler prose
- Keep each section under 8 bullets
- End with one "Key Divergence Alert" line if any non-obvious divergence exists
"""


GEMINI_API_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent"
)


def call_gemini_with_retry(prompt, max_retries=3):
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        sys.exit("ERROR: GEMINI_API_KEY environment variable is not set.")

    headers = {"Content-Type": "application/json"}
    params = {"key": api_key}
    payload = {
        "contents": [
            {"parts": [{"text": prompt}]}
        ],
        "generationConfig": {
            "temperature": 0.4,
            "maxOutputTokens": 2048,
        },
    }

    for attempt in range(max_retries):
        try:
            resp = requests.post(
                GEMINI_API_URL,
                headers=headers,
                params=params,
                json=payload,
                timeout=60,
            )
            if resp.status_code == 429:
                raise IOError("rate_limit")
            resp.raise_for_status()
            data = resp.json()
            return data["candidates"][0]["content"]["parts"][0]["text"]
        except (IOError, requests.HTTPError) as e:
            is_rate_limit = "rate_limit" in str(e) or (
                hasattr(e, "response") and getattr(e.response, "status_code", 0) == 429
            )
            if is_rate_limit and attempt < max_retries - 1:
                wait = 2 ** attempt
                print(f"Gemini rate limit (429), retrying in {wait}s... (attempt {attempt+1}/{max_retries})")
                time.sleep(wait)
            else:
                raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", default="data", help="Directory with snapshot.json / events.json")
    parser.add_argument("--brief-file", default=None, help="Where to write the brief (default: <out-dir>/morning_brief.md)")
    args = parser.parse_args()

    out_dir = args.out_dir
    brief_path = args.brief_file or os.path.join(out_dir, "morning_brief.md")

    print("Loading snapshot...")
    snapshot = load_snapshot(out_dir)
    events = load_events(out_dir)

    print("Building prompt...")
    prompt = build_prompt(snapshot, events)

    print("Calling Gemini 2.5 Pro via REST API...")
    brief = call_gemini_with_retry(prompt)

    with open(brief_path, "w", encoding="utf-8") as f:
        f.write(brief)

    print(f"Morning brief written to {brief_path}")
    print("\n" + "=" * 60)
    print(brief)


if __name__ == "__main__":
    main()
