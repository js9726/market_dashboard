---
name: agent-moderator
description: Role-based 5-agent analysis pipeline (Data, Technical, Chart, Risk, Moderator) for a single trade or ticker. v0 simulates all 5 agents in one LLM call; later split into a streamed pipeline.
when-to-use: When the user wants a role-based agent verdict on a trade ("Agent Pipeline" toggle on the Review modal) or a forward-looking signal on a ticker. Distinct from `trader-scorer-trade` which uses 7 trader personas.
---

# Agent Moderator (v0 — single-call simulation)

Role-based alternative to the 7-trader-persona scorer. The LLM plays five specialist roles in sequence and a Moderator synthesizes a final BUY / SELL / HOLD verdict with entry / stop / target.

## Modes

- **mode = "trade"** — review a closed or open trade retrospectively. Output includes a `lesson` field for the Journal.
- **mode = "stock"** — forward-looking analysis on a ticker for the Scanner. Output includes `entry / stop / target` levels.

## Inputs

See `schema.json` → `input`. Same superset as `trader-scorer-trade`'s input shape, plus a `mode` discriminator and a snapshot block (price, technicals) injected by the caller.

## Outputs

See `schema.json` → `output`. JSON object:

```json
{
  "ticker": "...",
  "agents": {
    "data":      { "summary": "...", "facts": { ... } },
    "technical": { "summary": "...", "indicators": { ... } },
    "chart":     { "summary": "...", "pattern": "...", "levels": { ... } },
    "risk":      { "summary": "...", "suggested_size_pct": 0, "rr": 0, "status": "approved|warn|reject" }
  },
  "moderator": {
    "signal":     "BUY | SELL | HOLD",
    "confidence": 0,
    "consensus":  "X/4",
    "entry":      0,
    "stop":       0,
    "target":     0,
    "reasoning":  "...",
    "lesson":     "..." // mode=trade only
  }
}
```

## Knowledge source

- `knowledge.md` — agent role definitions, indicator interpretation rules, and BUY/SELL/HOLD heuristics.
- The skill does NOT read `_shared/trader-profiles.json` — this is a deliberately distinct review style.

## Future split

In Phase 4 PR 4, each agent becomes its own skill (`agent-data`, `agent-technical`, `agent-chart`, `agent-risk`) and this skill becomes the Moderator-only step that consumes the four feeder outputs. The output schema stays the same.
