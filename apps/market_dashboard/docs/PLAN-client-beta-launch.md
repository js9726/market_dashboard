# Plan — Client Beta Launch: Journal Dashboard for Invited Traders

**Owner:** Jie Sheng
**Status:** PLANNED 2026-06-29 (locked decisions below). Supersedes the beta-readiness
parallel track of `PLAN-conviction-decision-grade.md`.
**Goal:** invite real clients to journal + track their trades on the dashboard,
see Jie's trade ideas (entries/stops, never size/P&L), connect their own broker
data, and receive increasingly accurate GO-list alerts.

Do not delete items — strike with `~~text~~` so decision history stays legible.

---

## Locked decisions (Jie, 2026-06-29)

| Topic | Decision |
|---|---|
| Client broker connect | **Tiered**: CSV import + manual first (everyone, day 1); packaged local bridge (moomoo OpenD + IBKR TWS) for power users; cloud aggregator deferred |
| Owner showcase | **Ideas + entries/stops/targets/thesis/trigger/outcome-R — never share count, $ size, or account P&L** |
| Business model | **Free private beta, invite-only** (5–20 traders); billing deferred until product proves |
| Alerts | **Telegram bot + dashboard**: pre-open GO list + intraday ARMED→TRIGGERED pushes; one shared broadcast channel first, per-user DMs later |
| Hard line | **No auto-execution / copy-trading, ever** — ideas are educational; disclaimer gates the showcase |

---

## A. Where the product stands (2026-06-29 audit)

**Client-ready today (verified this session):**
- Multi-tenant isolation done right: `access.ts` scopes every personal read/write to the caller; shared plane (brief, screeners, A-list REC, breadth, internals) serves all signed-in users.
- Roles owner/member/pending/denied; Google OAuth published; middleware split public/machine/session paths.
- Journal core: TradeRecord lifecycle, manual entry, CSV import, auto-journal, digests, coaching digest, analytics, equity timeline, calendar.
- A-list rebuilt (P1–P5): pullback lane live, MFE/MAE tracked from broker-authoritative bars, Active/Closed boards + scoreboard, entry/exit market context, calibration loop.
- Per-user `BrokerBridgeToken` already in schema — bridge multi-user plumbing exists.

**Gaps blocking clients (honest):**
1. No owner-showcase surface — deliberately removed at multi-tenancy; must be rebuilt as a whitelisted projection.
2. Fresh-member experience unverified: empty states, onboarding, "how to journal" docs.
3. No legal/disclaimer page (required before sharing trade ideas).
4. Broker-journal feature flag off in prod; admin member-book/approval flow unpolished.
5. Bridge is operator-grade (manual config, no installer); IBKR bridge has no scheduled task.
6. Triggers evaluated once daily (post-close) — "intraday trigger alert" needs an intraday evaluation tick.
7. Screener Sentiment/10 is hardcoded `6` — regime never actually moves the score (accuracy lever).
8. Earnings-proximity rule ("7+ days away", wiki) not enforced in the screener (accuracy lever).
9. No error observability (Sentry or equivalent).

---

## B. Phases

### Phase 0 — Beta-ready core (week 1) → *invite the first 5 after this*
- **0.1 Fresh-member pass:** walk every page as a brand-new member; fix empty states (Trades Hub, A-list personal lanes, Equity, Analytics) so zero-data renders helpfully, each with a "start here" CTA.
- **0.2 Onboarding:** polish pending→member approval (admin member-book page: list, approve, deny, revoke); welcome page after approval; "How to journal" docs page (manual + CSV, with moomoo/IBKR export screenshots).
- **0.3 Legal & trust:** disclaimer page (educational ideas, not financial advice; no performance guarantee), privacy note (data isolation statement), accept-once gate before the Ideas tab.
- **0.4 Prod flags & health:** enable broker-journal flag in prod; verify reset-quotas + all crons green; add Sentry (or minimal error capture) to API routes.
- **Acceptance:** a stranger with a Google account can be approved, journal a manual trade, import a CSV, and see their own analytics — with zero owner data visible and no blank screens.

