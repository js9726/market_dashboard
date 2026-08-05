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
PATH A: Claude CLI itself generates the brief (populates the "Claude" tab)
   Step 1  Read TV watchlist via Chrome
   Step 2  Read TV screener top tickers
   Step 3  Claude CLI runs WebSearch against the prompt.md research sections
           → produces a single StructuredBrief JSON object in chat
   Step 4  Pipe the JSON through ingest_to_dashboard.py
           → lands on the Claude tab (provider="claude")

PATH B: python cli_run.py (API-driven, populates DeepSeek/Gemini/Codex tabs)
   Reads watchlist from dashboard DB + screener json
   Calls the chosen provider's API (DeepSeek / Gemini / OpenAI / Anthropic)
   Pushes to dashboard as that provider
```

---

## PATH A — Claude CLI (run this in Claude CLI / Codex CLI)

> **The push to the dashboard is MANDATORY — always run Step 4.**
> The brief is useless sitting in memory. Step 4 is what puts it live for viewers.

### Step 0.0 — Open TradingView in Chrome — MANDATORY FIRST ACTION

**Do this before Step 0. Every run. No exceptions.**

Open Jie's authenticated TradingView through the Chrome MCP (`mcp__claude-in-chrome__*`,
his real Chrome with the logged-in session) — not the in-app browser, which has no
TradingView login:

```
mcp__claude-in-chrome__navigate  ->  https://www.tradingview.com/watchlists/169793207/
```

Load the core tool set in ONE ToolSearch call before starting:
`select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page`

Why this is first and not optional:

- The authenticated chart panel is the ONLY source for `RS Rating`, `U/D Ratio`, `ADR%`,
  `Rel. Vol`, `LoD Price`, `Off 52W High`, and `ATR% Multiple From MA`. None of these exist
  in OpenD klines. On 2026-08-04 a brief scored AVGO from klines alone and missed
  `RS Rating 67.7` / `U/D 1.0` — the two facts that most argued against the trade.
- `tradingview-daily-screener/SKILL.md` already makes the authenticated daily+weekly chart a
  hard gate: **missing either chart caps the ticker at `WATCH`.** The same cap applies here.

Then scan `jie_wiki/tradingview_snapshots/raw` with `scripts/scan_user_snapshots.py`. Every
newly indexed image is a **user-nominated `PRELIMINARY FOCUS`** candidate for the next US
session and MUST appear in the Focus List — a nomination is never an automatic GO, but it is
never silently dropped either. On 2026-08-04 RBRK and TOST were nominated and never made the
report.

If Chrome MCP cannot reach TradingView, say so explicitly in the brief and cap every affected
ticker at `WATCH`. Do not silently continue on klines alone.

### Step 0 — Fetch live prices from moomoo OpenD (preferred over yfinance)

Run `fetch_opend_live.py` to get real-time quotes, pre-market data, and RVOL from the
locally running OpenD instance before generating the brief. This replaces stale snapshot
prices with live data and adds pre-market context that yfinance cannot provide.

```powershell
cd "C:\Users\jiesh\AI codes hub\market_dashboard\packages\core-skills\morning-brief"

# Output to a file so Step 3 can read it directly into {live_data_block}
python fetch_opend_live.py --out opend_live.json

