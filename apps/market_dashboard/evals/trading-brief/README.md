# Trading Brief Eval Harness

This folder is the first production-quality gate for the trading brief and Conviction Score workflow. It is intentionally deterministic so it can run in CI without provider secrets.

## Files

- `golden-set.json` is the versioned labeled eval set.
- `baseline-results.json` is a passing handwritten baseline used to prove the gate.
- `../../scripts/eval-trading-brief.mjs` scores candidate outputs against the golden set.

## Result contract

Candidate result files should contain:

```json
{
  "schemaVersion": 1,
  "model": "provider-or-run-name",
  "results": [
    {
      "id": "case-id-from-golden-set",
      "verdict": "GO | WATCH | PASS",
      "convictionScore": 0,
      "setupTags": ["BO-VCP"],
      "riskFlags": ["extended"],
      "brief": "Short rationale with the important rule language."
    }
  ]
}
```

Run the default baseline:

```bash
npm run eval:trading-brief
```

Run against a fresh provider output:

```bash
npm run eval:trading-brief -- --results evals/trading-brief/latest-results.json --min-score 0.8
```

Generate a local eval set from the existing Neon `AListCandidate` rows:

```bash
npm run eval:trading-brief:export-neon
npm run eval:trading-brief -- --cases evals/trading-brief/generated/neon-golden-set.json --results evals/trading-brief/generated/neon-results.json --min-score 0.8
```

Or do both in one command:

```bash
npm run eval:trading-brief:neon
```

The generated Neon files live under `evals/trading-brief/generated/` and are gitignored. They may include real tickers unless you run:

```bash
npm run eval:trading-brief:export-neon -- --anonymize
```

## Expansion path

Grow the set toward 50 labeled setups before relying on it as a serious release gate. The next layer should add an LLM-as-judge rubric for rationale quality, citation quality, and missing-evidence handling, but the deterministic checks should remain as the cheap CI alarm.
