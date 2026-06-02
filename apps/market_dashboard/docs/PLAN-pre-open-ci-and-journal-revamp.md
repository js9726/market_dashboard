# Plan — Pre-Open CI + Multi-Provider AI + Journal Revamp

**Owner:** Jie Sheng
**Status:** IN PROGRESS — Phases 1-3 shipped; breadth + live-quote reliability overhaul shipped 2026-05-29
**Created:** 2026-05-28
**Last revised:** 2026-05-29 (Revision 2 — reliability architecture)
**Target completion:** ~2-3 weeks (Phase 1-6 incremental ship)

---

## REVISION 3 (2026-06-02) — Final goal: multi-client SaaS (read-only)

Direction confirmed with the operator: this becomes a **multi-client SaaS**,
**read-only** (analysis + journal; no order routing). Two-plane data model:

**Plane 1 — Shared market data (multi-tenant):** breadth, screeners, brief,
market internals. Market-wide, computed ONCE server-side, served to all clients.
Driven by an **always-on engine** (Linux x86 VM ~$5/mo, or Oracle ARM free tier)
whose refresh scheduler pings `/api/{breadth,screeners,cron/refresh-*}` — NOT paid
Vercel crons (Hobby = once-daily backstop only). See
`packages/dashboard-bridge/deploy/vm-setup.sh` + `docs/HOMEPC-SERVER.md`.

**Plane 2 — Per-client account data:** v1 = **CSV import + manual entry**
(`/api/csv/import`, `/api/trades/manual`). Live per-client broker links (IBKR Web
API OAuth / official IBKR↔Claude connector) are a LATER phase. The owner's
**OpenD + IBKR remain the operator feed** (OpenD primary, IBKR fallback) on the
engine box — never shared with clients (CLAUDE.md broker-safety rule).

**Carried (shipped):** A-list = bought-position day-0→14 tracker (Realized-vs-R +
Soft-vs-Hard, both 1R bases) · merged REC/HELD board · auto-journal + nightly
digest · Market Internals tab · stale-data market-clock relabel · portfolio
prefers fresh LiveQuote over stale MarketQuote.

**Standing gates (must hold for every ticker analysis):**
- **Step 0.6 Data Freshness (fail-closed)** — pull live OpenD first; STOP + flag on stale/unreachable/missing.
- **Step 2.4 Tradeability Pre-Screen** — liquidity + extension + catalyst hard gate (extended/late or illiquid = PASS; a tight chart must not inflate the rubric).
- **Always run the 7-trader rubric** for ticker analysis (no narrative substitute).

**New build for SaaS v1 (next phases):**
1. Per-user auth tiers + data isolation (each client sees only their own CSV/manual book + the shared market-data plane).
2. Billing (e.g. Stripe) for paid tiers.
3. Move the live cadence onto the engine VM (`refresh-pinger`) → free + live.
4. Client onboarding: CSV import UX + manual-entry polish.
5. (Later) live per-client broker connectors (IBKR OAuth).

**Cost at goal:** ~$5/mo (engine VM) — or **$0** (Oracle ARM free + home PC) — +
free Vercel/Neon + **Claude via subscription** (not metered API). Scales with paid clients.

---

## REVISION 2 (2026-05-29) — Reliability & "Automation Vibe" Architecture

**Problem observed:** "the whole workflow is still not giving me an automation
vibe — I need to check whether GitHub is running, the market breadth is still
not updating."

**Root cause:** Critical data (breadth, live quotes) depended on SINGLE fragile
triggers: GH Actions cron (skips silently under load) writing FILES that needed
git-commit → Vercel-rebuild to appear. Plus yfinance 401-blocking the runner IP.
Any single failure = stale data + no signal.

**The principle now enforced for every critical data point:**

> **Redundant triggers → idempotent endpoint → DB push (never git-commit) → freshness badge.**
> No single point of failure. The user never has to "check if the workflow ran."

### Market breadth — SOLVED (was the worst offender)

| Old | New |
|---|---|
| breadth_scan.py scans ~5000 tickers (5-12 min, yfinance 401s) | TradingView scanner `totalCount` — 1 call per metric, **884ms total** on Vercel |
| Writes file → git commit → Vercel rebuild | `/api/breadth/refresh` computes server-side → upserts Postgres → dashboard reads instantly |
| Single GH cron trigger (skips silently) | **4 redundant triggers**: Vercel Cron (3×/weekday) + bridge daemon + external uptime cron (cron-job.org) + GH Actions legacy |
| No freshness signal | `/api/breadth` returns `_meta.refreshedAt`; panel badge shows age; polls every 5 min |