### Phase 1 — Owner Showcase: "Jie's Ideas" (week 2) → *the hook*
- **1.1 Data projection:** `serializeIdeaShare(candidate)` — whitelist ONLY: ticker, setup, entry zone, stop, target, RRR, thesis, conviction breakdown, champion persona, trigger state/time, day-14 MFE/MAE (R), outcome, "Jie entered ✓" boolean (from isHeld — NO qty/$), pick + close dates. Explicit field whitelist so a schema addition can never leak.
- **1.2 Ideas tab (shared plane):** live board of owner REC picks + entered-flag; Closed/Review section with outcome R; the existing scoreboard filtered to shared ideas = public R-based track record.
- **1.3 Follow loop:** member clicks "Watch" → creates THEIR A-list WATCH row (provenance `ideaId`); "I took this" → prefilled journal entry linked to the idea. Enables cohort analytics later ("followers of idea X averaged +0.6R").
- **1.4 Owner controls:** share-all-REC default with per-pick unshare; optional delayed reveal (share after my entry day closes).
- **Acceptance:** member sees today's ideas with entry/stop/thesis + your track record; nothing reveals size or P&L (verified by grepping the API payload).

### Phase 2 — Client broker tier (week 3)
- **2.1 CSV polish:** import mappers for moomoo and IBKR statement exports; dedupe on brokerFillId; per-user auto-journal from imported fills (generalize the owner path); docs.
- **2.2 Packaged bridge (power users):** config wizard (`python -m bridge setup`: paste token, pick broker, test connection); Windows scheduled-task installers for BOTH daemons (moomoo has one; IBKR doesn't); Settings→Brokers heartbeat card ("bridge last seen 2m ago") from `BrokerBridgeToken.lastHeartbeat`; per-user ingest rate limit.
- **2.3 Honest realtime labeling:** bridge = near-realtime (poll interval), CSV = as-of-import; the UI must say which.
- **Acceptance:** a member imports a moomoo CSV and sees positions/journal; a power user runs the bridge and their portfolio updates unattended.

### Phase 3 — Telegram alerts (weeks 3–4, parallel)
- **3.1 Broadcast bot:** channel receives (a) pre-open GO list after brief ingest (ticker, setup, entry/stop, conviction), (b) intraday ARMED→TRIGGERED alerts.
- **3.2 Intraday trigger tick (prereq for 3.1b):** evaluate triggers on live quotes vs pivot levels at the existing intraday cron cadence (6×/day) — approximation of the daily-bar state machine, marked `intraday-provisional`, confirmed by the post-close run.
- **3.3 Per-user DMs (3b, later):** link Telegram via code in Settings; personal alerts (your held stop breaches) — owner first, members after.
- **Quality bar:** GO≥75 or trigger events only; hard daily cap; no spam.

### Phase 4 — Wiki → GO-list accuracy loop (continuous; wiki-first per anti-reversion)
1. **Measure (forward validation):** tag every candidate with `scorerVersion`; nightly cohort stats per version × lane (GO vs WATCH hit-rate, avg MFE/MAE R) so each calibration is A/B-measurable against its predecessor. Revert rule: forward win-rate degrades over n≥15 → roll back the calibration.
2. **Wire real Sentiment/10:** replace the hardcoded 6 with regime from P4 sources (breadth advance/decline + F&G + SPY vs MAs), doctrine documented in the wiki first (`trader-styles.md` sentiment rubric). Expected: fewer GO alerts in risk-off tape = higher precision.
3. **Enforce the earnings gate:** screener drops/flags candidates with earnings <7 days (wiki rule already; runtime missing). Needs an earnings-date source (Yahoo calendar via existing fetch).
4. **Theme/20 upgrade:** blend industry breadth (MarketBreadthSnapshot industries WoW) into theme scoring instead of Perf.1M+mcap only.
5. **Wiki content:** add the missing MFE/MAE concept page; add a market-regime alert-gating page; keep the Calibration log (started 2026-06-26 with EP-FRESH) as the single history.
6. **skills:sync** after each wiki doctrine change so LLM scorers match the deterministic gate (unblocked — ticker-catalyst WIP shipped).
7. **Cadence:** weekly calibration review (coaching digest surfaces the top leak → one small reversible calibration → log → measure).

---

## C. Sequence & effort

| Week | Ship | Outcome |
|---|---|---|
| 1 | Phase 0 | First 5 invites go out |
| 2 | Phase 1 | Clients see Jie's ideas + track record — the retention hook |
| 3 | Phase 2 + 3.1/3.2 | Broker data flowing; Telegram GO channel live |
| 4 | Phase 3.3 + Phase 4 items 1–3 | Personal alerts; sentiment + earnings gates raising GO precision |
| ongoing | Phase 4 loop | Weekly measured calibrations |

**Explicitly out of scope:** billing/Stripe (until beta converts), cloud broker aggregator (until demand), auto-execution/copy-trading (never), public signup (invite-only).

**Validation discipline:** every phase validated on the live page via the browser loop (`wiki/projects/dashboard-validation-loop.md`) — build → deploy → Chrome-validate → fix; a phase is done only when a fresh member account passes its acceptance line.
