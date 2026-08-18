# Morning Dailies — Agent Runbook

**Trigger:** when Jie says **"run analysis for today"**, **"analyse today's market"**, **"check today's market"**, **"any GO list today?"**, **"run today's analysis"**, **"do morning dailies"**, or semantically similar current-session wording, the agent (Claude Code **or** Codex) runs the complete workflow. Idempotent — safe to re-run any time.

The trigger always means all six deliverables: (1) Finviz Day / Week / Month theme analysis, (2) a strict GO/WATCH/PASS list, (3) Jie's configured TradingView screener refresh and review, (4) authenticated TradingView daily/weekly snapshots for every serious GO candidate, (5) one verified owner morning brief from Claude or Codex plus an explicit validator state, and (6) final daily-screener persistence plus an idempotent Telegram delivery receipt. Do not silently reduce it to only a market summary, only an automated screener score, or a brief without read-back.

> Keys live in `apps/market_dashboard/.env` and as GitHub/Vercel secrets. The final-run endpoint uses `SCREENER_INGEST_KEY` (or controlled `BRIEF_INGEST_KEY` fallback) plus `TELEGRAM_GO_BOT_TOKEN` / `TELEGRAM_GO_CHAT_ID`. Prod base URL: `https://market-dashboard-ivory.vercel.app`. All endpoints below are idempotent and fail closed.

---

## Step 1 — Refresh the dashboard (serverless, no PC dependency)

Hit these against prod with the ingest key (`BRIEF_INGEST_KEY`). Each is idempotent; re-running just refreshes.

```bash
BASE=https://market-dashboard-ivory.vercel.app
KEY="$BRIEF_INGEST_KEY"   # from apps/market_dashboard/.env

# Market breadth (advancers/decliners/sectors via TV scanner)
curl -s "$BASE/api/breadth/refresh?key=$KEY"
# TV screeners + RECOMMENDED A-list ingest (score>=80 / GO / rvol>=1.5x → AListCandidate REC)
curl -s "$BASE/api/screeners/refresh?key=$KEY&force=1"
# Portfolio quotes (held tickers; market-clock relabels stale/closed)
curl -s "$BASE/api/cron/refresh-quotes?secret=$KEY"
# HELD A-list: seed bought positions from fills, then compute day-0→14 path + savings
curl -s "$BASE/api/cron/sync-held-alist?secret=$KEY"
curl -s "$BASE/api/cron/track-positions?secret=$KEY"
```

Each returns JSON with a freshness/processed count (e.g. screeners → `recCandidates`, track-positions → `processed`). Surface any non-`ok` response.

## Step 2 — Morning brief (AI)

Run the **`morning-brief`** skill in the active owner agent (Claude or Codex), produce the grounded StructuredBrief, and push it under that agent's real provider. DeepSeek/Gemini tabs may refresh on their own pre-open cron but do not replace the owner receipt.

## Step 3 — Daily A-List (present in chat)

This is the part Jie wants in chat. Compose it from the freshest data:

1. **REC lane** — the screener picks that cleared the bar (`score >= 80`, verdict `GO`, `rvol >= 1.5x`). Source: the `screeners/refresh` run above (or read `apps/market_dashboard_backend/data/tv_screeners.json` after `python scripts/tv_screener_fetch.py --score`).
2. **HELD lane** — current bought positions (HUT/MTLS/TENB etc.) from moomoo OpenD / the Portfolio. Badge each **REC+HELD (on-book)** if it matches a screener pick within ~7d, else **HELD off-book** with its entry grade vs the bar.
3. **Overlay live OpenD quotes** before reporting (TradingView/screener data is pre-cached — see memory `feedback_enrich_screener_with_opend`).

Present as a compact table: `Ticker · Badge · Setup · Score · RVOL · Entry/Stop/Target · (HELD: day-0→14 status + Realized-vs-R + Soft-vs-Hard)`. Lead with the single highest-conviction standout.

## Step 4 — Owner morning brief and validator state

Run the portable **`morning-brief`** skill against the same grounded evidence:

