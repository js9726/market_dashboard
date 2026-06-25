# Plan — Conviction Decision-Grade A-List (R3–R5)

**Owner:** Jie Sheng
**Status:** R3–R5 SHIPPED 2026-06-16/17. R3 (gate→GO≥75 + Conviction breakdown
+ trigger lifecycle + UI), R4 (multi-agent Conviction verdict on triggered
picks), R5 (coaching digest) all live on main + migrations applied. R3.0
backtest → ship-and-forward-validate (data walled; the trigger engine is the
forward-validation instrument). Remaining: beta-readiness parallel track.
**Supersedes the A-list/scoring portions of:** `PLAN-pre-open-ci-and-journal-revamp.md` (Rev 3)

Re-planned after the 2026-06-15 wiki + screener overhaul to the **Conviction
Scoring Model**. Do not delete items — strike with `~~text~~` so the decision
history stays legible.

---

## What changed (premise of the re-plan)

The 2026-06-15 wiki overhaul already did ~40% of the original R3:
- **Conviction Score** is the headline: Setup/40 + Entry/30 + Theme/20 + Sentiment/10; **GO ≥ 75 / WATCH 50–74 / PASS < 50** (`wiki/trader-styles.md`).
- The **7 personas are no longer averaged** — they feed the Setup score + act as a "style fingerprint."
- **Per-setup entry triggers** are now defined (`wiki/entry-methods.md`).
- The deterministic screener scorer (`src/server/screener-scanner.ts`) is already Conviction-aligned.

**Runtime gaps found:**
1. `a-list-extractor.ts` gate still hardcodes `MIN_SCORE = 80` → drops GO picks scoring 75–79.
2. Conviction sub-scores (Setup/Entry/Theme/Sentiment) are computed but **not stored** on `AListCandidate`.
3. `/api/analysis/multi-agent` is the OLD generic 7-agent pipeline with News/Chart/Historical **stubs** + a generic bullish/bearish Moderator — misaligned with Conviction (scores a TWLO-style pullback as weakness).

---

## Locked decisions (Jie, 2026-06-16)

| Topic | Decision |
|---|---|
| R3 focus | **Both, triggers first** — trigger lifecycle as headline + surface the Conviction breakdown |
| A-list bar | **Align to wiki: GO ≥ 75** (drop the 80 hardcode), keep the RVOL gate |
| R4 multi-agent | **Rebuild** to Conviction-weighted agents; Entry scored via the 4 TraderLion early-entry methods; **runs only on TRIGGERED picks** |
| Det vs LLM | **Screener = daily wide net (free); multi-agent LLM Conviction = deep confirm only when a trigger fires** |
| R5 analytics | **Edge + execution in one weekly coaching digest** |
| Scope | **Multi-tenant from the start** (two-plane) |
| Anti-reversion | New trigger/scoring thresholds land in the **wiki first**, then `npm run skills:sync` |

---

## Multi-tenant two-plane model

- **Shared (computed once):** screener Conviction scores + each ticker's **trigger lifecycle** — both from shared OHLC/RVOL/EMA market data, identical for everyone.
- **Per-user:** A-list membership, HELD positions, taken trades, analytics/digest. *Triggers are a shared signal; whether you acted is personal.*

---

## R3 — Trigger lifecycle + Conviction surface

**R3.0 — Backtest checkpoint (GATE, Jie sign-off before any trigger code ships).**
Run the proposed trigger rules + GO≥75 gate over existing A-list/journal history; show what would have been admitted / triggered / invalidated / expired vs actual day-14 outcomes. Honest about data limits (e.g. EP opening-range-high needs intraday; daily-bar proxy only).

**R3.1 — Gate + storage.** A-list REC bar → GO≥75; schema migration to store Setup/Entry/Theme/Sentiment + champion persona on `AListCandidate`.

