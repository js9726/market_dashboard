# CLAUDE.md

Behavioral guidelines for AI-assisted development on this repo.

**Bias:** caution over speed. For trivial tasks, use judgment.

---

## Project Overview

| Layer | Path | Stack |
|---|---|---|
| Data Pipeline | `apps/market_dashboard_backend/scripts/` | Python, yfinance, Finviz |
| Morning Brief | `apps/market_dashboard_backend/scripts/morning_brief.py` | Gemini 2.5 Pro + GPT-4o + Claude (web search, HTML out) |
| Frontend | `apps/market_dashboard/` | Next.js 15.5, TypeScript, Tailwind, Recharts |
| AI Agents | `apps/market_dashboard/agents/` | Fundamental (yahoo-finance2 + DeepSeek), Technical |
| Runtime Skills | `packages/core-skills/` | LLM prompts + dual TS/Python handlers |
| Auth | `apps/market_dashboard/src/middleware.ts` | NextAuth v5 (Google OAuth) + Prisma |
| Automation | `.github/workflows/refresh_data.yml` | GitHub Actions (Mon–Fri, single 13:00 UTC pre-market run; intraday refreshes via `/api/morning-verdict` lazy regen) |
| Deployment | `apps/market_dashboard/vercel.json` + Vercel project settings | Vercel project targets `apps/market_dashboard` |

### Key Data Flow

```
build_data.py → data/snapshot.json + data/charts/*.png
morning_brief.py → data/morning_brief_{gemini,openai,claude}.html + data/morning_brief_meta.json
sync step → public/market-dashboard/  →  Vercel serves static files
```

---

## Commands

```bash
# Python (from apps/market_dashboard_backend/)
pip install -r requirements.txt
python scripts/build_data.py --out-dir data
python scripts/morning_brief.py --out-dir data        # needs ≥1 of GEMINI/OPENAI/ANTHROPIC keys

# Frontend (from apps/market_dashboard/)
npm install
npm run sync:market          # copy Python output into public/market-dashboard/
npm run skills:check         # warn if synced runtime skill artifacts are stale
npm run skills:sync          # refresh packages/core-skills from the manifest
npm run dev                  # http://localhost:3000 (Turbopack)
npm run build                # must exit 0 before deploying
npx tsc --noEmit             # type-check only
```

---

## 1. Ask Until 95% Confident — Never Assume

**Every Claude run starts here.** Before touching code:

- If below 95% confidence on intent, scope, or approach → **ask**. Keep asking until you reach 95%.
- State assumptions explicitly when you proceed. If multiple interpretations exist, present them — never pick silently.
- A wrong implementation done fast costs more than a clarifying question.

---

## 2. Simplicity First

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

---

## 3. Goal-Driven Execution

Define success criteria. Loop until verified.

| Instead of... | Transform to... |
|---|---|
| "Fix the morning brief" | "`morning_brief.py` runs and emits valid HTML + meta JSON" |
| "Fix the snapshot" | "`snapshot.json` has zero `NaN` and `JSON.parse` succeeds" |
| "Fix the build" | "`npm run build` exits 0" |
| "Fix a bug" | "Write a test that reproduces it, then make it pass" |

---

## 4. Project-Specific Conventions

### Python data pipeline
- Output goes to `--out-dir` (default `data/`). Never hardcode paths.
- Always wrap JSON writes with `sanitize_json()` + `safe_json_dumps()` — bare `NaN` breaks browser `JSON.parse`.
- `data/` and `apps/market_dashboard/public/market-dashboard/` are gitignored locally; CI force-adds with `git add -f`.

### Next.js frontend (15.5 — NOT 16)
- App Router only. Middleware is `src/middleware.ts` (NOT `proxy.ts`).
- After regenerating Python data, run `npm run sync:market`.
- Do not upgrade past 15.x — middleware/auth compatibility breaks.

### AI agents (`apps/market_dashboard/agents/`)
- Lives **outside** `src/` by design.
- `POST /api/analysis` runs `fundamentalsAgent` then `technicalAgent` sequentially.
- Falling back to raw metrics when `DEEPSEEK_API_KEY` is absent is **expected**, not a bug.

### Runtime skills (`packages/core-skills/`)
- Each skill = canonical 7-file folder (`SKILL.md`, `prompt.md`, `knowledge.md`, `schema.json`, TS + Python handlers, `tests/golden.json`).
- Use `/scaffold-skill <name>` to create. Use `/extract-prompt <file> <skill>` to migrate a hardcoded prompt.
- Knowledge bodies are committed runtime artifacts. Refresh them from the authoring wiki/global skills with `npm run skills:sync`, controlled by `packages/core-skills/skill-sync.manifest.json`.
- Run `npm run skills:check` before commits that touch `llm_traders_wiki`, global skill references, or `packages/core-skills`.
- Phase 3 scorer skills are intentionally split by use case: `trader-scorer-market`, `trader-scorer-stock`, and `trader-scorer-trade`.

