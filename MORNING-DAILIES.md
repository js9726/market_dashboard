# Morning Dailies — Agent Runbook

**Trigger:** when Jie says **"run analysis for today"**, **"analyse today's market"**, **"check today's market"**, **"any GO list today?"**, **"run today's analysis"**, **"do morning dailies"**, or semantically similar current-session wording, the agent (Claude Code **or** Codex) runs the complete workflow. Idempotent — safe to re-run any time.

The trigger always means all five deliverables: (1) Finviz Day / Week / Month theme analysis, (2) a strict GO/WATCH/PASS list, (3) Jie's configured TradingView screener refresh and review, (4) authenticated TradingView daily/weekly snapshots for every serious GO candidate, and (5) verified morning-brief updates for both Claude and Codex. Do not silently reduce it to only a market summary, only one provider's brief, or only the automated screener score.

> Keys live in `apps/market_dashboard/.env` (`BRIEF_INGEST_KEY`, `CRON_SECRET`) and as GitHub/Vercel secrets. Prod base URL: `https://market-dashboard-ivory.vercel.app`. All endpoints below are idempotent and degrade gracefully.

---

## Step 1 — Refresh the dashboard (serverless, no PC dependency)

Hit these against prod with the ingest key (`BRIEF_INGEST_KEY`). Each is idempotent; re-running just refreshes.

```bash
BASE=https://market-dashboard-ivory.vercel.app
KEY="$BRIEF_INGEST_KEY"   # from apps/market_dashboard/.env

# Market breadth (advancers/decliners/sectors via TV scanner)
curl -s "$BASE/api/breadth/refresh?key=$KEY"
# TV screeners + server-side REC ingest (final GO still requires the hard gates below)
curl -s "$BASE/api/screeners/refresh?key=$KEY&force=1"
# Portfolio quotes (held tickers; market-clock relabels stale/closed)
curl -s "$BASE/api/cron/refresh-quotes?secret=$KEY"
# HELD A-list: seed bought positions from fills, then compute day-0→14 path + savings
curl -s "$BASE/api/cron/sync-held-alist?secret=$KEY"
curl -s "$BASE/api/cron/track-positions?secret=$KEY"
```

Each returns JSON with a freshness/processed count (e.g. screeners → `recCandidates`, track-positions → `processed`). Surface any non-`ok` response.

## Step 2 — Finviz theme analysis

Review Finviz sector and industry performance across **Day / Week / Month**. Reconcile those views with the freshly returned breadth and live OpenD index/ETF action. State whether leadership is broad, rotating, defensive, event-driven, or risk-off. Save or cite the Finviz views and observation time.

Finviz is the theme layer, not a separate ticker-discovery universe: a GO candidate must still come from Jie's configured TradingView screeners.

## Step 3 — TradingView screeners, GO List, and chart evidence

Refresh the local screener bundle and compose the GO List from the freshest data:

1. **REC lane** — start with the configured TV-screener hits and the current Conviction Score (`GO >= 75`, `WATCH 50-74`, `PASS < 50`). A numerical GO is only a candidate: it must still pass the market-regime, chart, catalyst, extension, market-cap/liquidity, stop, reward/risk, and setup-conditional volume gates.
2. **HELD lane** — current bought positions (HUT/MTLS/TENB etc.) from moomoo OpenD / the Portfolio. Badge each **REC+HELD (on-book)** if it matches a screener pick within ~7d, else **HELD off-book** with its entry grade vs the bar.
3. **Overlay live OpenD quotes** before reporting (TradingView/screener data is pre-cached — see memory `feedback_enrich_screener_with_opend`).
4. **Authenticated chart gate** — for every serious GO candidate, open TradingView through the logged-in Chrome session, capture current daily and weekly charts, save both paths in `tradingview_snapshots/daily/YYYY-MM-DD/`, and cross-check the machine label, pivot, stop, extension, overhead supply, and volume. Missing either interval caps the ticker at WATCH.
5. **Package evidence** — write the report and run the `tradingview-daily-screener` packaging step so the saved GO/WATCH/PASS verdict remains the auditable source.

Present as a compact table: `Ticker · Badge · Setup · Score · RVOL · Entry/Stop/Target · (HELD: day-0→14 status + Realized-vs-R + Soft-vs-Hard)`. Lead with the single highest-conviction standout, or explicitly state **empty GO list / no entry today**.

## Step 4 — Morning briefs for Claude and Codex

Run the portable **`morning-brief`** skill against the same grounded evidence:

1. Generate and ingest the Claude StructuredBrief as `provider=claude`.
2. Generate and ingest the Codex StructuredBrief as `provider=openai`.
3. Independently read back both `MorningBriefCache` rows and record each row's ID, bucket, `hasStructuredJson`, `generatedBy`, and error state.

DeepSeek/Gemini may continue to refresh on their own schedule, but they do not substitute for either required Claude/Codex receipt. One successful provider does not prove that the other was updated.

## Step 5 — Confirm

- `screeners/refresh` reported `recCandidates: N` (REC rows upserted for today).
- `sync-held-alist` reported created/linked counts; `track-positions` reported `processed: N`.
- Finviz Day / Week / Month theme findings were reconciled with breadth and live ETF/index action.
- Every proposed GO cites authenticated TradingView daily and weekly screenshots.
- `MorningBriefCache` read-back confirms current structured rows for both `provider=claude` and `provider=openai`.
- The dashboard A-List (`/dashboard/trades` → A-List) + Conviction Desk are now current. Optionally `GET /api/a-list/today` (owner session) to verify the merged board.

---

## Notes

- **Fail-closed on stale data:** for any A-List / entry analysis, pull live OpenD first; if OpenD is unreachable or a required field is stale/missing, **STOP and flag** — never present levels or push numbers off stale data (see `jie_wiki/skills/trade-analyser/SKILL.md` Step 0.6).
- **REC source of truth** is the TV-screener scored hits (the morning brief does NOT carry per-ticker score+rvol). The serverless `screeners/refresh` ingests REC via `ingestScreenerRec()`; the GH pre-open `tv_screener_fetch.py` is a redundant trigger (needs `DASHBOARD_URL`+`BRIEF_INGEST_KEY` in its step env to also push). A REC row is not automatically a final GO; the chart/catalyst/risk gates can downgrade it.
- **HELD rows are ungated** — every real position is tracked regardless of entry quality; the entry grade is a learning overlay, not an admission test.
- Auto-journal of closed trades + the nightly "what to learn" digest run post-close (`journal_close.yml` + `/api/journal/digest`) — no action needed here.
- This runbook is committed so both Claude Code (`CLAUDE.md`) and Codex (`AGENTS.md`) can act on the trigger; the local-only `DAILY.md` has the owner's manual/desk variant.
