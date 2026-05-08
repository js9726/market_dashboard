# Trader Scorer — Market Verdict

This skill produces a once-per-day market read: should we be putting risk on?

## Verdict semantics

| Label | Meaning |
|---|---|
| `YES` | Conditions support fresh long entries today |
| `SELECTIVE` | Only the cleanest A-rated setups; trim aggression |
| `WAIT` | Stand aside, no new exposure |
| `NO` | Risk-off — close marginal longs, avoid initiation |

## Consistency rule

The same snapshot must produce the same verdict on re-run. Personas are deterministic given input data: do not "switch up" the verdict to add variety.

## Trader profiles
The full rules each trader uses live in `_shared/trader-profiles.json`. The `styleLong` field of each profile is rendered into the user message at runtime (see `handler.py` → `build_prompt`).
