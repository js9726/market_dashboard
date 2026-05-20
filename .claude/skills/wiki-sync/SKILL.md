---
name: wiki-sync
description: Refresh runtime skill artifacts from the formal skill-sync manifest. Use whenever llm_traders_wiki or mapped global Claude skills change.
---

# wiki-sync

Runtime skill artifacts live in `packages/core-skills/` so the SaaS can deploy without reading local folders. The upstream authoring sources stay in:

- `../llm_traders_wiki/wiki/`
- `C:/Users/jiesh/.claude/skills`

The mapping is defined in:

```bash
packages/core-skills/skill-sync.manifest.json
```

## Commands

Run from `apps/market_dashboard/`:

```bash
npm run skills:check
npm run skills:sync
```

Useful scoped variants:

```bash
npm run skills:check -- --skill trader-primetrading
npm run skills:sync -- --skill trader-scorer-trade
npm run skills:sync -- --list
```

`skills:check` warns when an already-synced runtime artifact is stale versus its upstream source hash. If a runtime file has never been synced, it reports `untracked`; run `skills:sync` once to establish the baseline.

`skills:sync` writes generated `knowledge.md` or `prompt.md` files with embedded metadata. Do not manually edit generated files; edit upstream wiki/global skill sources and sync again.

## Source Resolution

Wiki sources resolve in this order:

1. `LLM_TRADERS_WIKI_ROOT`
2. Sibling folder: `../llm_traders_wiki`
3. Local fallback: `C:/Users/jiesh/AI codes hub/llm_traders_wiki`

Global skill sources resolve in this order:

1. `CLAUDE_SKILLS_ROOT`
2. Local fallback: `C:/Users/jiesh/.claude/skills`

## Current Active Runtime Syncs

- `agent-moderator`
- `trader-primetrading`
- `trader-scorer-market`
- `trader-scorer-stock`
- `trader-scorer-trade`

`morning-brief` is intentionally disabled because it has no upstream wiki source today.

`broker-moomoo` is intentionally planned but disabled until the SaaS broker service exists.

## Rules

- The SaaS runtime must not depend on local `C:/Users/...` paths.
- Vercel receives only committed files under `packages/core-skills/`.
- The wiki/global skills are authoring inputs; runtime artifacts are deployable outputs.
- Keep MooMoo broker logic out of generic trading skills until a tenant-aware broker service exists.
