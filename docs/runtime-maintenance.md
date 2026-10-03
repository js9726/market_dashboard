# Dashboard maintenance and next steps

Status: local implementation, 4 October 2026 (MYT). No push, deployment, broker
restart, market refresh, paid analysis or external message was performed.

## Changes completed locally

- Archived 15 historical Python helpers and the obsolete 143-file root `data/` tree.
  Recovery ZIPs are in ignored `archive/2026-10-04/`; the public-safe manifest is
  [archive-manifest-2026-10-04.json](archive-manifest-2026-10-04.json). Every member
  was decompressed and SHA-256 matched before its original was removed. Saved brief
  JSON evidence was retained. A 306-file pre-reconciliation data backup also exists.
- Confirmed no direct candidate references in 212 local scheduled tasks, six relevant
  task wrappers, or running Python command names. Repo matches were historical/test
  references, not production callers. External/manual use cannot be proven absent.
- Recovered the later committed October 2 intraday snapshot, screener and chart set
  (`26bb1e06f`) into the backend tree formerly left at premarket `d5af8bad5`. Preserved
  the newer cached universe from the public copy. Canonical backend then copied forward
  without rewriting any timestamps: all 152 canonical files now match public bytes.
  Public-only historical/ignored files remain preserved; equality is for canonical files.
- Four workflows now fetch the canonical `.gitmodules` URL from repository root and
  fail on missing wiki. Removed legacy URL overrides and empty-directory fallbacks.
- Advanced wiki pin to remotely reachable `f4a479e2e84916246c0117ce1f9b85969ed88846`.
  The sibling wiki's unpublished `0710063` was deliberately not used as a gitlink.
- Skill sync defaults to that pin. Explicit authoring overrides remain possible, but
  invalid overrides fail. Strict checking now hashes actual generated bodies and
  normalizes CRLF. Five enabled knowledge artifacts pass; one needed regeneration.
- Market-producing workflows require screeners and fast breadth, check generated
  inputs before AI consumption, use one copy implementation, and check producer/public
  freshness and semantic equality before committing BOTH trees.
- Independent review found that failed screener requests were indistinguishable from
  valid empty scans. The producer now raises before partial output/ingestion, and the
  gate requires explicit successful-fetch status on every screener. Legacy artifacts
  without this provenance must be regenerated, not relabeled.
- Added offline source/body, copy-regression, artifact-validity and workflow-order tests,
  plus a contract CI workflow. Production acceptance still requires a later approved run.

## Runtime read-back: do not confuse these clocks

Read-only observations collected 4 October MYT (3 October UTC). Latest completed
US regular session was Friday 2 October. These are metadata checks, not live quote
coverage, broker reconciliation, grounded-news validation or a completed daily run.

| Layer | Observed timestamp / result | Interpretation |
|---|---|---|
| Local snapshot | 2 Oct 23:59:38 UTC | Latest retained Friday intraday artifact |
| Local screeners | 2 Oct 23:59:41 UTC | Same Friday output; fresh enough for historical-session inspection, not a newly generated brief |
| Local static breadth | 2 Jun 15:12:45 UTC | Stale; must regenerate before daily publication |
| Served static snapshot | 22 Sep 23:15:19 UTC | Behind Git/local output; deployment/static drift |
| Served static screeners | 22 Sep 23:15:21 UTC | Same drift |
| Served static breadth | 2 Jun 15:12:45 UTC | Stale fallback |
| Database breadth cache | latest refreshedAt 3 Oct 17:05:37 UTC | Cache refreshed; underlying market data still needs its own source/session check |
| Database screener cache | latest refreshedAt 3 Oct 17:05:37 UTC | DB path newer than static fallback |
| Database brief cache | latest generatedAt 2 Oct 18:28 UTC | At least one provider row then; not proof all provider lanes succeeded |
| Database live quotes | max observedAt 2 Oct 20:15:01 UTC | Some latest-session quotes; not whole-universe coverage |
| Quote ingestion field | max ingestedAt 17 Sep 15:26 UTC | Field semantics/update behavior need inspection; do not use it alone as feed health |
| Position snapshot | max asOf 3 Oct 17:06:36 UTC | Timestamp read only; no holdings or protection verdict made |
| Latest GitHub intraday run | 37079989141, success, 2 Oct 23:59:45 UTC | Job success does not establish deployment/data-consumer freshness |

Public artifact origin: `https://market-dashboard-ivory.vercel.app/market-dashboard/`.
Database checks were aggregate SELECTs through the configured Prisma connection;
no account identifiers, amounts or positions are included here. GET breadth/screener
endpoints were avoided because those handlers can refresh and write on stale reads.

