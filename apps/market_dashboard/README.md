# Dashboard web application

Next.js 15 App Router + React 19/TypeScript. Read the [repository overview](../../README.md)
and [maintenance runbook](../../docs/runtime-maintenance.md) for current architecture.

- `src/app`: page and API entry points; `/dashboard` renders ConvictionDesk.
- `src/components`, `hooks`: UI and polling consumers.
- `src/lib`, `server`: domain rules, validation, auth, providers and data services.
- `prisma`: 39-model PostgreSQL schema and required migration history.
- `agents`: fundamental/technical analysis implementations.
- `public/market-dashboard`: validated generated fallback, not universal live truth.
- `scripts`: data/wiki sync, build, evaluations and administrative utilities.

Run `npm run dev` for local UI; `npm test` for Vitest; `npx tsc --noEmit` for types.
`npm run sync:market` copies canonical backend files after JSON/time-regression checks.
`npm run skills:check:strict` checks the pinned wiki inputs and actual runtime bodies.

**Build side effect:** `npm run build` applies Prisma migrations before building Next.
Use an isolated test environment for build verification; production migrations require
the deployment procedure. Playbooks/Replay and some multi-agent lanes remain partial.