Files: `src/server/breadth-scanner.ts`, `/api/breadth/refresh`, `/api/breadth`,
`/api/cron/refresh-breadth`, `MarketBreadthSnapshot` model, `breadth_fast.py` (Python equivalent).

**Why TV scanner instead of "scrape a service":** It IS the scrape — TradingView's
`scanner.tradingview.com/america/scan` returns aggregate counts (advancers,
decliners, new highs/lows, % above SMA, per sector) in one HTTP call each.
Verified reachable from Vercel serverless IPs (not datacenter-blocked).

### Live quotes — SOLVED (fixes stale TENB price)

| Old | New |
|---|---|
| yahoo_fallback_quotes.yml — 401-failing for a week | **DELETED** |
| Position prices went stale | dashboard-bridge daemon pushes moomoo live quotes every 60s → `/api/live-quotes/ingest` |

Files: `packages/dashboard-bridge/bridge/live_quotes.py`, config `live_quote_key` + `live_quote_extras`.

### Reliability layers (defense in depth)

1. **Cloud-primary (no PC needed):** Vercel Cron hits the refresh endpoints on schedule.
2. **Local-authoritative (when PC on):** dashboard-bridge daemon pushes moomoo data every 60s.
3. **Zero-dependency backup:** external uptime cron (cron-job.org / UptimeRobot) can hit
   `/api/breadth/refresh?key=...` — survives even if BOTH Vercel cron and PC are down.
4. **Freshness badges everywhere:** every panel shows "Xm ago"; stale = visible, not silent.

### Deploy key — DONE

Wiki submodule (private `trade-analyser_skill`) now has a read-only deploy key;
private half stored as `WIKI_SSH_KEY` GH secret. Workflows use `webfactory/ssh-agent`.

---

## Confirmed Requirements (12 questions answered)

| Decision | Choice |
|---|---|
| CI runner | **Hybrid** — cloud-primary, local-when-possible |
| Claude integration | **Agent SDK** in CI (with skills + MCP) |
| Journal trigger | **Post-close auto 16:30 ET + re-trigger anytime** |
| Daily AI cost cap | **<$5/day** — DeepSeek + Gemini + Claude (skip OpenAI) |
| Post-close sync model | **Local push-to-cloud daemon** for moomoo fills |
| Local runner stack | **Both** — GH self-hosted runner + Task Scheduler watchdog |
| Trading scope | Analysis + alerts + **A-list daily monitoring** + **day-0/day-14 verdicts** + **revamped journal** |
| Alerts | **PushNotification** + **dashboard banner** |
| Equity tracking | **Broker daily total + per-trade attribution** (both) |
| A-list page location | **New top-level nav item** |
| Journal fields | **All** — setup + market context + charts + AI snapshot + notes + wiki links |
| Watchlist sync | **Skip personal — use TV screener output only** |

## Defaults Being Applied (4 unanswered)

| Question | Default | Why |
|---|---|---|
| A-list criteria | Score ≥ 80 + GO verdict + RVOL ≥ 1.5× | Matches your existing Standout picks (JOYY 85, POWI 80, NTAP 82). ~2-4 candidates/day. |
| Day-14 outcome | MFE/MAE excursion + outcome score 0-10 | Matches your existing `audit_trades.py` rubric in `llm_traders_wiki/scripts/`. |
| Wiki sync to cloud | Mirror `llm_traders_wiki/wiki` → `market_dashboard/packages/core-skills/wiki/` via sync script + git hook | Wiki stays authoritative in source repo; mirror is auto-refreshed. |
| Position UX | Personal-only, 5-min refresh when PC online, "stale Xh" badge when off | Privacy preserved; degraded gracefully when PC off. |

---

## Daily Timeline (ET → MYT)

