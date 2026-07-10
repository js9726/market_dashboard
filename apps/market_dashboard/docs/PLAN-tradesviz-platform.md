# Plan — TradesViz-Class Trading Platform (US + Bursa Malaysia)

**Owner:** Jie Sheng
**Status:** AUDIT + PLAN for approval, 2026-07-10. **No code until Jie approves.**
**Origin:** Codex handover brief (10-pillar audit vs TradesViz/TraderSync-Cypher; audit-first) + Jie's decisions 2026-07-10: Bursa = journal+analytics first; all 4 pillars (analytics, chart-trades, playbooks, AI coach) in scope; **two-surface IA (Journal home + Market Desk)**.
**Supersedes:** absorbs `PLAN-client-beta-launch.md` Phases 1–4 (still valid, re-sequenced here) and revives `ROADMAP.md`'s two-surface concept.

North star: **TradesViz** (journal/analytics depth, chart-visualized trades, pivot analysis, custom dashboards) + **TraderSync Cypher** (AI coach roles) — fused with what those products DON'T have: Jie's Conviction/wiki engine, A-list ideas, and the owner-showcase.

---

## A. Gap matrix (audited 2026-07-10)

Severity: 🟢 solid · 🟡 partial · 🔴 missing.

| # | Pillar | Status | What exists (files) | Missing for TradesViz-class |
|---|---|---|---|---|
| 1 | **Journal core** | 🟡 | TradeRecord lifecycle + fills + `strategy` + notes; TradeLog w/ AI-review modal + catalyst sections; trade detail `/journal/trades/[id]`; DailyReflection (mood/sleep/conditions) + DailyJournal + digest | **tags[] on trades**, **screenshots/attachments**, mistake-classification field, saved views/filters on the trades table, plan-vs-execution comparison on detail page |
| 2 | **Broker/import** | 🟢 | Manual (+Close w/ user qty/price/date), CSV ×4 formats w/ preview+dedupe+instant reconcile, Sheet sync, moomoo/IBKR bridges (per-user tokens), multi-account, fees presets, freshness labels (live/stale/asOf) | MY broker CSVs (Rakuten Trade, moomoo-MY variants), partial-exit edge QA, per-import undo |
| 3 | **Analytics** | 🟡 | journal/stats (winRate/PF/expectancy), coaching digest (edge×execution), Conviction analytics, equity curve + drawdown | **Pivot-grid** (group by ANY field → chart), **custom dashboards/saved layouts**, MFE/MAE distributions for JOURNAL trades (exists for A-list only), time-of-day/day-of-week/holding-period/regime breakdowns, report export |
| 4 | **Calendar/day explore** | 🟡 | CalendarView (P&L calendar) | Click-day drilldown (trades + market context + reflection + lessons in one panel), grade/mistake badges on days |
| 5 | **AI coach** | 🟡 | Trade-analyser (wiki-aware, persisted verdicts), coaching digest, AI chat (generic ticker) | **NL Q&A over YOUR journal data** ("why do I lose on Fridays?") via safe SQL/aggregation tools; Cypher-style roles (performance analyst / risk coach / pattern detector / accountability); insights persisted to schema not chat-only |
| 6 | **Planning/playbooks** | 🔴 | `/playbooks` is a **placeholder**; wiki setups exist as scoring knowledge; proposedSL/TP on manual trades | Playbook entities (rules/checklists per setup), pre-trade checklist flow, planned-vs-actual grading, rule-adherence tracking |
| 7 | **Desk/A-list integration** | 🟢 | Conviction Desk, A-list w/ triggers+MFE/MAE+scoreboard, fail-closed freshness, morning brief | Idea→journal loop ("I took this" provenance) — was client-beta Phase 1, folds into P1 here |
| 8 | **Replay/simulator** | 🔴 | `/replay` placeholder; BrokerDailyBar table (OpenD bars) exists as the data seed | Chart-visualized trades FIRST (candles + entry/exit/stop markers per trade — TradesViz signature), replay later. Per Codex brief: don't overbuild before analytics solid |
| 9 | **Alerts/goals** | 🔴 | FailureBanner (system health), planned Telegram GO channel | Goals tracker (P&L/drawdown/process), user alerts (daily-loss, overtrade, idea-triggered, bridge-stale) |
| 10 | **Beta/privacy** | 🟢 | Multi-tenant isolation (validated w/ minted member), disclaimer gate, admin member-book, guide, empty states | Owner-showcase whitelist projection (client-beta P1), Sentry DSN |
| 11 | **Bursa Malaysia** (Jie 2026-07-10) | 🔴 | Symbol format extensible (`US.`/`HK.`/`SG.` mapped); moomoo-MY CSV parses; multi-currency fields exist | **`MY.` → `.KL` mapping absent** (symbol-format.ts), Bursa fee/lot presets (100-share board lots, stamp duty/clearing), Rakuten Trade CSV, MYR display aggregation, .KL quote coverage in refresh-quotes |
| 12 | **Two-surface IA** (Jie 2026-07-10) | 🔴 | Single dark desk-first shell; journal pages scattered under it | **Journal home** (light surface, client landing) + **Market Desk** as second surface; meaningful route groups `/journal/*` vs `/markets/*`; rebrand per ROADMAP tokens |

