---
name: morning-brief
description: >
  Generate the daily morning market brief for Jie Sheng. Reads today's
  TradingView watchlist and screener results, generates a structured
  StructuredBrief JSON (mood, posture, indices, sectors, industry movers,
  trader lens, standout, watchlist, movers, calendar), and pushes the result
  to the live dashboard so all viewers see it immediately.
  TRIGGER whenever the user says: "run morning brief", "generate brief",
  "morning brief", "market brief", "run brief", "refresh brief", or
  anything implying they want today's market brief generated.
---

# Morning Brief Skill

Generates today's market brief using live web data + the TV watchlist and screener results,
then pushes it to the dashboard so Jie and his viewers see it in real time.

---

## DAILY WORKFLOW — two paths

```
PATH A: Claude CLI (richest — web search + live TV watchlist)
   Step 1  Read TV watchlist via Chrome
   Step 2  Read TV screener top tickers
   Step 3  Generate brief (web search grounded)
   Step 4  Push to dashboard

PATH B: python cli_run.py (fast — snapshot-fed, no web search)
   Reads watchlist from dashboard DB + screener json
   Calls DeepSeek / Gemini API directly
   Pushes to dashboard
```

---

## PATH A — Claude CLI (run this in Claude CLI / Codex CLI)

### Step 1 — Read Jie's TV Watchlist via Chrome

Navigate Chrome to the watchlist URL. The user must be logged in to TradingView in Chrome.

```
URL: https://www.tradingview.com/watchlists/169793207/
```

Use `get_page_text` or `read_page` to extract all visible ticker symbols from the watchlist panel.
Parse them into a clean comma-separated list, e.g. `NVDA, TSLA, AAPL, ...`.

Store as `$WATCHLIST_TICKERS`.

If Chrome is unavailable or the page requires login:
- Fall back to the dashboard DB: `GET https://market-dashboard-ivory.vercel.app/api/watchlist/export`
  with `Authorization: Bearer <BRIEF_INGEST_KEY>` (key is in `.env.local`).
- If still unavailable, proceed with the screener tickers only (Step 2).

### Step 2 — Read today's TV Screener top tickers

Navigate Chrome to each screener and note the top 5 tickers visible:

| Screener | URL |
|---|---|
| Top Gainer | https://www.tradingview.com/screener/1R7JpXRD/ |
| Best Winners | https://www.tradingview.com/screener/CE7LsGK3/ |
| Premarket Movers | https://www.tradingview.com/screener/BDYpp0Ef/ |
| VCP USA 200MA | https://www.tradingview.com/screener/491EL1gR/ |

Combine top tickers from all screeners, deduplicate, and merge with `$WATCHLIST_TICKERS`.
Store the merged list as `$FULL_WATCHLIST` (personal + screener extras, deduplicated).

If Chrome is unavailable, skip this step. The screener results from the last daily run
are already embedded in the snapshot via `tv_screeners.json`.

### Step 3 — Generate the StructuredBrief

Build the prompt using `handler.py`:

```python
from handler import build_prompt
import datetime

now_myt = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=8)
date_str = now_myt.strftime("%A, %B {day}, %Y").replace("{day}", str(now_myt.day))
prompt = build_prompt(date_str, watchlist=$FULL_WATCHLIST)
```

Call the AI with web search enabled (Gemini Search Grounding or Claude web search):
- Pre-market (before 9:30 PM MYT): use Gemini or Claude — web search gives richer citations
- Intraday: use DeepSeek — fast, cheap, snapshot-fed

The response MUST be a single JSON object matching the StructuredBrief schema.
Validate it parses correctly before pushing.

### Step 4 — Push to dashboard

```python
python ingest_to_dashboard.py brief_output.json
```

Or call `cli_run.py` directly with the watchlist extracted in Steps 1-2:

```bash
python cli_run.py \
  --provider gemini \
  --tv-watchlist "NVDA,TSLA,AAPL,..." \
  --post
```

