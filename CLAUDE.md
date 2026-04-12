# CLAUDE.md

Behavioral guidelines for AI-assisted development on this repo. Applies to all sub-projects
(`apps/market_dashboard`, `apps/usStockChatBot`, `packages/usChatBot-DataPipeline`).

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

---

## Project Overview

| Layer | Path | Stack |
|---|---|---|
| Data Pipeline | `apps/market_dashboard/scripts/` | Python, yfinance, Finviz, Anthropic SDK |
| Frontend | `apps/usStockChatBot/` | Next.js 15, TypeScript, Tailwind, Recharts |
| Data Package | `packages/usChatBot-DataPipeline/` | Python scripts |
| Automation | `.github/workflows/refresh_data.yml` | GitHub Actions (Mon–Fri 8:30 AM ET) |
| Deployment | `vercel.json` | Vercel (root dir: `apps/usStockChatBot`) |

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
- "Fix the morning brief" → "Run `morning_brief.py` locally and confirm output is valid Markdown"
- "Fix the chatbot API" → "Hit `/api/analysis` with a test payload and confirm a 200 response"
- "Refactor a component" → "Ensure `npm run build` passes before and after"

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
- The `data/` folder is gitignored; `public/market-dashboard/` in the Next.js app is too.
- Use `requirements.txt` for dependencies — no Poetry, no conda.

### Next.js Frontend
- App Router only (`src/app/`). No Pages Router patterns.
- API routes live under `src/app/api/`.
- AI agents live under `agents/` (not inside `src/`).
- Environment variables: use `.env.local` locally; never commit secrets.
- Run `npm run sync:market` after regenerating Python data to copy it into `public/`.

### GitHub Actions
- The workflow file is `.github/workflows/refresh_data.yml`.
- The only secret needed for the pipeline is `ANTHROPIC_API_KEY`.
- Do not add workflow steps that require interactive input or local-only paths.

### Vercel
- Root directory is `apps/usStockChatBot` — confirm this before adding `vercel.json` config.
- Deployments trigger automatically on push to `main` (via GitHub Actions data commit).

---

## 6. Environment Variables Reference

| Variable | Where | Required | Purpose |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | GitHub Secret / `.env.local` | Yes (brief) | Claude morning brief |
| `DEEPSEEK_API_KEY` | `.env.local` / Vercel | Optional | AI stock analysis tab |
| `APP_PASSWORD` | `.env.local` / Vercel | Yes | Simple password auth |

Never commit `.env.local`. Never log API keys. Never hardcode them in source.

---

**These guidelines are working if:** diffs are clean and minimal, clarifying questions come before implementation, and the build passes on the first try.
