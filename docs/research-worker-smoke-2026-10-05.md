# Research worker smoke validation — 5 October 2026

**Local worker path passed. Production is not enabled.** The queue, wiki context,
Claude subscription generation, transactional report ingestion, receipt read-back and
exact-session follow-up worked against a disposable local PostgreSQL instance.

## Evidence

| Check | Result |
|---|---|
| Migration | Applied the existing research SQL to an isolated pre-research baseline schema; PostgreSQL 16.4, loopback only |
| Full app suite with real database suite enabled | 427 passed across 53 files; one live-provider test skipped in this run |
| Separate live-provider test | Passed: two Claude Code 2.1.289 subscription turns, persisted receipts, same session UUID, thread version 2 |
| Python worker tests | 29 passed |
| TypeScript | `--noEmit --incremental false` passed |
| Runtime skill hashes | Strict freshness check passed for all five mapped artifacts |
| Independent review | PASS; reviewer reran 14 PostgreSQL/HTTP cases and 14 worker-specific Python tests without provider calls |

The 14 ordinary database smoke cases cover claim contention, completion contention,
journal-collision rollback, expired lease replacement, cancellation/completion races,
attempt/deadline exhaustion, idempotency, queue limits, foreign-owner isolation, saved
thread memory, same-day replacement receipts, HTTP access/payload gates, and the actual
Python Client/process_job → API handler → PostgreSQL flow. Ordinary tests use fixture
reports; the separate Claude test uses the real subscription adapter and current wiki.
The HTTP bridge invokes the actual route handler; it is not a Next.js browser/login test.

## Validation loop and repair

Review identified a recovery defect: a serializable database conflict during completion
could discard a valid generated report by immediately marking the job failed. The worker
now recognizes only the server's explicit `CONCURRENT_UPDATE_RETRY` response, checks
for a committed receipt first, and resubmits the same report at most three times. It
does not regenerate the report or retry lease/validation conflicts. Regression tests
cover bounded retries, error classification, and lost-response receipt recovery.

The first Claude attempt returned JSON with an extra closing brace and failed closed.
No report was ingested from that attempt. A separately rerun smoke completed both turns
and read back the saved session/report. This demonstrates successful transport and
persistence, not guaranteed model reliability: malformed outputs remain explicit failed
jobs, with no silent repair or provider fallback.

All provider-test reports correctly remained `partial` / `UNAVAILABLE`: no live quotes,
news or authenticated charts were supplied. No research scores or trade instructions
were invented. Lexical retrieval loaded current tracked wiki doctrine; hybrid embeddings,
DeepSeek and Gemini news generation were not called in this smoke.

## Reproduce

Provision a disposable loopback PostgreSQL database named `research_smoke*`. The test
file does not create or migrate it. During this run, a temporary baseline schema omitted
ResearchJob/ResearchThread, then the repository's existing research SQL was executed.
Both `DATABASE_URL` and `DATABASE_URL_UNPOOLED` were explicitly overridden for those
schema commands. The production build wrapper was not used because it runs migrations.

From `apps/market_dashboard`, with that database already prepared:

```powershell
$env:RESEARCH_SMOKE_DATABASE_URL = 'postgresql://postgres@127.0.0.1:55435/research_smoke_20261005'
node node_modules/vitest/vitest.mjs run src/lib/research/__tests__/postgres-smoke.test.ts
# Explicit opt-in: consumes two Claude subscription turns.
$env:RESEARCH_SMOKE_CLAUDE = '1'
node node_modules/vitest/vitest.mjs run src/lib/research/__tests__/postgres-smoke.test.ts -t 'Claude subscription'
```

Use local test credentials appropriate to your disposable database. The URL guard
rejects remote hosts, unexpected database names and unsafe query overrides. Test owners
and verdicts are synthetic and cleaned after each test. No production `.env` was changed.

Docker image downloads failed; the local server instead used the PostgreSQL 16.4 Windows
archive from [EDB's official binary distribution](https://www.enterprisedb.com/download-postgresql-binaries).
This was test infrastructure, not an upgrade recommendation or a production installation.
Final database read-back found zero users, jobs and verdicts. The temporary PostgreSQL
server was stopped. Recursive removal was rejected by automatic approval review with
"blocked by policy", so its archive/binaries/empty cluster remain under
`%TEMP%/research-smoke-20261005`. Docker Desktop, started solely for this test, was
stopped after confirming no running containers. These files are not a running service.

## Remaining activation and acceptance work

At the start of this check, `RESEARCH_ENABLED` and the public UI flag were disabled;
the dedicated worker token/owner binding and explicit research model settings were
missing. Claude subscription login was available. No production migration, deployment,
service installation, bot restart, Telegram message or broker operation was performed.

Before rollout: apply the reviewed migration in the intended environment, configure the
dedicated owner/token and provider settings, enable the flags, then verify an authenticated
browser job and a fresh evidence-backed report/receipt. Full structural action gates,
authenticated chart automation and bot submission/PNG delivery remain unfinished.
GO/PROBE stay blocked. Local PASS does not mean the 24/7 production worker is running.