### Auth (NextAuth v5)
- Roles: `owner` (admin), `allowed`, `pending`, `denied`. `OWNER_EMAIL` is auto-promoted on first sign-in.
- Clerk is removed — do not re-add. `DASHBOARD_PASSWORD` / `AUTH_TOKEN` are dead — do not reference.
- Every `/api/*` route needs an explicit `const session = await auth(); if (!session?.user?.id) return 401` — middleware returns 302 (wrong for AJAX).
- Middleware exclusions: `/login`, `/api/auth/*`, `/market-dashboard/*` (static).

### CI / Vercel
- Workflow `refresh_data.yml`, schedule `00,30 12-18 * * 1-5`, commit message contains `[skip ci]`. Morning brief is `continue-on-error`.
- Vercel project is configured to build `apps/market_dashboard`; app-level `vercel.json` holds the Next.js build settings. After adding env vars, **manually redeploy** — env vars don't apply to existing deployments.

---

## 5. Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | Yes (≥1 brief key) | Morning brief — Gemini 2.5 Pro + Search Grounding |
| `OPENAI_API_KEY` | Optional | Morning brief — GPT-4o + web_search_preview |
| `ANTHROPIC_API_KEY` | Optional | Morning brief — Claude Sonnet 4.6 + web search |
| `GOOGLE_CLIENT_ID` / `_SECRET` | Yes | Google OAuth (NextAuth v5) |
| `AUTH_SECRET` | Yes | NextAuth v5 session signing |
| `DATABASE_URL` | Yes | Postgres (Prisma) |
| `OWNER_EMAIL` | Yes | Auto-promoted to `owner` role |
| `NEXTAUTH_URL` | Yes (prod) | Base URL for internal API calls |
| `DEEPSEEK_API_KEY` | Yes (Phase 5) | AI stock analysis tab + intraday morning verdict regen |
| `BRIEF_INGEST_KEY` | Yes (Phase 5) | Shared secret for `POST /api/morning-verdict/ingest` (cron writes brief rows) |
| `LIVE_QUOTE_INGEST_KEY` | Yes (Phase 5) | Shared secret for `POST /api/live-quotes/ingest` (moomoo daemon + Yahoo fallback) |
| `MOOMOO_OPEND_HOST` | Optional (local-only) | moomoo OpenD host for `live_quote_daemon.py` (default `127.0.0.1`) |
| `MOOMOO_OPEND_PORT` | Optional (local-only) | moomoo OpenD port (default `11111`) |

Never commit `.env.local`. Never log keys. Never hardcode secrets.

---

## 6. Common Pitfalls

| Symptom | Fix |
|---|---|
| `JSON.parse` fails in browser | bare `NaN` — use `safe_json_dumps()` + CI sanitize step |
| numpy `NaN` survives sanitize | use `.item()` on numpy scalars |
| Login fails after env-var change on Vercel | manual redeploy required |
| Vercel cannot see updated wiki/global skill edits | run `npm run skills:sync`, commit `packages/core-skills`, then redeploy |
| Middleware redirects JSON fetches | public path missing from `src/middleware.ts` allow checks + matcher regex |
| `npm install` fails on Vercel | Clerk peer-dep conflict; Clerk is removed — do not re-add |
| Workflow loops forever | missing `[skip ci]` in commit message |
| Morning brief tab errors | `morning_brief_meta.json` not in `public/market-dashboard/` — run brief then `sync:market` |
| Brief provider button greyed | API key missing or `generated: false` in meta |
| OpenAI / Claude brief fails | `pip install openai>=1.70.0` / `anthropic>=0.49.0` |

---

## 7. Subagents — Default to Cheaper Models

**Always prefer a subagent for routine, lower-thinking work.** Spawn via the Agent tool with `model: sonnet` (or `haiku` for trivial lookups). Reserve Opus for complex design, large-diff review, or when Sonnet has visibly underperformed in this session.

**Use prebuilt subagents in `.claude/agents/` over ad-hoc Explore calls:**

| Agent | When to use | Model |
|---|---|---|
| `market-explorer` | "Where is X defined?", route lists, codebase lookups | Sonnet |
| `prompt-extractor` | Phase 3 prompt migration — one prompt at a time | Sonnet |
| `wiki-summarizer` | Composing `knowledge.md` for a runtime skill | Sonnet |

**Slash commands** (`.claude/skills/`):

| Command | Purpose |
|---|---|
| `/scaffold-skill <name>` | Generate 7-file skill folder under `packages/core-skills/` |
| `/sync-data` | `build_data.py` → `morning_brief.py` → `sync:market` → NaN check |
| `/api-route <path>` | Scaffold authenticated API route + middleware update |
| `/safety-check` | Pre-commit gate (Clerk, NaN, legacy auth, build, types) |
| `/extract-prompt <file> <skill>` | Migrate hardcoded prompt into a skill folder |
| `/wiki-sync <skill>` | Refresh runtime skill artifacts through the manifest-backed sync command |

---

## 8. Session Learnings (`.learnings/`, gitignored)

`LEARNINGS.md` (pitfalls), `ERRORS.md` (build/pipeline failures), `FEATURE_REQUESTS.md` (ideas). When an entry recurs 2+ times, promote it manually into the Common Pitfalls table above. **Never** enable a `PostToolUse` hook that pipes Claude stdout into `.learnings/` — tool output can contain key fragments.

---

**Working if:** diffs are minimal, clarifying questions come before implementation, build passes on the first try.