# Or: pipe directly and capture for use in the prompt
python fetch_opend_live.py
```

If OpenD is not running (CI / GitHub Actions): skip this step — `cli_run.py` falls back to
yfinance automatically. For manual Claude CLI runs, always do Step 0 first.

The script reads these extra fields for each ticker:
- `pre_price` / `pre_chg` — pre-market price and change % (before 9:30 AM ET)
- `after_price` / `after_chg` — after-hours price and change % (after 4:00 PM ET)
- `rvol` — relative volume vs 10-day average (key entry filter)

Enrich the `$FULL_WATCHLIST` with the OpenD tickers if you have them, then proceed to Step 0.5.

### Step 0.5 — Compute index technicals (ATR / RSI / MACD / extension) — MANDATORY

Compute daily-bar technicals for SPY / QQQ / DIA so the brief can grade **entry-risk per index**.
The user needs to know whether chasing index breakouts is dangerous before any setup analysis.

```powershell
python compute_index_technicals.py --tickers SPY,QQQ,DIA
# Optional: include IWM, SMH, etc.
python compute_index_technicals.py --tickers SPY,QQQ,DIA,IWM,SMH
```

This writes `index_technicals.json` containing per-index:
- `atr14`, `ema21`, `ema50`, `ma200`
- `dist_21_atr` / `dist_50_atr` / `dist_200_atr` (distance in ATR units)
- `rsi14` + `overbought` (>70) / `oversold` (<30) flags
- `macd`, `macd_signal`, `macd_hist`, `macd_dir` (RISING/FALLING/FLAT)
- `curving_down` (histogram falling while line > signal — momentum cooling)
- `bear_cross_imminent` (line about to cross below signal)
- `entry_risk` classification per the rubric:

| `entry_risk` | Distance from 21EMA | Meaning |
|---|---|---|
| `EXTREME-EXTENDED` | ≥ +3 ATR | Don't chase — mean reversion ~70% within 5-10 sessions |
| `EXTENDED` | +2 to +3 ATR | Wait for first pullback |
| `FAIR` | +0.5 to +2 ATR | Normal mid-range entry zone |
| `AT-MA` | -0.5 to +0.5 ATR | Favourable entry zone |
| `OVERSOLD-PB` | ≤ -0.5 ATR | Potential reversal play |

The brief's `technicals` field and `technicalsNarrative` MUST cite these numbers and
classify each index. If QQQ shows EXTREME-EXTENDED + RSI > 70 + MACD curving down,
the brief's `posture` should reflect that — typically `WAIT` or `TRIM_TIGHTEN`, not `GO`.

### Step 0.7 — Open Holdings Overnight Review — MANDATORY (operator-local)

The watchlist/screener cover **new** opportunities; this step covers the **book you
already hold** — the half the brief historically missed. Before researching new setups,
sweep the live positions for any stop that broke overnight (incl. after-hours) and any
extended winner to trim. Source of truth = **live broker positions**, not the sheet.

```powershell
cd "C:\Users\jiesh\AI codes hub\market_dashboard\packages\core-skills\morning-brief"
# Pass journaled stops so R + stop-status are exact (read them from the T.Journal sheet
# or the dashboard trades). OPEND_ACC_ID comes from env — never hardcode the account id.
$env:OPEND_ACC_ID="<your live US acc id>"
python holdings_review.py --stops '{"VRT":326.48,"HUT":93.91,"TENB":22.99}'
```

Output is urgency-sorted: `CUT` (regular-session stop broken) → `CUT-ON-OPEN`
(after-hours below stop — decide on the open, don't chase the thin AH print) → `WARN`
(within 0.3 ATR of stop, or below 8EMA) → `OK`. R is `(last−entry)/(entry−stop)`.

- **Sweep BOTH brokers (2026-07-09).** `holdings_review.py` covers moomoo only. Jie also
  holds positions at IBKR (account identifier intentionally omitted; e.g. RBRK; ONTO previously), which a moomoo-only
  sweep silently misses. Also run the read-only IBKR dry run:
  `cd "C:\Users\jiesh\AI codes hub\market_dashboard\packages\dashboard-bridge"; & ".venv\Scripts\python.exe" ibkr_bridge.py`
  (no `--post` = dry run; needs TWS at 127.0.0.1:7496). If TWS is down, fail-closed:
  report the IBKR book as UNVERIFIED — never state "no other positions".
- **Skip this step in CI / GitHub Actions / SaaS** — there is no broker there. It is for
  manual operator runs only (OpenD on `127.0.0.1:11111`).
- If any holding is `CUT` / `CUT-ON-OPEN` / `WARN`, or you want the full per-holding
  **HOLD / TRIM / CUT** call with the overnight news catalyst and wiki citations, run the
  **trade-analyser skill → Mode C (Open-Holdings Daily/Overnight Review)**, which adds the
  day-by-day + news + verdict and refreshes each held trade on the dashboard.
- Surface a one-line holdings line in the brief's narrative (e.g. "Book: VRT stop broken
  AH on the Broadcom sell-the-news → cut/cut-on-open; HUT/TENB extended, trail") so viewers
  see position risk alongside the market posture. Never place or modify orders — give the
  levels; the operator executes.

### Step 0.8 — THEME RADAR — MANDATORY (this step exists because it was missed)

**Failure this prevents (2026-08-05).** Cybersecurity ran **+40% to +102% over three months**
while SPY did +7.3%. It is the operator's single largest thematic exposure — OKTA, NET, CRWD,
PANW, ZS, TENB, RBRK all appear in his journal. The brief never named it once across **six
consecutive sessions (2026-07-21 -> 2026-08-04), every one of which produced an EMPTY GO list.**
`CIBR` was in `_DEFAULT_TICKERS` the entire time. The quote was fetched every morning and
discarded, because `sectorsThemes` was only ever populated with sector ETFs. This was an
analysis gap, not a data gap. Do not let it recur.

**Sector ETF != theme.** XLK does not tell you cybersecurity is leading. Neither does the
screener's `industry` field — `Packaged Software` covers VEEV, TOST, CRWD and ZS, which trade
nothing alike. Compute the theme explicitly.

**0.8a — Rank themes by relative strength.** For each theme below pull the proxy ETF plus 2-4
constituents, and compute 1W / 1M / 3M return **relative to SPY**. Rank descending. A theme is
LEADING when its 1M and 3M both beat SPY and its proxy ETF is above a rising 21EMA.

| Theme | Proxy | Constituents |
|---|---|---|
| Cybersecurity | `CIBR`, `HACK` | CRWD, PANW, ZS, OKTA, NET, FTNT, S, CYBR, TENB, RBRK |
| Semis / AI silicon | `SMH` | NVDA, AVGO, AMD, MRVL, ALAB, CRDO, ARM |
| Software / SaaS | `IGV` | SNOW, DDOG, MDB, VEEV, TOST, U |
| Nuclear / power | `NLR` | CEG, LEU, SMR, TLN, VRT |
| Crypto-adjacent | `WGMI` | HUT, CIFR, GLXY, CRCL, IREN |
| Quantum / space | — | IONQ, RGTI, ASTS, RKLB |
| Biotech / health | `XBI`, `IBB`, `XLV` | **INDICATOR ONLY - see 0.8c** |

**0.8b — Derive the theme of HIS OWN book — AUTOMATICALLY, never from a hand-typed list.**

```bash
python theme_radar.py --book OKTA,FFIV,MTLS      # Finviz auto-classifies every ticker
python finviz_classify.py --industries           # all 144 industries ranked by 1M
```

`finviz_classify.py` pulls sector/industry per ticker from Finviz (30-day cache) and joins it
to the live 144-industry performance ranking. **A hardcoded theme->ticker dict is forbidden as
the primary classifier** — Jie flagged 2026-08-05 that any ticker missing from such a map falls
through as "unthemed", which is the identical stale-list failure that caused the original
cyber blind spot. The curated `THEMES` map in `theme_radar.py` is an OVERLAY that only adds
resolution (e.g. "cybersecurity" is finer than Finviz's `Software - Infrastructure`); it never
gates coverage. Report each holding's industry, its **rank out of 144**, and its 1M performance.

Also read live holdings (Step 0.7) plus the journal's
recent tickers and bucket them by theme. Report: *"Your book is currently N% <theme>; that theme
is <LEADING|LAGGING> at <x>% 1M vs SPY <y>%."* If his largest exposure sits in a lagging theme,
say so plainly. If a LEADING theme has zero representation in his book, say that too - that is
the miss that generates FOMO.

**0.8b-ii — Finviz FAIL-CLOSED + Chrome MCP escalation (MANDATORY).**

Finviz changed its markup **twice on 2026-08-05** — the quote page moved to
`a.quote-header_category`, and the groups table moved to a client-rendered JSON blob.
The scripts parse the JSON and **fail loudly** rather than returning blanks. If you see
`parsed 0 industries` or `UNCLASSIFIED` on liquid common stock, the scraper is broken:

1. **Escalate to Chrome MCP** — open `https://finviz.com/groups.ashx?g=industry&v=210`
   and `https://finviz.com/quote.ashx?t=<TICKER>` in the operator's authenticated Chrome
   (`mcp__claude-in-chrome__navigate` + `get_page_text`) and read the rendered values.
   Chrome sees the page after JS runs, so it survives markup changes that break regex.