## B. Loopholes list (correctness/privacy/UX found in audit)

1. **Codex's 2026-07-10 doctrine work is uncommitted** in the shared tree (analysis/stock route, TradeLog, scorer handler, evals) — must land before multi-file refactors (collision + loss risk).
2. `symbol-format.ts` silently passes unknown prefixes through — a `MY.1155` position would fetch a wrong/US symbol from Yahoo (bad quotes, no error). Fail-closed needed.
3. Trades-table P&L for non-USD (`MYR not converted` tooltip) is honest but aggregate stats mix currencies — Bursa work must fix display-currency math before MY clients.
4. AI outputs persist for trade reviews ✓ but chat-AI answers are ephemeral — violates Codex-brief rule "AI output must persist through dashboard schemas" for the coach.
5. `/playbooks` + `/replay` are dead-end nav items for clients today (placeholder pages in client-visible nav).
6. Owner-showcase not yet whitelist-projected (client-beta P1 未 built) — REC lane serialization currently reuses full `serializeCandidate`; fields like `savings.saveRealizedUsd` are $-denominated (leak-adjacent; REC rows are hypothetical-R so tolerable, but the whitelist must land before "Jie entered ✓" ships).
7. Test smoke account (`beta-tester@dashboard.test`) visible in admin list — fine, but document it.

## C. Phased plan (approval gates; each phase = board rows + acceptance + validation)

**Workstream key:** 🄲 = Codex, 🄺 = Claude, split rows note both. Sequence: P0 → (P1 ∥ P1.5) → P2 → P3 → (P4 ∥ P5 polish). Every phase validated per `wiki/projects/dashboard-validation-loop.md` (build → deploy → minted-member browser/API probe → fix), and schema/scoring doctrine stays wiki-first.

### P0 — Unblock & holes (≤1 day)
- 🄲 Commit + push the uncommitted doctrine tree (their own work) — *first, before anything else*.
- 🄺 `symbol-format.ts`: add `MY.` ↔ `.KL` both directions + fail-closed unknown-prefix warning; refresh-quotes covers `.KL`.
- 🄺 Schema (one migration): `TradeRecord.tags Json?`, `screenshots Json?` (URL list), `mistakes Json?`; `Playbook` + `Goal` tables (empty-shipped for P1/P4).
- 🄺 Nav: hide `/playbooks` `/replay` placeholders from member nav until real.
- **Accept:** tree clean; `MY.1155` round-trips to `1155.KL`; migration applied; `npx tsc --noEmit` + build green.

### P1 — Journal excellence + two-surface IA skeleton (week 1)
- 🄺 Route/IA restructure: `/journal` home (light `data-mode`, client landing after login) with dashboard cards (today, week P&L, open positions, streaks); desk family under `/markets/*` (redirects from old routes); nav split per ROADMAP two-surface tokens.
- 🄲 Trade detail page to TradesViz grade: tags editor, screenshot upload (Vercel Blob or URL-paste v1), mistake classification picker, plan-vs-actual block (proposedSL/TP vs fills), AI-review + verdict history (exists) unified.
- 🄲 Trades table: saved filters/views, tag/strategy filters, column chooser.
- 🄺 Idea→journal loop (absorbed client-beta P1): showcase whitelist projection + "Jie entered ✓" + Watch/"I took this" provenance.
- **Accept:** minted member lands on `/journal`, tags+screenshot a trade, saves a view; showcase payload grep shows zero size/$ fields.

