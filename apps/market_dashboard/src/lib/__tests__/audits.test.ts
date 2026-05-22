import { describe, expect, it } from "vitest";
import { parseAudit } from "@/lib/wiki/audits";

const SAMPLE = `# Audit Report — 2025-07

**Trades reviewed**: 6
**Match grades**: A=2, B=2, C=2
**Drift cases**: 2

## Grade A

- ANET 2025-07-03: +11.2% in 14d — Target $113.00 reached (high $114.60); stop held
- ON 2025-07-09: +1.1% in 14d — Target $62.45 reached (high $63.63); stop held

## Grade B

- CRCL 2025-07-15: -15.6% in 14d — Stop $200.45 hit at low $154.50; close $164.82 (-15.6%) — stop protected from further loss
- SYF 2025-07-21: -0.0% in 14d — Stop $67.00 hit at low $66.28; close $69.43 (-0.0%) — stop protected from further loss

## Grade C

- SMTC 2025-07-15: +7.5% in 14d — Whipsaw: stop $47.74 breached at low $46.57 but close $51.69 (+7.5%) above entry — stop too tight
- DAL 2025-07-23: +4.4% in 14d — Whipsaw: stop $53.76 breached at low $50.45 but close $58.44 (+4.4%) above entry — stop too tight

## Suggested wiki updates (Safe-mode)

- \`rubric-stop-too-tight\`: Predicted stop $47.74 would have whipsawed out of a +7.5% recoverable trade (trade: SMTC 2025-07-15)
- \`rubric-stop-too-tight\`: Predicted stop $53.76 would have whipsawed out of a +4.4% recoverable trade (trade: DAL 2025-07-23)
`;

describe("parseAudit", () => {
  it("extracts preamble metadata", () => {
    const r = parseAudit(SAMPLE, "2025-07");
    expect(r.period).toBe("2025-07");
    expect(r.tradesReviewed).toBe(6);
    expect(r.gradeCounts).toEqual({ A: 2, B: 2, C: 2 });
    expect(r.driftCases).toBe(2);
  });

  it("extracts all 6 trade rows with correct grade + pct", () => {
    const r = parseAudit(SAMPLE, "2025-07");
    expect(r.trades).toHaveLength(6);
    const byTicker = Object.fromEntries(r.trades.map((t) => [t.ticker, t]));
    expect(byTicker.ANET.grade).toBe("A");
    expect(byTicker.ANET.pctIn14d).toBeCloseTo(11.2);
    expect(byTicker.CRCL.grade).toBe("B");
    expect(byTicker.CRCL.pctIn14d).toBeCloseTo(-15.6);
    expect(byTicker.SMTC.grade).toBe("C");
    expect(byTicker.DAL.outcome).toContain("Whipsaw");
  });

  it("extracts both suggestions with matching rubric keys", () => {
    const r = parseAudit(SAMPLE, "2025-07");
    expect(r.suggestions).toHaveLength(2);
    expect(r.suggestions[0].rubric).toBe("rubric-stop-too-tight");
    expect(r.suggestions[0].reason).toContain("SMTC");
    expect(r.suggestions[1].reason).toContain("DAL");
  });

  it("reports no warnings on clean input", () => {
    const r = parseAudit(SAMPLE, "2025-07");
    expect(r.warnings).toEqual([]);
  });

  it("handles missing sections without throwing", () => {
    const minimal = "# Audit Report — 2026-04\n\n**Trades reviewed**: 0\n";
    const r = parseAudit(minimal, "2026-04");
    expect(r.tradesReviewed).toBe(0);
    expect(r.trades).toEqual([]);
    expect(r.suggestions).toEqual([]);
  });

  it("flags malformed bullets as warnings instead of crashing", () => {
    const bad = `# Audit Report — 2025-08

## Grade A
- this is not a valid trade row

## Suggested wiki updates
- not-a-rubric-line
`;
    const r = parseAudit(bad, "2025-08");
    expect(r.trades).toEqual([]);
    expect(r.suggestions).toEqual([]);
    expect(r.warnings.length).toBeGreaterThanOrEqual(2);
  });
});
