# Stateful research worker

Local implementation, disabled by default. No scheduled task or bot configuration is
changed. The existing analysis panel remains the default until the UI flag is enabled.

## What is implemented

- Owner-only authenticated job submission, history, polling and cancellation.
- Postgres job/thread persistence, request idempotency, atomic compare-and-swap leases,
  30-minute job deadlines, 120-second leases and at most three crash-recovery claims.
- Current, tracked, mandatory wiki doctrine plus six trading-only supplemental passages.
  Scope filtering happens before keyword/vector ranking. Lexical is the default;
  hybrid explicitly uses Gemini query embeddings and never repairs the index.
- Portable thread summaries and previous-result IDs; Claude exact-session resume is
  bound to that thread/provider/prompt version. DeepSeek receives the saved context.
- Selected Claude subscription or DeepSeek API; no cross-provider fallback.
- Optional read-only market/fundamental and search-grounded news collectors.
- Validated report sections, source timestamps, gaps, seven lenses and A/B/C grade.
  Final ingestion writes `WikiTradeVerdict(intent="analysis")` transactionally with
  the immutable job report and updated thread, followed by a separate receipt read.

**Research only:** GO/PROBE are rejected until the full deterministic structural-gate
evaluator is integrated. Unsupported scores, wrong-company/old financial sources and
unsupported or inverted price plans are rejected. Missing authenticated daily/weekly
charts and incomplete news coverage remain visible. No trade or publication is implied.

## Configuration for a separately authorized rollout

First apply the reviewed migration `20261004000000_research_jobs` to an isolated staging
database and test concurrent claims/transaction rollback there. This task generated SQL
and Prisma types offline; it did not apply the migration or verify a live database.
The repository's `npm run build` wrapper applies migrations, so do not use it as a
harmless type check. Direct TypeScript validation and mocked DB tests are separate.

Dashboard environment:

| Variable | Meaning |
|---|---|
| `RESEARCH_ENABLED=true` | Explicitly enable research routes after migration |
| `NEXT_PUBLIC_FEATURE_RESEARCH_WORKER=true` | Build-time switch to the saved research UI |
| `RESEARCH_WORKER_TOKEN` | Dedicated random secret, at least 32 characters; never reuse another ingest key |
| `RESEARCH_WORKER_USER_ID` | Existing owner user ID; worker can act only for this owner |

The user must have an explicit `[OPERATOR]` mapping on their spreadsheet connection.
Jobs use that mapping; no implicit JS fallback. Existing journal rows and analyses
bound to another user are never overwritten. A ticker/date's latest analysis can be
updated, while each job retains its own immutable report and source metadata.

Worker environment (loaded by the operator, never written by this implementation):

| Variable | Meaning |
|---|---|
| `DASHBOARD_URL` | HTTPS origin; HTTP permitted only for loopback development |
| `RESEARCH_WORKER_TOKEN` | Same dedicated secret |
| `JIE_WIKI_ROOT` | Canonical wiki checkout with retrieval dependencies installed |
| `RESEARCH_EVIDENCE_DIR` | Optional trusted collector directory containing `<TICKER>.json` |
| `DEEPSEEK_API_KEY`, `RESEARCH_DEEPSEEK_MODEL` | Required for explicit DeepSeek selection |
| `CLAUDE_CODE_OAUTH_TOKEN` or existing Claude login | Subscription authentication; Anthropic API credentials ignored |
| `GEMINI_API_KEY`, `RESEARCH_NEWS_MODEL` | Only for explicit `--grounded-news`; model must support Google Search |

Use Python with the canonical wiki's `scripts/retrieval/requirements-lock.txt` dependencies.
`--live-market` additionally uses the dashboard backend's existing yfinance dependency.
Claude must support the installed CLI's `--safe-mode`, `--tools`, `--strict-mcp-config`
and `--resume` flags. It receives no tools or unrestricted shell permissions. Do not use
`--bare`: that CLI mode requires API auth and does not preserve the subscription lane.
Provider model names are explicit configuration, avoiding an automatic model migration.

Safe command (no calls, claims or generation):

```powershell
python packages/research-worker/worker.py --provider claude
```

After separate live-run approval and configuration, a single job can be processed with:

```powershell
python packages/research-worker/worker.py --provider claude --execute --once --live-market --grounded-news
```

Omit `--once` for polling; no service is installed automatically. `--retrieval hybrid`
permits a query embedding call, not an index refresh. A stale index fails explicitly;
choose lexical explicitly for a new run if that is the intended evidence mode.
Switching providers is explicit. Failed provider runs do not reroute or auto-retry;
crashed workers can reclaim an expired lease within the deadline/retry limit.

## Evidence and report contract

`src/lib/research/schema.ts` is the server-side authoritative report validator. The
worker receives its output template from the claimed job, so it does not maintain a
second report schema. `context.py` is the shared context assembler for PC calls.

Trusted evidence files are UTF-8 JSON `{ "ticker": "NTAP", "sources": [...] }`.
Each source follows `sourceSchema`: id, kind, HTTPS URL, ticker, asOf, retrievedAt,
expiresAt, text, SHA256 of exact UTF-8 text; fundamentals also carry reporting period.
Authenticated chart sources additionally identify daily/weekly kind, timezone,
currentBar, movingAverages and volume. Only the trusted chart collector should assert
those flags; the model cannot add evidence. The worker checks content hashes and the
server checks the schema, timestamps, citation IDs and required source kinds.

Optional Yahoo collection drops quotes older than 15 minutes and fundamentals older
than 180 days. Yahoo summaries mix TTM/latest-quarter/current valuation fields; the
source explicitly records that limitation. Gemini news retains only segments with
grounding-support citations, at most 60 citations. It does not assert exhaustive
90-day coverage. Total input is bounded to 100 sources with disclosed truncation.
News/API failures return gaps; there is no simulated news or calendar data.

Wiki doctrine and live evidence are separate. Full mandatory doctrine currently uses
about 103k characters; account for that before starting a metered run. Context records
source hashes/revision, retrieval mode, thread state and observed provider usage/model.
Private thread state is never embedded into the shared wiki index.

## Validation and remaining integration

Offline tests cover context scope/freshness, evidence/report gates, route auth, job
lease predicates, provider credential isolation, explicit execution, cancellation and
ingest read-back. Database tests mock Prisma: they do not establish real Postgres
concurrency/rollback, deployment readiness or provider model availability.

```powershell
# From dashboard app
node node_modules/vitest/vitest.mjs run src/lib/research/__tests__
node node_modules/typescript/bin/tsc --noEmit --incremental false
# From repo, using Python with the wiki retrieval dependencies
python -m unittest discover -s packages/research-worker/tests
```

Still separate: complete structural action-gate integration, authenticated chart
capture automation, bot job submission and PNG rendering/delivery, staging migration
and concurrent DB tests, approved live report/receipt verification, then scheduling.
Current bot tools and restrictions are unchanged. The shared report can be read by the
authenticated owner route; this does not grant a bot publication or ingest authority.

References: [Claude CLI](https://code.claude.com/docs/en/cli-reference),
[DeepSeek JSON mode](https://api-docs.deepseek.com/guides/json_mode/),
[Google Search grounding](https://ai.google.dev/gemini-api/docs/google-search).