### P1.5 — Bursa journal support (∥ P1, week 1–2)
- 🄲 Bursa broker presets (fees: brokerage/stamp/clearing; 100-lot), Rakuten Trade + moomoo-MY CSV formats (Jie supplies sample exports), MY. tickers in manual form.
- 🄺 Display-currency: per-account currency truth + MYR/USD toggle for aggregate stats (single FX source, stamped).
- **Accept:** member imports a Rakuten CSV, sees MYR positions with .KL quotes at the gentle cadence, stats aggregate correctly in chosen display currency.

### P2 — Analytics: pivot, calendar, chart-trades (week 2–3)
- 🄺 Aggregation API: `/api/analytics/pivot` — group journal trades by any field (setup/tag/ticker/dow/tod/holding-bucket/regime/broker/currency) × metric (count/winRate/PF/expectancy/avgR/MFE-capture); server-side, user-scoped.
- 🄲 Pivot UI: group-by picker + chart/table render + **saved layouts** (`DashboardLayout` table) = custom dashboards v1.
- 🄲 Calendar upgrade: day-click drilldown panel (trades, reflection, market context from day0Market, lessons).
- 🄺 Chart-visualized trades: `/api/trades/[id]/bars` (BrokerDailyBar→Yahoo fallback window) + lightweight-charts component with entry/exit/stop markers on detail page + calendar drilldown.
- **Accept:** "expectancy by day-of-week" renders in 2 clicks and saves as a layout; every closed trade shows a marked candlestick chart.

### P3 — AI coach over the journal (week 3–4)
- 🄺 Tooled coach endpoint: LLM + safe aggregation tools (the P2 pivot API + stats + digest) over the CALLER's data only; Cypher-style modes (performance analyst / risk coach / pattern detector / accountability); every answer persisted (`CoachInsight` table: question, answer, evidence JSON, mode) and surfaced on `/journal` home ("this week's insight").
- 🄲 Coach UI on Journal home + insight history page.
- **Accept:** "why do I lose on Fridays?" returns a data-grounded answer citing the member's own numbers; insight row persisted; zero cross-tenant reads (probe-verified).
- Cost guard: reuses `dailyScans` quota.

### P4 — Alerts, goals, Telegram (week 4–5)
- 🄺 Telegram GO channel + intraday trigger tick (client-beta P3, unchanged scope).
- 🄲 Goals (P&L/drawdown/process targets w/ progress on Journal home) + user alerts (daily-loss breach, overtrading count, bridge-stale, idea-triggered) via dashboard + Telegram DM.
- **Accept:** a triggered A-list idea and a daily-loss breach both notify within the tick cadence; goals render with live progress.

### P5 — Replay v1 + client hardening (week 5+)
- 🄲 Replay MVP: bar-by-bar step-through of a closed trade's chart ("what would I do now?"), journaling the answer — only after P2 charts exist.
- 🄺 Beta hardening: Sentry (needs DSN), rate limits, onboarding polish for MY clients, brand pass (JS Trade Journal light / Market Desk dark per ROADMAP tokens).

**Explicitly deferred:** Bursa ideas-desk (screeners/breadth/GO for KLSE) = post-P5 phase; options/futures asset classes; public signup; auto-execution (never).

## D. Distribution & protocol

On approval: each phase gets PLANNED rows on `jie_wiki/wiki/agents/board.md` with the 🄲/🄺 split above; Codex starts at **P0 (commit own tree) → P1 trade-detail/table** while Claude does P0 schema/symbols → P1 IA/routes. Cross-review per protocol at each DONE. Conflicts: any same-file work is sequenced through the board before starting. Scoring/doctrine changes remain wiki-first + `skills:sync`.

## E. Validation commands (per phase, minimum)

`npx tsc --noEmit` · `npm run build` · `npm run eval:trading-brief` (≥5/5) · `npm run skills:check` · minted-member probe script (pages 200, personal APIs scoped, leak-grep on showcase payload) · Chrome pass on changed surfaces · `prisma migrate deploy` clean on prod.