Confirm push: `✓ Pushed: bucketAt=... id=...`

Dashboard viewers see the updated brief within 60 seconds (the poll interval).

---

## PATH B — Direct Python (quick re-run, no web search)

Use this for intraday snapshot refreshes or when you just want a fast re-run.

```bash
cd "C:\Users\jiesh\AI codes hub\market_dashboard\packages\core-skills\morning-brief"

# Uses watchlist from dashboard DB + today's screener results automatically
python cli_run.py --provider deepseek --post

# Override with specific tickers
python cli_run.py --provider deepseek --post --watchlist "NVDA,TSLA,AAPL,COIN"
```

Watchlist resolution order:
1. `--watchlist` flag (if provided)
2. `--tv-watchlist` flag (tickers extracted from Chrome, passed by Claude CLI)
3. `WATCHLIST=...` in `.env.local`
4. Dashboard DB (`/api/watchlist/export` — your saved watchlist)
5. Top tickers from `tv_screeners.json` (always merged in as extras)

---

## PATH C — Dashboard "Refresh" button (no terminal needed)

Log in as owner → Conviction Desk → click **"Refresh DeepSeek"** (or Gemini/GPT/Claude).

The server reads your watchlist from the DB and regenerates. Same result as Path B but
triggered from the browser. Other viewers see the update within 60 seconds.

---

## What viewers (friends) see

Anyone you promote to `allowed` role in `/admin` can:
- Open the dashboard URL
- See the live brief, indices, trader lens, standout, breadth panels, TV screener hits
- See live quotes (updated every 5 min by GitHub Actions Yahoo fallback)

They do NOT see the Watchlist Editor (owner-only panel).
They cannot trigger re-runs.

---

## Full pre-market routine (recommended order)

```bash
# 1. Generate fresh breadth scan (5-10 min, optional — GitHub Actions does this too)
cd apps/market_dashboard_backend
python scripts/breadth_scan.py --out-dir data

# 2. Fetch TV screener results + auto-score top 5
python scripts/tv_screener_fetch.py --out-dir data

# 3. Sync data to Next.js public folder
cd ../../apps/market_dashboard
npm run sync:market

# 4. Generate morning brief + push (reads your dashboard watchlist automatically)
cd ../../packages/core-skills/morning-brief
python cli_run.py --provider gemini --post
```

Or via Claude CLI (richer — uses live web search + reads TV watchlist from Chrome):
```
run morning brief
```

---

## Files

| File | Purpose |
|------|---------|
| `prompt.md` | Prompt template — `{date_str}` and `{watchlist_str}` slots |
| `handler.py` | `build_prompt()` — renders the prompt |
| `handler.ts` | TypeScript version — used by Next.js server routes |
| `cli_run.py` | End-to-end CLI runner (generate + push) |
| `ingest_to_dashboard.py` | Standalone push — reads JSON file → POST to ingest API |
| `_env_loader.py` | Auto-loads `.env.local` so no shell profile setup needed |
| `schema.json` | JSON-schema for skill inputs |
| `knowledge.md` | Editorial format notes |

---

## Trader-style framework (7 lenses)

| Handle | Style |
|---|---|
| @markminervini | SEPA/VCP — Stage 2 uptrend only |
| @Clement_Ang17 | 21EMA pullbacks — liquid leaders only |
| @jfsrev (Jeff) | Mechanical — RVOL + tight LoD required |
| @TedHZhang | Institutional — three-pillar thesis |
| @SRxTrades | Technical swing — breakout or MA pullback |
| @PrimeTrading_ | Momentum — 21dma pullbacks only |
| @Qullamaggie | Breakouts + Episodic Pivots — LOD stop |
| Composite | Synthesised actionable verdict |

Full `styleShort` definitions are in `apps/market_dashboard/src/lib/brief/trader-profiles.ts`.
