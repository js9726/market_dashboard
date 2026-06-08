# Market Desk + JS Trade Journal — Roadmap

Living document for features beyond the current production state. Authored
2026-05-19 from the [composed-giraffe plan](../../../../.claude/plans/fetch-this-design-file-composed-giraffe.md).
Update freely; do not delete old items — strike them with `~~text~~` so the
history of decisions stays legible.

---

## Source design system

Two surfaces, one token system. Pick mode by `data-mode="dark|light"` on the
root.

| Surface | Mode | Job |
|---|---|---|
| **Market Desk** | Dark | Live "what's happening right now" overview — indices, sectors, breadth, hot rotations, macro. |
| **JS Trade Journal** | Light | Logging, reviewing, and learning — trades, daily journal, calendar, analytics, replay. |

Brand: **JS Trade Journal** (the "TWI" labelling visible in legacy mockups is
out of date — rebrand each surface as it's touched). Logos: `logo-js-wordmark.svg`,
`logo-js-mark.svg`, `logo-market-desk.svg`. Not interchangeable across modes.

**Tier palette** (Leaderboard only):
Legend gold · Masters red · Diamond cyan · Platinum violet · Gold yellow ·
Silver slate · Bronze amber.

---

## Order of work (do top-down)

1. **Feature 9 — Design system adoption** ⛔ blocked on asset files
2. Feature 2 — Theme Radar
3. Feature 3 — RVOL Overview table
4. Feature 1 — Rotation Graph (RRG)
5. Feature 8 + Feature 5 — Profile fields + Leaderboard (share a User migration)
6. Feature 7 — Journal mood / sleep / attachments
7. Feature 4 — Multi-agent analysis UI (biggest backend change; do last)

Feature 6 (theme variants picker) is **dropped** — folded into Feature 9 as a
route-based `data-mode` auto-binding. No user-facing theme picker; surfaces
are visually fixed by route.

---

## Feature 9 — Design system adoption

**Brand:** JS Trade Journal.

**Includes:**
- Commit `colors_and_type.css`, `assets/icons.svg`, `assets/logo-js-{wordmark,mark}.svg`, `assets/logo-market-desk.svg` into `apps/market_dashboard/public/design-system/`.
- Wire `data-mode` attribute on `<body>` driven by route: Journal-family routes (`/dashboard/journal`, `/dashboard/analytics`, `/dashboard/replay`) → `light`. Everything else (Market Desk root, scanner, chat, settings, admin) → `dark`.
- Migrate hardcoded Tailwind colours to CSS tokens.
- Add Inter + JetBrains Mono via `next/font/google`.
- Add `font-variant-numeric: tabular-nums` to all numeric Tailwind utilities.
- Apply 11-px uppercase accent overline pattern (`t-overline` class) above every existing card section.
- Replace any decorative emoji in non-Journal components with icon-sprite references (`<use href="/design-system/icons.svg#i-trades">`). Mood-picker emoji on the Journal entry form stay.
- Add number-formatting helpers in `src/utils/format.ts`: `formatUsd`, `formatPct` (with sign), `formatR` (one decimal), `formatTicker`, `formatVolume` (K/M/B), `formatTime24h`, `formatDate`.
- Rebrand "TWI" → "JS Trade Journal" everywhere it appears during component migration.

**Complexity:** High — touches every visible surface.

**Reuse:** All existing components keep their layout; only colour/font/spacing tokens swap. Tailwind config gains the token CSS vars as theme extension.

**Blocked by:** Asset files. Save them to `apps/market_dashboard/public/design-system/source/` (or another agreed folder) and Feature 9 unblocks.

---

## Feature 1 — Sector/Industry Rotation Graph (RRG)

**Complexity:** Medium. **Reuse:** ~60%.

**Reuse:**
- `src/components/market/MarketOverview.tsx` — Recharts patterns, data loading.
- `src/components/journal/EquityCurve.tsx` — `LineChart` + `ResponsiveContainer`.
- `src/types/market-dashboard.ts` — `TickerRow` shape; extend with `rrg_quadrant`.

**Net-new:**
- `components/market/RrgQuadrantChart.tsx` — quadrant scatter with bubbles, momentum (Y) vs RS (X).
- Extend `build_data.py` to compute 14-day sector momentum scores.
- Extend `snapshot.json` with sector-level quadrant classification.

**Data dependency:** `snapshot.json` (RS already present) + new sector-momentum computation.

---

## Feature 2 — Theme Radar

**Complexity:** Low. **Reuse:** ~70%.

**Reuse:**
- `src/components/journal/TradeLog.tsx` — table + row grouping.
- Colour utilities from `MarketOverview.tsx` (`cellClass`).
- `snapshot.json` daily/intra/5d/20d fields.

**Net-new:**
- `components/market/ThemeRadarTable.tsx` — three action-signal sections (Breakout/Heating, Accumulate, Watch for Exit/Cooling).
- `apps/market_dashboard_backend/scripts/themes.json` — ticker→theme mapping (new file).
- Theme → action-signal classifier (RVOL + RS + daily % rule).

**Data dependency:** `snapshot.json` + new theme taxonomy file.

---

## Feature 3 — RVOL Overview table

**Complexity:** Medium. **Reuse:** ~65%.

**Reuse:**
- `src/components/journal/TradeLog.tsx` — table layout, sort, filter.
- `src/components/journal/EquityCurve.tsx` — 1-month sparkline pattern.
- `MarketOverview.tsx` — `cellClass` gradient colouring.

**Net-new:**
- `components/market/RvolOverviewTable.tsx` — colour cells, sparkline columns.
- Extend `build_data.py` to compute RVOL (volume / SMA-volume) and 52W-high %.

**Data dependency:** `snapshot.json` + new RVOL/52W computation in Python.

---

## Feature 4 — Multi-agent analysis UI

**Complexity:** High. **Reuse:** ~50%.

**Reuse:**
- `apps/market_dashboard/agents/fundamental/capability.ts` — agent pattern.
- `apps/market_dashboard/agents/technical/capability.ts` — same.
- `src/app/api/analysis/route.ts` — POST handler + auth.
- `src/types/agent.ts` — `AgentState`, `AgentMessage` types.
- `prisma/schema.prisma:ScanResult.agents Json` already stores per-agent results.
- `prisma/schema.prisma:TradeVerdictHistory.style` already supports `"agent-pipeline"`.

**Net-new:**
- 5 new agents: `agents/{data,news,chart,historical,risk,moderator}/capability.ts` (technical + fundamental already exist → 7 total).
- Extend `AgentState` with per-agent result cache.
- `components/analysis/MultiAgentAnalysisCard.tsx` — accordion per agent.
- Update `/api/analysis/route.ts` to orchestrate the 7-agent pipeline sequentially.

**Data dependency:** yfinance (Data agent), web search (News agent), existing technical indicators.

---

## Feature 5 — Leaderboard + public profile

**Complexity:** Medium. **Reuse:** ~75%.

**Reuse:**
- `prisma/schema.prisma:User` model.
- `src/app/admin/page.tsx` — user-listing pattern.
- `src/components/journal/StatsCards.tsx` — card layout.

**Net-new:**
- **User migration:** add `username` (unique), `tier` (enum: `legend`/`masters`/`diamond`/`platinum`/`gold`/`silver`/`bronze`), `publicProfileEnabled` boolean, `bio` text.
- Composite score computation: weight **consistency + drawdown + win-rate above raw P&L** (per design README §1). Cron task computes nightly.
- New routes: `src/app/dashboard/profile/[username]/page.tsx` (public, add to middleware allow-list), `/api/leaderboard`.
- `components/profile/LeaderboardTable.tsx` — sorted by composite score, coloured by tier.

**Data dependency:** Prisma (Trade verdicts) for aggregation.

---

## ~~Feature 6 — Theme styles in Settings~~

**DROPPED.** Replaced by route-based `data-mode` auto-binding in Feature 9.
The original screenshot (`Profile setting 2.png`) showed seven theme variants
(Solid/Gradient/Holographic/Neon/Sunset/Ocean/Aurora) + accent-colour picker.
This contradicts the design system's prohibition on inventing colours and on
glassmorphism/gradients (README §3). Decision logged 2026-05-19.

---

## Feature 7 — Journal mood / sleep / attachments

**Complexity:** Low. **Reuse:** ~85%.

**Reuse:**
- `src/components/journal/AddTradeModal.tsx` — form pattern.
- `src/app/api/journal/trades/add/route.ts` — existing POST handler.

**Net-new:**
- **Trade migration:** add `moodEmoji` (single char), `sleepHours` (decimal 0–12), `marketConditions` (enum/text), `attachmentUrls` (json array, max 5).
- `components/journal/MoodEmojiPicker.tsx` — 5-button selector.
- Extend `AddTradeModal` with new fields + file upload.

**Storage:** **Vercel Blob** (decision locked in 2026-05-19). Add `BLOB_READ_WRITE_TOKEN` to env table. Max 5 attachments × ~5 MB per entry per the screenshot. Use `@vercel/blob` SDK with signed-URL pattern.

**Data dependency:** Prisma `Trade` model + Vercel Blob.

---

## Feature 8 — Profile fields (username / tagline / bio)

**Complexity:** Low. **Reuse:** ~85%.

**Reuse:**
- `prisma/schema.prisma:User` already has `name`, `email`, `image`.
- `AddTradeModal.tsx` form patterns.

**Net-new:**
- **User migration:** add `dashboardTagline` (≤60 chars), profile fields not covered by Feature 5 (`bio`, `username` come from there).
- `components/profile/ProfileEditForm.tsx` — form with length validation; username `@handle` format check.
- `/api/user/profile` — PATCH.
- Profile picture upload via Vercel Blob (square, max 2 MB).

**Data dependency:** Prisma `User` model + Vercel Blob.

---

## Refactor backlog (not features)

### P-1 — Extract `scripts/_common.py`

Move `sanitize_json`, `safe_json_dumps`, `_load_env`, ticker normalization,
retry helper into one shared module. Today they live in `build_data.py` and
are imported across-script (works, but couples breadth_scan / trader_verdict /
tv_screener_fetch to build_data import-side-effects).

### P-2 — CLI rate/retry flags on Python scripts

Add `--rate-limit`, `--retry-attempts`, `--retry-backoff` to build_data,
breadth_scan, morning_brief, tv_screener_fetch. Currently hardcoded.

### P-3 — Extract `requireIngestKey(req)` helper

Four routes (`watchlist/export`, `live-quotes/ingest`, `morning-verdict/ingest`,
`trades/import`) implement nearly identical Bearer-token checks. DRY them.

### P-4 — Document ingest-key routing in CLAUDE.md §5

Today `BRIEF_INGEST_KEY`, `LIVE_QUOTE_INGEST_KEY`, `CRON_SECRET` are scattered
across routes without a map. Add a "which route uses which secret" sub-table.

### P-5 — Type hints across Python scripts

`build_data.py`, `breadth_scan.py`, `morning_brief.py`, `trader_verdict.py`,
`tv_screener_fetch.py`, and the `packages/dashboard-bridge/bridge/` modules -
add return-type annotations on public functions. Low-risk but ~150 line-touches;
best done alongside P-1.

### P-6 — Fix chart URL path in build_data.py

[build_data.py:358](../../market_dashboard_backend/scripts/build_data.py#L358)
returns a hardcoded `data/charts/{safe}.png` regardless of `--out-dir`. Causes
stale chart URLs when output dir is non-default. Coordinate with the frontend
URL composition before changing (likely also touches `npm run sync:market`).

---

## Audit findings dropped during the composed-giraffe plan execution

These were flagged by the initial audit but verified as non-issues:

- **B2** — `build_data.py:268,299,306` does not need explicit `.item()`. `sanitize_json` already calls `.item()` on numpy scalars internally ([build_data.py:191](../../market_dashboard_backend/scripts/build_data.py#L191)).
- **B4** — `breadth_scan.py:132,144` — `datetime.timezone.utc` works correctly. `import datetime` at [line 44](../../market_dashboard_backend/scripts/breadth_scan.py#L44) makes the full `datetime.timezone.utc` path available; not "by accident".
- **B6** — `morning_brief.py` OpenAI/Claude blocks don't need `resp.raise_for_status()`. They use SDK clients (`openai.OpenAI.responses.create`, `anthropic.Anthropic.beta.messages.create`) which raise on HTTP errors automatically — only Gemini uses raw `requests.post` and it already has the check.
- **B10** — `trader_verdict.py:466,473` — `_source` field is not dead; it's read at [line 481](../../market_dashboard_backend/scripts/trader_verdict.py#L481) to print provenance.
- **B12** - The old `live_quote_daemon.py` env-loader concern is obsolete; live quotes now flow through `packages/dashboard-bridge`.
- **LRN-005** — `journal/sync/route.ts` no longer has a cookie-race; current code captures `userId` + `connectionId` synchronously at [lines 98-99](../../src/app/api/journal/sync/route.ts#L98) before `after()`.

---

## Open questions

- Final asset folder: `apps/market_dashboard/public/design-system/source/` vs a top-level `design-system-source/`? Pick once Feature 9 starts.
- For Feature 4 multi-agent UI: should pipeline run **sequential** (cheaper, slower) or **parallel with moderator gate** (faster, costlier)?
- For Feature 5 composite score: exact weights (consistency vs drawdown vs win-rate vs PnL). Pick before nightly cron lands.
