---
name: safety-check
description: Pre-commit safety validation for auth, JSON, secrets, skill-sync drift, types, and production build.
---

# safety-check

Mechanical pre-commit gate. Each check is independent; report all failures instead of stopping at the first one.

Run from `apps/market_dashboard/` unless a command says otherwise.

## Checks

### 1. Runtime skills are not stale

```bash
npm run skills:check
```

Warn if a generated `packages/core-skills/*/knowledge.md` or `prompt.md` is stale versus `packages/core-skills/skill-sync.manifest.json`.

For a hard gate after all mapped skills have a baseline:

```bash
npm run skills:check:strict
```

### 2. No Clerk re-imports

Clerk was removed; do not re-add it.

```bash
rg "from ['\"]@cl[e]rk/" apps/market_dashboard/src packages
```

### 3. No bare NaN in staged JSON

```bash
git diff --cached --name-only | rg "\.json$"
```

For each staged JSON file, reject bare `NaN` outside strings.

### 4. No legacy auth env vars in code

Legacy cookie-auth variables are removed.

```bash
rg "(DASHBOARD[_]PASSWORD|AUTH[_]TOKEN)" apps/market_dashboard/src apps/market_dashboard/scripts
```

### 5. No env files staged

```bash
git diff --cached --name-only | rg '(^|/)\.env(\.|$)'
```

Fail if any `.env*` file is staged.

### 6. Fire-and-forget API review

```bash
rg "void \(async \(\)" apps/market_dashboard/src/app/api
```

Flag matches for human review. Confirm the async block does not call `next/headers` `cookies()` after the response returns.

### 7. Middleware matcher sanity

If `apps/market_dashboard/src/middleware.ts` changed, print the public allow checks and matcher config for human review.

### 8. TypeScript builds

```bash
npx tsc --noEmit
```

### 9. Production build passes

```bash
npm run build
```

## Output

Print a compact table with check name, status, and failing file/line where available. Exit non-zero if any hard failure occurs.

## References

- `.learnings/LEARNINGS.md`
- `market_dashboard/CLAUDE.md`
- `packages/core-skills/skill-sync.manifest.json`