```
05:00 ET / 17:00 MYT │ LOCAL OPENING ROUTINES (when PC on)
                      │ Task Scheduler ensures moomoo OpenD GUI alive
                      │ Push-to-cloud daemon: every 10 min, sync fills+positions to Vercel
                      │
09:00 ET / 21:00 MYT │ PRE-OPEN CLOUD CI (NEW — refresh_premarket.yml)
                      │ ✓ build_data, breadth scan, TV screener fetch
                      │ ✓ index technicals (ATR/RSI/MACD)
                      │ ✓ brief × 3 (Claude Agent SDK / DeepSeek / Gemini)
                      │ ✓ A-list candidates identified + persisted (day-0)
                      │ ✓ Pushed to dashboard 4 tabs
                      │ ✗ OpenAI skipped (cost)
                      │
09:30 ET / 21:30 MYT │ MARKET OPEN
                      │ Local live-quote daemon pushes RVOL/pre-mkt to Vercel
                      │
13:33-16:33 ET       │ INTRADAY LIGHT (existing refresh_data_intraday.yml — 3 ticks)
                      │
16:30 ET / 04:30 MYT │ POST-CLOSE JOURNAL CI (NEW — journal_close.yml)
                      │ Cloud reads moomoo fills from Vercel cache
                      │ For each closed trade today: score + journal entry + chart
                      │ For each A-list aged 14d: MFE/MAE rescore + outcome
                      │
16:33 ET / 04:33 MYT │ BREADTH POST-CLOSE (local dashboard-bridge)
```

---

## Architecture

### Cloud (GitHub Actions + Vercel + Postgres)

**New workflows:**
- `refresh_premarket.yml` — daily 9:03 ET, replaces heavy parts of `refresh_data.yml`. Uses Claude Agent SDK + DeepSeek + Gemini.
- `journal_close.yml` — daily 16:30 ET, post-close journal + day-14 A-list rescore.

**Kept:**
- `refresh_data_intraday.yml` (your 3-tick retiming)
- DB-backed TV screener refresh via Vercel Cron + intraday workflow

**Deprecated:**
- `refresh_data.yml` (split into `refresh_premarket.yml` + `refresh_data_intraday.yml`)
- `refresh_breadth.yml` (moved to local dashboard-bridge once post-close)
- `refresh_portfolio_quotes.yml` / `yahoo_fallback_quotes.yml` (replaced by bridge live quotes)

**New API endpoints:**
- `POST /api/broker-sync/fills` — daemon pushes fills
- `POST /api/broker-sync/positions` — daemon pushes positions
- `GET /api/a-list/today` `/history` — A-list reads
- `POST /api/a-list/promote` — manual override
- `POST /api/journal/auto-generate` — cron-triggered
- `GET /api/journal/entries?filter=...` — paginated journal
- `GET /api/equity/timeline` — daily equity timeline

**New Postgres tables (Prisma):**
```
a_list_candidates: id, ticker, date, setup, entry_zone, stop, target,
                   rrr, score, verdict, rvol, day0_thesis, day0_brief_snapshot_id,
                   day14_outcome, day14_mfe, day14_mae, day14_score, day14_verdict,
                   status, created_at, updated_at

journal_entries: id, trade_date, ticker, side, entry_price, exit_price, qty,
                 pnl_usd, pnl_pct, hold_days, fees, setup_classification,
                 market_context_json, chart_entry_url, chart_exit_url,
                 ai_score, ai_verdict, trader_style_scores_json, lesson_note,
                 wiki_links_json, brief_snapshot_id, broker_fill_id

equity_snapshots: date, total_assets, cash, market_val, unrealized_pl,
                  realized_pl_day, equity_pct_change, source

brief_snapshots: id, bucket_at, provider, structured_json, generated_by
```

### Local (Your PC)

**Self-hosted GH Actions runner** — one-time install as Windows service, tagged `self-hosted, windows, opend`.

**Task Scheduler tasks:**
1. **OpenD watchdog** — every 5 min, ensure `moomoo_OpenD.exe` alive + port 11111 responds. Relaunch if dead.
2. **Live quote daemon** — launches `live_quote_daemon.py` at 21:30 MYT, stops 05:00 MYT (covers US market hours).
3. **Push-to-cloud daemon** — every 10 min, pull moomoo fills + positions, POST to Vercel.

**New scripts:**
- `scripts/local_broker_sync.py`
- `scripts/opend_watchdog.ps1`
- `.github/workflows/refresh_premarket_local_enrich.yml` (uses `runs-on: self-hosted`)

### Frontend (Next.js)

**New pages:**
- `/a-list` — table + filters (date, sector, setup, status, score). Drill into ticker → frozen brief + chart.
- `/journal` — calendar heatmap + filtered list. Each entry: card with charts, market context badges, wiki links, lesson note.
- `/equity` — equity curve + drawdown highlights + per-trade attribution.

