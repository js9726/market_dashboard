# CLAUDE.md

Behavioral guidelines for AI-assisted development on this repo. Applies to all sub-projects
(`apps/market_dashboard`, `apps/usStockChatBot`, `packages/usChatBot-DataPipeline`).

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

---

## Project Overview

| Layer | Path | Stack |
|---|---|---|
| Data Pipeline | `apps/market_dashboard/scripts/` | Python, yfinance, Finviz, requests, BeautifulSoup |
| Morning Brief | `apps/market_dashboard/scripts/morning_brief.py` | Gemini 2.5 Pro via REST API |
| Frontend | `apps/usStockChatBot/` | Next.js 15.5, TypeScript, Tailwind, Recharts |
| Auth | `apps/usStockChatBot/src/middleware.ts` | Cookie-based password auth (no Clerk) |
| Automation | `.github/workflows/refresh_data.yml` | GitHub Actions (Mon–Fri 8:30 AM ET / 12:30 UTC) |
| Deployment | `vercel.json` | Vercel (rootDirectory: `apps/usStockChatBot`) |

### Key Data Flow

```
build_data.py → data/snapshot.json + data/charts/*.png
morning_brief.py → data/morning_brief.md
sync step (CI or npm run sync:market) → public/market-dashboard/
Vercel serves static files from public/
```

---

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

---

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: *"Would a senior engineer say this is overcomplicated?"* If yes, simplify.

---

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that **your** changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: every changed line should trace directly to the user's request.

---

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

| Instead of... | Transform to... |
|---|---|
| "Fix the morning brief" | "Run `morning_brief.py` and confirm `data/morning_brief.md` is valid Markdown" |
| "Fix the snapshot" | "Confirm `snapshot.json` has zero `NaN` tokens and `JSON.parse` succeeds" |
| "Fix the build" | "Run `npm run build` and confirm exit code 0" |
| "Fix a bug" | "Write a test that reproduces it, then make it pass" |

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

## 5. Project-Specific Conventions

### Python (Data Pipeline)
- Scripts live in `apps/market_dashboard/scripts/`.
- Output always goes to `--out-dir` (default: `data/`). Never hardcode paths.
- `build_data.py` runs before `morning_brief.py` — they are sequential, not parallel.
- The `data/` folder is gitignored; `public/market-dashboard/` in the Next.js app is also gitignored locally.
- In CI, use `git add -f apps/usStockChatBot/public/market-dashboard` to force-add data files.
- Use `requirements.txt` for dependencies — no Poetry, no conda.
- Always call `sanitize_json()` + `safe_json_dumps()` when writing JSON — Python's `json.dump` emits bare `NaN` which JavaScript cannot parse.

### Next.js Frontend (Next.js 15.5 — NOT 16)
- App Router only (`src/app/`). No Pages Router patterns.
- Middleware file is `src/middleware.ts` — NOT `proxy.ts` (that is Next.js 16 only).
- API routes live under `src/app/api/`.
- Environment variables: use `.env.local` locally; never commit secrets.
- Run `npm run sync:market` after regenerating Python data to copy into `public/`.
- Do not upgrade Next.js past 15.x without verifying all middleware/auth compatibility.

### Auth
- Auth is cookie-based: `DASHBOARD_PASSWORD` checked at login, `AUTH_TOKEN` stored as httpOnly cookie.
- Clerk has been removed — do not re-add it.
- Middleware excludes `/market-dashboard/*` so static JSON/PNG files are served without a session.

### GitHub Actions
- Workflow: `.github/workflows/refresh_data.yml`
- Schedule: `30 12 * * 1-5` (Mon–Fri 12:30 UTC = 8:30 AM ET)
- Required secret: `GEMINI_API_KEY` (for `morning_brief.py`)
- Morning brief failure is non-fatal (`continue-on-error: true`) — data still updates.
- Commit step uses `[skip ci]` in message to prevent infinite trigger loops.

### Vercel
- Root directory is `apps/usStockChatBot` — set via `vercel.json` at repo root.
- Required env vars in Vercel dashboard: `DASHBOARD_PASSWORD`, `AUTH_TOKEN`.
- After adding env vars in Vercel, always trigger a **manual redeploy** — env vars don't apply to existing deployments.

---

## 6. Environment Variables Reference

| Variable | Where set | Required | Purpose |
|---|---|---|---|
| `GEMINI_API_KEY` | GitHub Secret + `.env.local` | Yes | Gemini 2.5 Pro morning brief |
| `DASHBOARD_PASSWORD` | Vercel + `.env.local` | Yes | Login password for dashboard |
| `AUTH_TOKEN` | Vercel + `.env.local` | Yes | httpOnly session cookie value |
| `DEEPSEEK_API_KEY` | `.env.local` / Vercel | Optional | AI stock analysis tab |

Never commit `.env.local`. Never log API keys. Never hardcode secrets in `.bat` files or scripts.

---

## 7. Common Pitfalls

| Symptom | Root Cause | Fix |
|---|---|---|
| `JSON.parse` fails in browser | `snapshot.json` contains bare `NaN` | Use `safe_json_dumps()` + CI sanitize step |
| Login fails on Vercel | Env vars added but no redeploy triggered | Redeploy manually from Vercel dashboard |
| Middleware redirects JSON fetches | `/market-dashboard` not excluded from matcher | Add to `PUBLIC_PATHS` and matcher regex |
| `npm install` fails on Vercel | Clerk peer dep conflict with Next.js 16 | Clerk removed; do not re-add |
| Workflow commits loop forever | Missing `[skip ci]` in commit message | Already fixed — don't remove it |
| numpy `NaN` survives sanitize | `isinstance(obj, float)` misses `np.float64` | Use `.item()` on numpy scalars |

---

**These guidelines are working if:** diffs are clean and minimal, clarifying questions come before implementation, and the build passes on the first try.