2. **Never substitute a sector ETF** for the missing industry data — that is the exact
   lens error that hid cybersecurity for six sessions.
3. **Say so in the brief.** A missing industry read is a stated gap, never a silent blank.

A zero-row parse is a BROKEN SCRAPER, not a flat market. `build_data.py` returned empty
industry lists for an unknown period before this was caught, and downstream that is
indistinguishable from a quiet tape.

**0.8c — Health/biotech is an indicator, never an auto-theme.** Defensive pharma leading is a
risk-off tell. Exclude health from theme-driven GO promotion unless the operator explicitly
opts in, per `wiki/` medical-theme doctrine. (Verified 2026-08-05: XLV +0.1% 1M vs cyber +5.4%
to +21.7% - the exclusion was correct.)

**0.8d — Extension gate on every theme name.** Compute `(price - EMA21) / ATR14`. Operator's own
216-trade record:

| Zone | Verdict | Evidence |
|---|---|---|
| `< 0.5 ATR` (at/below MA) | HALF SIZE, requires volume expansion + close confirmation | n=17, PF **0.31** |
| `0.5 - 2.5 ATR` | GREEN - full size | n=35, PF **1.69 - 4.31** |
| `> 2.5 ATR` | **BLOCKED** | n=6, **0 wins** |

A LEADING theme whose names are all `>2.5 ATR` is a theme to WAIT on, not chase. Say that
explicitly rather than promoting an extended name because the theme is hot.