**R3.2 — Trigger engine (shared, market-wide).** Per-setup state machine (`wiki/entry-methods.md`):
- `BO-CB/BO-VCP`: ARMED → TRIGGERED on day-2+ higher-low then pivot break on volume expansion; INVALIDATED on breakdown / no higher-low.
- `EP-FRESH`: ARMED → TRIGGERED on opening-range-high break; INVALIDATED if it can't hold the range (ONTO case).
- `PB-21EMA/POST-GAP-VCP`: WATCH → TRIGGERED on 8/10-EMA reclaim with volume expansion; INVALIDATED on high-volume pullback / close below 21-EMA.
- EXPIRED if no trigger inside the R2 validity window.

**R3.3 — Surface.** A-list TRIGGER column (state + time) + Conviction bars + champion persona.

---

## R4 — Multi-agent Conviction (rebuilt, triggered-only)

Conviction-component agents: **Setup /40** (persona rubric), **Entry /30** (4 early-entry methods + trigger + stop/R:R — TWLO-pullback scores high), **Theme/Leadership /20**, **Sentiment /10**; inputs **News** (search-grounded), **Fundamentals** (Lengyan A/B/C), **Risk**; **Moderator → Conviction /100 + ENTER/WAIT/PASS**. Fires only on TRIGGERED picks; DeepSeek/Gemini by default; persists to `TradeVerdictHistory(style="agent-conviction")`.

---

## R5 — Coaching digest (edge + execution)

- **Edge:** expectancy-in-R per (setup × champion × trigger-state).
- **Execution:** triggered-and-taken vs triggered-and-missed vs chased-untriggered + MFE-capture %.
- One per-user weekly digest (extends `journal/digest`) with a single "do this differently" line.

---

## Sequence & parallel track

R3 → R4 → R5, each multi-tenant. Beta-readiness (observability, member-book, legal/disclaimer, OAuth full verification at scale) stays a **parallel track** to schedule at onboarding — OAuth is already Published/In-production (100-user cap, fine for the 5–10 beta).

---

## P1–P5 re-plan (2026-06-25, post A-list-usefulness audit + wiki gate-doctrine)

Driven by the operator audit ("page uninformative; MFE/MAE never update; closed not filtered; no stops; GO list isn't what the pros buy"). New phases on top of R3–R5:

- **P1 — tracker fix (SHIPPED).** `track-positions` timed out at 60s on ~88 candidates → 0 rows. Now bounded-parallel + per-fetch timeout + Yahoo→Stooq fallback + maxDuration 300. MFE/MAE/stops populate.
- **P3 — A-list redesign (SHIPPED).** Active vs Closed/Review boards; performance scoreboard (win-rate, avg MFE/MAE R, MFE-capture by setup); serializer surfaces running MFE/MAE + `effectiveStop` (logged or ATR-floor); HELD = broker-truth (price-path stop no longer retires a held position).
- **P3.5 — setup-conditional RVOL gate + pullback lane (this change).** Root cause of "GO list ≠ pro buys": a **universal `RVOL ≥ 1.5×`** gate + a `setup -= 6` low-RVOL penalty excluded/penalised the pullback lane the pros trade — contradicting `wiki/a-list-gate-and-screener.md` (RVOL is setup-conditional: breakout/EP ≥150% surge, pullback ≤100% contraction). Fix: `screener-scanner` rewards pullback contraction (no universal penalty) + widens `is_pullback`; `a-list-extractor` gates RVOL by setup class and admits pullbacks at the WATCH band (armed → GO on the trigger). **Remaining in P3.5:** split "off-book" from the A/B/C entry grade (so ONTO +1.88R isn't mislabelled C); `skills:sync` to propagate the doctrine to LLM-scorer knowledge.
- **P4 — market context** at entry + exit (SPY/QQQ % + breadth + Fear&Greed) so "was it the pick or the tape" is answerable.
- **P5 — auto-calibrating scoring** (lesson digest → wiki edits + `skills:sync`); calibrates *within* the corrected P3.5 gate.
- **P2 — OpenD/IBKR bridge push** as the authoritative daily-bar feed (cloud Yahoo/Stooq fallback already carries it unattended).

**Amended order: P3.5 → P4 → P5 → P2.** Anti-reversion: P3.5/P5 scoring/gate doctrine lands in `llm_traders_wiki` first (done for the gate), then runtime + `skills:sync`.