The 180-minute publication gate correctly FAILS current retained files. Do not widen
its age limit merely to turn a weekend check green. A read-only weekend health report
should compare source dates with the latest completed exchange session; a newly
executed publication pipeline must produce fresh artifacts regardless of weekday.

## Archive recovery

Keep the ignored ZIPs private and back them up through an approved private channel.
The manifest contains original relative paths, byte lengths, member hashes and ZIP
hashes. Restore selected members only, first checking that their original paths do
not contain newer work. Historical scripts include dated prices and journal POSTs;
restoring a file is not authorization to execute it. Old tracked artifacts also remain
recoverable from Git history. No scratch JSON or broker configuration was deleted.

## Daily publication gates

Run producers from `apps/market_dashboard_backend` with explicit `--out-dir data`.
After snapshot, screeners and breadth succeed:

```powershell
python scripts/check_daily_freshness.py --data-dir data --max-age-minutes 180
```

After copying from the app directory with `npm run sync:market`, check again:

```powershell
python scripts/check_daily_freshness.py --data-dir data --public-dir ../market_dashboard/public/market-dashboard --max-age-minutes 180
```

Both examples above execute the validator from the backend directory. `--artifacts`
can inspect a deliberately scoped pipeline, but current publication workflows require
all three. The validator rejects missing/bad JSON, non-finite tokens, missing/naive/
future timestamps, reported errors, malformed shapes and mismatched served content.
It allows a zero-hit scan only with explicit successful-fetch provenance. It does not establish every quote's market time,
complete universe coverage, brief grounding, broker completeness or delivery receipts.
Existing producer-owned REC ingestion and provider validators remain separate contracts.

## Plan for items 8 and 9

1. **Close reliability first.** Independently review this local patch, then approve
   push/deployment separately. Verify the deployed SHA and public timestamps after a
   real producer run; require fresh static breadth and database cache read-backs. Add a
   metadata-only health view with per-source age, session, coverage, errors and last
   successful delivery. A single aggregate timestamp is insufficient.
2. **Separate build from database release.** Keep a pure build/type/test lane using
   isolated configuration; deploy migrations in a controlled release job after staging
   validation. Replace the unconditional migration-repair command with an explicit,
   incident-specific operation. This is proposed, not changed by this task.
3. **Retire scratch sustainably.** Keep reusable Python modules in runtime folders,
   dated outputs in ignored evidence/archive folders, and SQL migration history intact.
   Add a small lint check for new dated ad-hoc scripts in runtime paths. Do not merge
   distinct broker adapters, handler languages or breadth data sources by filename.
4. **Make partial features explicit.** Keep Playbooks/Replay hidden until each has a
   scoped design, data contract, tenant-isolation tests and one end-to-end acceptance
   flow. Replace specialist-agent stubs with an explicit unavailable state before
   considering provider implementations. Do not claim stub output is an independent
   specialist review.
5. **Build one feature at a time.** Recommend Playbooks first (reusable trading rules
   linked to journal entries), then Replay (requires trustworthy historical bars and
   reconstruction). Define a user scenario, schema/migration, API/UI acceptance, cost
   budget and owner for each. Do not silently implement both during housekeeping.
6. **Modernize within compatibility limits.** Remain on Next.js 15 as required by the
   repo; patch dependencies within compatible majors after tests and vulnerability
   review. Add a staging browser smoke for login, market desk, journal merge and ingest
   read-back. Use API output validation, clear unavailable states, timeouts and explicit
   provider failures; never fabricate news or silently reroute providers.
7. **Scheduling and observability.** GitHub schedule is best-effort; keep idempotent
   dispatch and independently verify completion. Use exchange calendar/session logic
   for health reporting and daylight-saving-aware scheduling. Alert on failed gates
   rather than publishing old artifacts as new. Hosting/task changes need their own
   rollout approval.

Acceptance criteria: fresh producer/served parity; actual wiki-body parity; no stale
or partial lane presented as current; no duplicate broker/sheet open holdings; no
cross-user data access; final analysis persistence and notification receipts where
that workflow requires them. Offline tests alone do not certify these live outcomes.

## Official references for the plan

- [GitHub workflow schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule): scheduled execution can be delayed; verify outcomes.
- [Next.js 15 deployment](https://nextjs.org/docs/15/app/getting-started/deploying): choose deployment appropriate to server features; retain this repo's compatible major.
- [Prisma deployment guidance](https://docs.prisma.io/docs/orm/prisma-client/deployment/deploy-migrations-from-a-local-environment): handle production migrations through a controlled pipeline. Commands must match the installed Prisma 5 version; do not copy newer-major commands blindly.
