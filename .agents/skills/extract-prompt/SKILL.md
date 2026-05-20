---
name: extract-prompt
description: Pull a hardcoded LLM prompt out of a source file (Python or TypeScript) into a runtime skill's prompt.md, then replace the call site with a thin handler call. Use during Phase 3 prompt migration.
---

# extract-prompt

Migrates one prompt at a time from inline source-code strings to the canonical skill folder.

## Invocation

`/extract-prompt <source-file> <skill-name>` — e.g.,
`/extract-prompt apps/market_dashboard/agents/fundamental/capability.ts fundamental-analysis`

## Steps

1. **Read** the source file. Identify every prompt block:
   - Python: triple-quoted strings, f-strings used as system/user messages
   - TypeScript: backtick template literals, `.role/.content` patterns

2. **For each prompt**, prompt the user to confirm:
   - Is this a **system** prompt or a **user** prompt?
   - What's the placeholder set? (Detect `{var}` / `${var}` automatically and confirm.)

3. **Verify** `packages/core-skills/<skill-name>/` exists. If not, run `/scaffold-skill <skill-name>` first and abort with that message.

4. **Write to `prompt.md`**: place user-message templates here, normalizing placeholders to single-brace lower/camel case (`{ticker}`, `{date_str}`, `{schema_example}`), matching `prompt-loader.ts` and `prompt_loader.py`.

5. **Write to `knowledge.md`**: place the system-prompt body (long, stable instructions and trader-style descriptions). This is what gets prompt-cached.

6. **Replace the source call site** with a handler import:
   - TypeScript: `import { run } from "@core-skills/<name>/handler"` and `await run({ ...inputs })`.
   - Python: `from core_skills.<name>.handler import run` and `run({...}, llm_call=callLLM)`.

7. **Snapshot test**: run the original code path once before edits, capture output, run new code path, diff. Must be byte-equal for the same input. Print the diff if not.

## Special cases

### morning_brief.py (lines 134–224)
The prompt has 3 large constants embedded — `BRIEF_CSS`, `TRADER_STYLES`, `HTML_STRUCTURE_GUIDE`. Move all three to `knowledge.md` if they are used as stable system context, or keep them in `prompt.md` when byte-equivalent HTML output requires it. Use placeholders `{date_str}`, `{watchlist_str}`.

### trader scorer split
Trader scoring is intentionally split by surface:
- `trader-scorer-market` for daily market verdicts from `trader_verdict.py`
- `trader-scorer-stock` for stock-view analysis
- `trader-scorer-trade` for individual trade review

All three reference the 6 trader profiles from `packages/core-skills/_shared/trader-profiles.json` (single source of truth).

### Multi-provider prompts (morning_brief.py, trader_verdict.py)
These call Gemini, OpenAI, AND Codex with the same prompt. Keep ONE `prompt.md` — provider selection is a handler concern, not a prompt concern.

## Output

Print:
```
Extracted: <prompt name> (<line range>)
  → packages/core-skills/<skill>/prompt.md
  → packages/core-skills/<skill>/knowledge.md  (if system-style)

Replaced call site at <source-file>:<line>
Snapshot diff: [identical | <N> char differences shown]

Next: run skill golden test → packages/core-skills/<skill>/tests/
```

## Reference
- Plan: `C:\Users\jiesh\.Codex\plans\locked-in-at-95-lexical-galaxy.md` § 8 Phase 3
- 14-prompt inventory: see plan § 9 (critical files reference)
