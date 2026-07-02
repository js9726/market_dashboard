# Morning Dailies — Agent Runbook

**Trigger:** when Jie says **"do morning dailies"** (or "morning dailies", "run the dailies", "daily routine here"), the agent (Claude Code **or** Codex) runs this end-to-end: refresh everything the dashboard needs **and** present today's A-List in chat. Idempotent — safe to re-run any time.

> Keys live in `apps/market_dashboard/.env` (`BRIEF_INGEST_KEY`, `CRON_SECRET`) and as GitHub/Vercel secrets. Prod base URL: `https://market-dashboard-ivory.vercel.app`. All endpoints below are idempotent and degrade gracefully.

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

Run the **`morning-brief`** skill (Claude CLI WebSearch → StructuredBrief → push). This refreshes the **Claude** brief tab + Conviction Desk standout/trader-read. DeepSeek/Gemini tabs refresh on their own pre-open cron.

## Step 3 — Daily A-List (present in chat)

This is the part Jie wants in chat. Compose it from the freshest data:

1. **REC lane** — the screener picks that cleared the bar (`score >= 80`, verdict `GO`, `rvol >= 1.5x`). Source: the `screeners/refresh` run above (or read `apps/market_dashboard_backend/data/tv_screeners.json` after `python scripts/tv_screener_fetch.py --score`).
2. **HELD lane** — current bought positions (HUT/MTLS/TENB etc.) from moomoo OpenD / the Portfolio. Badge each **REC+HELD (on-book)** if it matches a screener pick within ~7d, else **HELD off-book** with its entry grade vs the bar.
3. **Overlay live OpenD quotes** before reporting (TradingView/screener data is pre-cached — see memory `feedback_enrich_screener_with_opend`).

Present as a compact table: `Ticker · Badge · Setup · Score · RVOL · Entry/Stop/Target · (HELD: day-0→14 status + Realized-vs-R + Soft-vs-Hard)`. Lead with the single highest-conviction standout.

## Step 4 — Confirm

- `screeners/refresh` reported `recCandidates: N` (REC rows upserted for today).
- `sync-held-alist` reported created/linked counts; `track-positions` reported `processed: N`.
- The dashboard A-List (`/dashboard/trades` → A-List) + Conviction Desk are now current. Optionally `GET /api/a-list/today` (owner session) to verify the merged board.

---

## Notes

- **Fail-closed on stale data:** for any A-List / entry analysis, pull live OpenD first; if OpenD is unreachable or a required field is stale/missing, **STOP and flag** — never present levels or push numbers off stale data (see `jie_wiki/skills/trade-analyser/SKILL.md` Step 0.6).
- **REC source of truth** is the TV-screener scored hits (the morning brief does NOT carry per-ticker score+rvol). The serverless `screeners/refresh` ingests REC via `ingestScreenerRec()`; the GH pre-open `tv_screener_fetch.py` is a redundant trigger (needs `DASHBOARD_URL`+`BRIEF_INGEST_KEY` in its step env to also push).
- **HELD rows are ungated** — every real position is tracked regardless of entry quality; the entry grade is a learning overlay, not an admission test.
- Auto-journal of closed trades + the nightly "what to learn" digest run post-close (`journal_close.yml` + `/api/journal/digest`) — no action needed here.
- This runbook is committed so both Claude Code (`CLAUDE.md`) and Codex (`AGENTS.md`) can act on the trigger; the local-only `DAILY.md` has the owner's manual/desk variant.
