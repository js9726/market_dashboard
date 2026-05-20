---
name: api-route
description: Scaffold a new authenticated Next.js API route with the explicit auth() check (LRN-004) and middleware matcher updates (LRN-002). Use when adding any /api/* endpoint.
---

# api-route

Generate a new App Router API route with auth boilerplate baked in. The two recurring bugs this prevents:

- **LRN-004**: middleware returns 302 redirect for unauthenticated AJAX calls (wrong — clients expect 401 JSON). Every route MUST have its own `auth()` check.
- **LRN-002**: routes outside the middleware matcher exclusion list silently get redirected. Routes that should be public (static files, webhooks) need explicit allow checks in `src/middleware.ts` plus matcher coverage.

## Invocation

`/api-route <path>` — e.g., `/api-route journal/import`

## Steps

1. **Validate** the path is non-empty, kebab-case segments, doesn't already exist at `apps/market_dashboard/src/app/api/<path>/route.ts`.

2. **Ask the user** (one question, multi-choice):
   - Is this route **authenticated** (default, requires session) or **public** (webhook, health check, etc.)?
   - Which methods? (GET / POST / PATCH / DELETE — multi-select)

3. **Generate** `apps/market_dashboard/src/app/api/<path>/route.ts`:

### Authenticated route template
```typescript
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export async function <METHOD>(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // TODO: implement
  return NextResponse.json({ ok: true });
}
```

(Repeat the function block for each selected method.)

### Public route template
```typescript
import { NextResponse } from "next/server";

export async function <METHOD>(req: Request) {
  // TODO: implement (no auth — publicly accessible)
  return NextResponse.json({ ok: true });
}
```

4. **If public**: open `apps/market_dashboard/src/middleware.ts` and:
   - Add a path-prefix allow check beside the existing `/login` and `/api/auth` allow checks.
   - Update the `matcher` regex if needed (it currently excludes `market-dashboard` and `*.png`; add the new prefix to the negative-lookahead group).
   - Print a diff before applying.

5. **Print** the new route's URL, the methods supported, and a curl smoke-test command:
   ```bash
   curl -X POST http://localhost:3000/api/<path> -H "Cookie: <session>" -d '{}'
   ```

## Don'ts

- Don't add request body validation (no zod) unless the user asks — keep the scaffold minimal.
- Don't add CORS headers — Vercel + Next.js handle same-origin by default.
- Don't catch errors with try/blanket-500 — let Next.js surface them in dev; add targeted handling per route as needed.

## Reference
- `.learnings/LEARNINGS.md` LRN-002, LRN-004
- Existing example: `apps/market_dashboard/src/app/api/journal/stats/route.ts` (good pattern to mirror)
