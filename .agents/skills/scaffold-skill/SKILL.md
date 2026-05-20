---
name: scaffold-skill
description: Generate the canonical 7-file folder for a new runtime skill under packages/core-skills/. Use when adding a new skill that wraps an LLM prompt with knowledge, schema, and dual TS/Python handlers.
---

# scaffold-skill

When invoked with a skill name (e.g. `/scaffold-skill rs-screener`):

1. **Validate** the name is kebab-case, doesn't already exist under `packages/core-skills/`.
2. **Create** the folder `packages/core-skills/<name>/` with these 7 files:

```
<name>/
├── SKILL.md          ← frontmatter + when-to-use (for Codex.ai discovery)
├── prompt.md         ← user-message template w/ {placeholders}
├── knowledge.md      ← system-context body (cached); leave blank if no wiki source
├── schema.json       ← JSON Schema: { "input": {...}, "output": {...} }
├── handler.ts        ← TS runtime
├── handler.py        ← Python runtime
└── tests/golden.json ← frozen [{ input, expectedOutput }] cases
```

3. **Use these templates verbatim** (substitute `<name>` and `<Name>` accordingly):

### SKILL.md template
```markdown
---
name: <name>
description: <one-line purpose — what trader question does this answer?>
when-to-use: <triggers — e.g., "when the user asks about position sizing">
---

# <Name>

<2-3 sentences of what this skill does and what the wiki source is.>

## Inputs
See `schema.json` → `input`.

## Outputs
See `schema.json` → `output`.

## Knowledge source
`<wiki/page.md>` (if applicable). Refresh via `/wiki-sync <name>`.
```

### prompt.md template
```markdown
You are a <role>. Given the input below, produce JSON that conforms to the output schema.

## Input
{input_json}

## Output
Return only JSON, no prose.
```

### handler.ts template
```typescript
import fs from "node:fs";
import path from "node:path";
import { callLLM } from "@/utils/llm-router";

const ROOT = path.join(process.cwd(), "../../packages/core-skills/<name>");
const PROMPT = fs.readFileSync(path.join(ROOT, "prompt.md"), "utf8");
const KNOWLEDGE = fs.readFileSync(path.join(ROOT, "knowledge.md"), "utf8");
const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, "schema.json"), "utf8"));

export async function run(input: unknown) {
  const userMsg = PROMPT.replace("{input_json}", JSON.stringify(input, null, 2));
  const result = await callLLM(userMsg, KNOWLEDGE);
  return JSON.parse(result);
}
```

### handler.py template
```python
import json
from pathlib import Path

ROOT = Path(__file__).parent
PROMPT = (ROOT / "prompt.md").read_text(encoding="utf-8")
KNOWLEDGE = (ROOT / "knowledge.md").read_text(encoding="utf-8")
SCHEMA = json.loads((ROOT / "schema.json").read_text(encoding="utf-8"))

def run(input_data: dict, llm_call) -> dict:
    """llm_call: callable matching (system, user) -> str. Caller injects provider."""
    user_msg = PROMPT.replace("{input_json}", json.dumps(input_data, indent=2))
    raw = llm_call(system=KNOWLEDGE, user=user_msg)
    return json.loads(raw)
```

### schema.json template
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "input": { "type": "object", "properties": {}, "additionalProperties": false },
  "output": { "type": "object", "properties": {}, "additionalProperties": false }
}
```

### tests/golden.json template
```json
[
  { "name": "smoke", "input": {}, "expectedOutput": {} }
]
```

4. **Print** the new folder path and a checklist of what the user must fill in:
   - `prompt.md` body
   - `knowledge.md` (run `/wiki-sync <name>` if there's a matching wiki page)
   - `schema.json` input/output
   - At least one real golden test case

**Do not** scaffold if the folder already exists — abort with a clear message.

## Reference
Plan: `C:\Users\jiesh\.Codex\plans\locked-in-at-95-lexical-galaxy.md` § 4 (Skill Layout) and § 8 Phase 3.