1. The first Claude or Codex run that completes every freshness/chart/catalyst/regime/risk gate owns the session.
2. Generate and ingest that one StructuredBrief as `provider=claude` or `provider=openai`.
3. Independently read back the owner's `MorningBriefCache` row and record its ID, bucket, `hasStructuredJson`, `generatedBy`, and error state.
4. Record the other provider as `PENDING`, or later as `VALIDATED`, `JUDGMENT_DIFFERS`, or `BLOCKED` against the same evidence. A judgment difference does not cancel an evidence-valid owner GO; a factual error or hard-gate failure does.

DeepSeek/Gemini may continue to refresh on their own schedule, but they do not become the validator merely by generating another tab. Do not require duplicate Claude and Codex GO verdicts.

## Step 5 — Persist the final run and notify Telegram

After the owner receipt and validator state have been added to the dated `report.md`, run the shared screener packager with `-Strict -Post -GeneratedBy <producer>`. The resulting `tradingview-daily-screener/v2` artifact is the final authority; `AListCandidate` and raw machine screener labels are not.

The ingest endpoint stores `DailyScreenerRun` + chunks and sends `candidates.goList` through the dedicated Telegram bot. Identical run-date/list hashes are idempotent across Codex, Claude, and Gemini. A corrected final list sends a new notification; an empty GO list sends an explicit “No GO tickers” message. `not_configured` and `failed` are blockers.

The MooMoo SIMULATE bridge reads only `/api/daily-screener/paper-signals`, which is derived from this persisted strict artifact. It never consumes raw `AListCandidate` rows. GO rows must contain one numeric entry, stop, and target with `stop < entry < target`; stale and already-consumed signals fail closed.

Recheck conditional WATCH names in the afternoon decision window. If a documented trigger fires, repeat the authenticated chart, catalyst, risk, and timing gates and repost the corrected strict artifact. A price cross by itself is not permission for the paper bridge to buy.

This is a trading-dashboard workflow only. Do not use Walplus Cloud Run, BigQuery, buckets, service accounts, or secrets.

## Step 6 — Confirm

- `screeners/refresh` reported `recCandidates: N` (REC rows upserted for today).
- `sync-held-alist` reported created/linked counts; `track-positions` reported `processed: N`.
- Finviz Day / Week / Month theme findings were reconciled with breadth and live ETF/index action.
- Every proposed GO cites authenticated TradingView daily and weekly screenshots.
- `MorningBriefCache` read-back confirms the current structured owner row under its actual provider; the other provider has an explicit validator state rather than an invented duplicate receipt.
- `DailyScreenerRun` ingest returned a run ID and Telegram returned `sent`, `already_sent`, or `in_progress`.
- `/api/daily-screener/paper-signals` read-back names the same run/hash and the SIMULATE bridge dry-run reports the same GO tickers (or the same explicit empty list).
- The dashboard A-List (`/dashboard/trades` → A-List) + Conviction Desk are now current. Optionally `GET /api/a-list/today` (owner session) to verify the merged board.

---

## Notes

- **Fail-closed on stale data:** for any A-List / entry analysis, pull live OpenD first; if OpenD is unreachable or a required field is stale/missing, **STOP and flag** — never present levels or push numbers off stale data (see `jie_wiki/skills/trade-analyser/SKILL.md` Step 0.6).
- **REC source of truth** is the TV-screener scored hits (the morning brief does NOT carry per-ticker score+rvol). The serverless `screeners/refresh` ingests REC via `ingestScreenerRec()`; the GH pre-open `tv_screener_fetch.py` is a redundant trigger (needs `DASHBOARD_URL`+`BRIEF_INGEST_KEY` in its step env to also push). A REC row is not automatically a final GO; the chart/catalyst/risk gates can downgrade it.
- **Telegram and paper source of truth** is only the final v2 artifact's `candidates.goList`. The bot and SIMULATE bridge deliver/execute; they do not analyse. Any approved producer, including Gemini in a cloud job, must satisfy the same artifact schema and hard gates.
- **HELD rows are ungated** — every real position is tracked regardless of entry quality; the entry grade is a learning overlay, not an admission test.
- Auto-journal of closed trades + the nightly "what to learn" digest run post-close (`journal_close.yml` + `/api/journal/digest`) — no action needed here.
- This runbook is committed so both Claude Code (`CLAUDE.md`) and Codex (`AGENTS.md`) can act on the trigger; the local-only `DAILY.md` has the owner's manual/desk variant.
