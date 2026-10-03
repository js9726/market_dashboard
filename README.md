# Market Dashboard

Trading workstation with a Next.js website, persistent journal/research data,
Python market producers, and local broker/assistant services. The architecture
below describes implemented code, not a claim of live production readiness.

## Start here

- [Architecture chart and searchable inventory](docs/architecture-audit-2026-10-04.html)
  preserves the initial 4 October audit and links to its maintenance update.
- [Current maintenance status, runtime evidence and roadmap](docs/runtime-maintenance.md)
- [Morning dailies contract](MORNING-DAILIES.md)
- [Broker bridge](packages/dashboard-bridge/README.md)
- [Discord assistant](packages/bot-box/README.md)

## Layout

| Path | Responsibility |
|---|---|
| `apps/market_dashboard` | Next.js App Router website, APIs, Prisma schema, tests |
| `apps/market_dashboard_backend/scripts` | Market snapshots, charts, screeners, breadth and API-provider briefs |
| `apps/market_dashboard_backend/data` | Canonical generated artifact tree |
| `apps/market_dashboard/public/market-dashboard` | Served copy of canonical artifacts, plus retained local evidence |
| `packages/core-skills` | Six deployable AI skill modules and shared prompt/profile code |
| `packages/core-skills/wiki-source` | Pinned canonical jie_wiki submodule |
| `packages/dashboard-bridge` | Local MooMoo/OpenD and IBKR connectors; separate SIMULATE executor |
| `packages/bot-box` | Private Discord assistant, restricted tools, report renderer, brief dispatcher |
| `.github/workflows` | Seven root workflows including offline/pinned-source contract checks |
| `scripts` | Skill sync/checks, claim hook and Telegram provisioning |
| `.agents`, `.claude`, `.codex` | Development-assistant instructions and hooks |
| `research`, `packages/usChatBot-DataPipeline` | Historical research/reference material |
| `archive/2026-10-04` | Ignored local recovery ZIPs; see tracked archive manifest |

Root `data/` and 15 historical one-off Python scripts were archived with SHA-256
round-trip verification. No application reads the retired root artifact tree.
Generated backend/public copies are intentional; do not merge them as source code.

## Application and technology

- Next.js 15.5.20, React 19.2.4, TypeScript 5.8.2, Tailwind 3.4.17.
- Recharts 2.15.1 and Lightweight Charts 5.2.0.
- NextAuth 5 beta, Google OAuth, Prisma 5.22 and PostgreSQL.
- Python: yfinance, pandas, NumPy, SciPy, matplotlib, requests, BeautifulSoup.
- MooMoo SDK and IBKR `ib_async` (legacy `ib_insync` fallback).
- Explicit DeepSeek/Gemini API lanes and Claude/Codex subscription runners.

The website has 37 page files, 89 API handlers and 39 Prisma models at the audit
baseline. Market Desk, journal, portfolio, equity, screeners, themes and analysis
are implemented. Playbooks/Replay remain placeholders; the multi-agent route has
News/Chart/Historical stubs. Declared Azure/X/Twitter dependencies are not evidence
of completed integrations.

## Data flow and freshness

```text
Python producers -> backend/data -> validated sync -> public/market-dashboard
TradingView server refreshes -> database caches -> Next APIs -> polling UI
Local broker bridge -> authenticated ingest -> Position/TradeFill/LiveQuote
Google Sheets -> journal sync -> plans/history, overlaid with broker truth
Wiki/runtime skills -> selected AI runner -> validated schema -> ingest/cache
Final v2 screener run -> persistence -> idempotent Telegram delivery
```

Snapshots use a live server overlay over the static baseline. Breadth/screeners
are database-first; live quotes and briefs have their own caches. A fresh aggregate
cache timestamp never proves that every price, underlying source or provider is fresh.

Data jobs now refresh snapshot, screeners and fast breadth, fail on required fetch
errors, run `check_daily_freshness.py` before AI consumers, and check backend/public
parity before committing both artifact trees. The gate rejects stale/future/naive
timestamps, invalid JSON and reported fetch failures. It preserves legitimate
zero-hit scans. `sync:market` refuses timestamp regression and invalid JSON before
writing; it no longer rewrites words inside JSON strings with a regex.

These are local changes until approved publication. Actual served freshness and
remaining deployment work are recorded in the maintenance document.

## Portable wiki knowledge

```powershell
git submodule sync -- packages/core-skills/wiki-source
git submodule update --init --recursive -- packages/core-skills/wiki-source
cd apps/market_dashboard
npm run skills:check:strict
```

Default sync/check authority is the pinned submodule, not an incidental sibling
checkout. `JIE_WIKI_ROOT` and `JIE_WIKI_SKILLS_ROOT` are explicit authoring overrides;
an invalid override fails. For an intentional wiki update, use a remotely reachable
reviewed wiki commit, advance the gitlink, sync the five enabled knowledge artifacts,
and verify strict checks from the pin. An authoring-override pass is not portable
acceptance. Source/body hashing normalizes CRLF and validates actual body content.

Morning-brief knowledge is hand-authored and excluded from manifest sync. Planned
chart-annotation and broker-moomoo manifest entries remain disabled. The broker
bridge is implemented separately; that planned skill is not the bridge package.

## Local commands

From `apps/market_dashboard`:

```powershell
npm install
npm run dev
npm run skills:check:strict
npm run sync:market
npm test
npx tsc --noEmit
```

From the repository root, offline maintenance checks:

```powershell
node --test scripts/test-skill-sync.mjs apps/market_dashboard/scripts/test-sync-market-dashboard.mjs
python -m unittest discover -s apps/market_dashboard_backend/scripts -p test_daily_freshness.py
python scripts/test-maintenance-contracts.py
```

The last check requires PyYAML. `npm run build` currently executes Prisma migration
resolution and deployment before Next build. Do not use it as a read-only diagnostic
against a production-configured environment. No database migration ran in this cleanup.

## Automation and access

Root workflows cover premarket, intraday, explicit-provider, self-hosted Codex,
journal-close, trading-brief evaluation, and maintenance contracts. Vercel cron
configuration lives in `apps/market_dashboard/vercel.json`. Fixed UTC GitHub schedules
are not guaranteed delivery times and shift relative to New York daylight saving.
Local brief dispatch uses 08:40 ET. Nested `apps/.../.github` files are legacy examples.

Current roles are `owner`, `member`, `pending`, `denied`; legacy `allowed` maps to
`member`. Personal records remain user-scoped. OAuth/session and machine-ingest
bearer checks have different entry paths. Secrets stay in local environment/secret
stores and hosting configuration; never commit them. Push, deployment, external
messages, bot restarts and broker transactions retain their separate authorization.