**New components:**
- `AListTable.tsx`
- `JournalCard.tsx` (chart embed, mood badge, lesson editor)
- `EquityTimeline.tsx`
- `FailureBanner.tsx` (stale-data + CI-fail alerts)

### Wiki

- Add `scripts/sync-wiki-from-source.sh` in `market_dashboard`
- Pre-commit hook in `llm_traders_wiki`: when `wiki/` changes, auto-rsync to mirror + remind to commit
- One-time copy: `cp -r llm_traders_wiki/wiki market_dashboard/packages/core-skills/wiki/`

### New skill

- `journal-close` — orchestrates post-close journal generation. Pulls fills from cache, calls trade-analyser logic per trade, saves charts, writes entries. Handles A-list day-14 rescore.

---

## Cost Estimate (target <$5/day)

| Component | Provider | Daily |
|---|---|---|
| Pre-open brief | Claude Agent SDK (Sonnet) | $1.50 |
| Pre-open brief | DeepSeek | $0.30 |
| Pre-open brief | Gemini 2.5 Pro | $0.80 |
| A-list scoring (3 candidates × 7 trader-styles) | Claude API | $0.60 |
| Post-close journal (avg 3 trades × full analysis) | Claude API | $0.90 |
| Day-14 rescore (2 rolling avg) | Claude API | $0.20 |
| TV screener scoring (top 10 × 5 screeners) | DeepSeek | $0.50 |
| **Total** | | **~$4.80/day** |

OpenAI ON-DEMAND only (manual trigger if you want fourth opinion).

---

## Failure Modes

| Failure | Graceful behaviour |
|---|---|
| PC off → no OpenD enrichment | Cloud uses yfinance EOD fallback; banner "no live data" |
| Claude SDK quota | Fall back to Anthropic API (same prompt) |
| DeepSeek down | 2 providers instead of 3; tab badge "stale" |
| Gemini grounding rate-limit | Brief still ships; "no overnight news" note |
| TV screener API blocked | Cached screener + staleness warning |
| Breadth yfinance rate-limited | Stooq fallback (script already does this) |
| Local daemon push fails | Cloud journal uses last cached fills + "may be stale" warn |
| Post-close journal fails | PushNotification + dashboard banner; re-trigger button |

---

## Implementation Phases (one PR per phase)

### Phase 1 — A-list backend (1 day)
- Prisma migration: `a_list_candidates` table
- `POST /api/a-list/ingest`, `GET /api/a-list/today`, `GET /api/a-list/history`
- Modify existing brief generation to call ingest after identifying candidates
- **Ship gate:** A-list candidates persist daily; visible via API

### Phase 2 — A-list frontend (1 day)
- `/a-list` page + `AListTable.tsx`
- Filters + drill-in to ticker view
- **Ship gate:** Browse historical A-list candidates in UI

### Phase 3 — Pre-open cloud workflow (2 days)
- `refresh_premarket.yml` with Claude Agent SDK (Node setup)
- Wiki mirror + sync script
- Test SDK in CI with skills
- **Ship gate:** Pre-open runs daily at 9:00 ET, 3 providers populate Conviction Desk

### Phase 4 — Local broker-sync daemon (2 days)
- `local_broker_sync.py` (every 10 min)
- `POST /api/broker-sync/*` endpoints
- `equity_snapshots` table
- Task Scheduler entries (watchdog + daemon)
- **Ship gate:** Fills/positions on dashboard within 10 min of any trade

### Phase 5 — Post-close journal (3 days)
- `journal-close` skill
- `journal_entries` + `brief_snapshots` tables
- `journal_close.yml` workflow
- `/journal` page (calendar + filters + JournalCard)
- Day-14 A-list MFE/MAE rescore
- **Ship gate:** Journal auto-generates post-close; you can browse + edit notes

### Phase 6 — Equity timeline + alerts + polish (2 days)
- `/equity` page
- PushNotification wiring
- `FailureBanner` component
- Self-hosted GH runner installation guide
- **Ship gate:** Full end-to-end working; alerts fire on failures

**Total: ~11 working days, ~2-3 weeks calendar.**

---

## Decision Points After Approval

After you approve this plan:
1. I create GH issue with the 6 phases as subtasks
2. Start Phase 1 (smallest scope, highest leverage)
3. Each phase ends with PR for your review + push
4. Wiki updates as we go (memory + concept pages)

---

## What I Need From You

✅ **Approve as-is** → I start Phase 1 immediately
✏️ **Edit specific items** → I revise this doc, then proceed
❌ **Reject** → We talk about what's wrong