**0.8e — Market-edge confluence (operator's A+ setup).** Flag a name only when ALL FOUR hold:

1. Pullback **holds the moving averages** (launchpad intact)
2. **Volume dries up on the pullback** - contraction, not distribution
3. **RS holds or rises while the market drops** - the deciding tell
4. **Theme is performing** (ex-health)

Absent any one, it is WATCH, not GO.

**0.8f — Empty-GO-list self-check - HARD REQUIREMENT.** If the GO list is empty for a
**third consecutive session**, the brief MUST state:

> "GO list empty N sessions running. This may be a broken gate rather than a quiet tape.
> Leading theme is <X> at <y>% 1M. Names in the 0.5-2.5 ATR green zone right now: <list>."

Six straight empty GO lists while cyber ran +40-102% is a system defect, not selectivity.
Never present a persistently empty GO list as market caution without this check.

**0.8g — Honesty contract.** End every brief with what was NOT verified: charts not opened,
feeds stale, catalysts unconfirmed, themes not scanned. An unstated gap reads as a cleared
check. Never imply coverage that did not happen.

### Step 1 — Read Jie's TV Watchlist via Chrome

Navigate Chrome to the watchlist URL. The user must be logged in to TradingView in Chrome.

```
URL: https://www.tradingview.com/watchlists/169793207/
```

Use `get_page_text` or `read_page` to extract all visible ticker symbols from the watchlist panel.
Parse them into a clean comma-separated list, e.g. `NVDA, TSLA, AAPL, ...`.

Store as `$WATCHLIST_TICKERS`.

If Chrome is unavailable or the page requires login (Step 0.0 should already have established the session — treat a failure here as a data gap to report, not a silent fallback):
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

Before promoting any screener ticker to `GO`, apply the catalyst-source gate from `jie_wiki/wiki/ticker-catalyst-analysis.md`: recent events, insider/institutional activity, peer/sector trend, next catalysts, analyst actions, and source gaps must be present or explicitly unavailable. Medical/biotech/healthcare/FDA-driven names are rotation/speculation indicators first and stay `WAIT` unless company stage, catalyst, peer confirmation, binary risk, and insider read are clear.

If Chrome is unavailable, fall back to the cached `tv_screeners.json` from the last daily run — but state in the brief that the screener read was cached, and cap any ticker whose authenticated chart was never opened at `WATCH`.

### Step 3 — Claude CLI generates the StructuredBrief itself

This step is what makes PATH A populate the **Claude** tab on the dashboard.
Claude CLI is the generator here — not Gemini, not DeepSeek. `cli_run.py` calls
external provider APIs and is used in PATH B; do NOT use it in this step.

1. **Read the prompt template** at `packages/core-skills/morning-brief/prompt.md`.
2. **Read the trader profiles** at `packages/core-skills/_shared/trader-profiles.json`
   so the `traderLens` and `movers[].traderLens` fields use the correct seven names.
3. **Fill the prompt slots locally:**
   - `{date_str}` — today's date in Malaysia time (MYT = UTC+8).
   - `{watchlist_str}` — `$FULL_WATCHLIST` from Steps 1–2.
   - `{live_data_block}` — **use OpenD output from Step 0 if available** (read `opend_live.json`
     or the stdout from `fetch_opend_live.py`). If Step 0 was skipped, fetch CNN Fear & Greed
     (`https://production.dataviz.cnn.io/index/fearandgreed/graphdata`) and call yfinance as
     fallback, OR leave a brief "unavailable" stub. Do not hold up Step 3 on data fetching —
     the WebSearch in Step 4 will fill any gaps.
4. **Use your WebSearch tool** to research the sections enumerated in `prompt.md`
   (indices/breadth/sectors/industry movers/earnings/economic calendar/Fear & Greed).
   Every numeric value you emit must be traceable to a citation you actually fetched.
5. **Emit a single JSON object** matching the StructuredBrief schema (the schema is
   described inline in `prompt.md`). No prose, no markdown — JSON only.

### Step 4 — Push the Claude-generated JSON to the Claude tab

`ingest_to_dashboard.py` defaults `BRIEF_PROVIDER` to `"claude"`, so a plain pipe lands
on the Claude tab. Save the JSON from Step 3 to disk first (so the push is reproducible
and the JSON is auditable), then ingest:

```powershell
cd "C:\Users\jiesh\AI codes hub\market_dashboard\packages\core-skills\morning-brief"

# write the JSON Claude produced in Step 3 to a file (PowerShell heredoc):
@'
{ "mood": {...}, "breadth": {...}, ... full StructuredBrief ... }
'@ | Out-File -Encoding utf8 brief_output.json

# push as provider=claude (the default)
python ingest_to_dashboard.py brief_output.json
```

Bash / WSL equivalent:

```bash
cd "/c/Users/jiesh/AI codes hub/market_dashboard/packages/core-skills/morning-brief"
cat > brief_output.json <<'EOF'
{ "mood": {...}, "breadth": {...}, ... full StructuredBrief ... }
EOF
python ingest_to_dashboard.py brief_output.json
```

**Confirm in chat:**
> `✓ Ingested as provider='claude', bucketAt=<ISO>`

Dashboard viewers see the updated **Claude** chip within ~60 seconds (the poll interval).

If you only need to refresh DeepSeek/Gemini/Codex instead, jump to PATH B.

---

## PATH B — `cli_run.py` (refreshes DeepSeek / Gemini / Codex tabs)

Use this for the **non-Claude** provider tabs. Each invocation calls one provider's
API and pushes the result tagged as that provider. The Claude tab is NOT refreshed
by this path — use PATH A for that.

```bash
cd "C:\Users\jiesh\AI codes hub\market_dashboard\packages\core-skills\morning-brief"

# DeepSeek — fast, cheap intraday refresh (no web search)
python cli_run.py --provider deepseek --post

# Gemini — pre-market run, Search Grounding gives richer citations
python cli_run.py --provider gemini --post --tv-watchlist "NVDA,TSLA,AAPL,..."

# Codex tab (stored as provider=openai) — pre-market, web_search_preview tool
python cli_run.py --provider openai --post

# Override watchlist with specific tickers
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

Log in as owner → Conviction Desk → click **"Refresh DeepSeek"** (or Gemini/Codex/Claude).

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

# 4. Refresh the non-Claude provider tabs via PATH B
cd ../../packages/core-skills/morning-brief
python cli_run.py --provider gemini --post
python cli_run.py --provider deepseek --post
python cli_run.py --provider openai --post   # Codex tab; optional, requires OPENAI_API_KEY
```

Then run Claude CLI to refresh the **Claude** tab via PATH A:
```
run morning brief
```
Claude CLI uses its own WebSearch tool, emits a StructuredBrief JSON, and pipes
it through `ingest_to_dashboard.py` (which defaults to provider=claude).

---

## Journal v2 contract — the brief MUST comply

Source of truth: `jie_wiki/docs/agents/work/ai-managed-trading-journal-v2/spec.md`
(approved by Jie 2026-08-04). The morning brief feeds the journal, so it uses the same
vocabulary and the same caps. Divergence here is a defect, not a style choice.

**Regime labels — use these exact five. No invented labels.**

`EARLY RECOVERY` | `RISK-ON / CONFIRMED UPTREND` | `EXTENDED` | `RISK-OFF / BREAKDOWN` | `MIXED/SELECTIVE`

Conflicting signals produce `MIXED/SELECTIVE`. Never a confident-sounding hybrid.
(Observed defect 2026-08-04: a brief shipped `CAUTIOUSLY-RISK-ON`, which is not a valid label.)

**Personal Traction overlay — always state it; it is separate from the regime.**

`YELLOW` is the default (max 0.5% new trade risk). `GREEN` needs 2 of the last 3 compliant
trades at +1R or protected with positive combined R (0.75–1.0%). `RED` halves risk
0.5% -> 0.25% -> 0.125%. A -5% month-to-date drawdown blocks new risk entirely while GO
candidates stay visible. Rule-breaking trades cannot prove positive traction.
(Observed defect 2026-08-04: the brief carried no traction label at all.)

**Portfolio caps — the allowed risk is the LOWEST of conviction tier, setup cap, regime,
traction, portfolio, and event caps.**

| Regime | Total new/open risk |
|---|---|
| Risk-Off | 0 |
| Early Recovery | 0.5% |
| Risk-On | up to 3.0% |
| Extended | 0 new |

Conviction 75–84 -> max 0.5%; 85–89 -> 0.75%; 90–100 -> 1.0%.

**GO lifecycle.** An early scan produces `PRELIMINARY FOCUS` only. An execution GO needs a
refresh within 60 minutes before the open or during the session, and deterministic gates
revalidated every 15 minutes in Jie's active window. Untriggered signals expire at the close;
no new paper entries after 00:00 MYT; no automated premarket paper entries at all.

**Owner / validator.** The first of Claude or Codex to complete the full brief owns the
session; the other validates later. One owner GO is sufficient. A factual error or hard-gate
failure blocks it — a judgment difference alone is recorded as `JUDGMENT_DIFFERS` and does
NOT cancel the owner's GO.

**UNPROTECTED positions.** Any live position without an active broker-side stop is marked
`UNPROTECTED` and blocks new live risk — except holdings explicitly classified `HOLD-EXEMPT`
in the wiki (currently MTLS; see `jie_wiki/wiki/companies/materialise.md`). Do not report a
HOLD-EXEMPT position as a stop defect and do not count it against the risk budget.

## Files

| File | Purpose |
|------|---------|
| `prompt.md` | Prompt template — `{date_str}` and `{watchlist_str}` slots |
| `handler.py` | `build_prompt()` — renders the prompt |
| `handler.ts` | TypeScript version — used by Next.js server routes |
| `cli_run.py` | End-to-end CLI runner (generate + push) |
| `compute_index_technicals.py` | Daily-bar EMA8/21/50 + ATR + extension + entry-risk (get_cur_kline; reused by holdings_review) |
| `holdings_review.py` | **Step 0.7** — live broker holdings sweep: quotes + after-hours + stop-status + R per position (operator-local) |
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
