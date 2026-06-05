import { describe, expect, it } from "vitest";
import { coerceScore, extractOverallScore } from "@/lib/generate-trade-verdict";
import { activeTradePriority } from "@/lib/trades/position-trade-records";

describe("trade review scoring", () => {
  it("coerces DeepSeek string scores into numeric grade values", () => {
    expect(coerceScore("4.7")).toBe(4.7);
    expect(coerceScore("score 7.25 / 10")).toBe(7.3);
    expect(coerceScore(6)).toBe(6);
    expect(coerceScore("not scored")).toBeNull();
  });

  it("extracts trader-debate overall_score even when returned as a string", () => {
    expect(extractOverallScore({ overall_score: "5.8" }, "trader-debate")).toBe(5.8);
  });

  it("normalizes agent-pipeline confidence to the 0-10 badge scale", () => {
    expect(extractOverallScore({ moderator: { confidence: 72 } }, "agent-pipeline")).toBe(7.2);
  });
});

describe("trade row priority", () => {
  it("keeps live, open, and semi-open rows above closed rows", () => {
    const rows = [
      { state: "CLOSE", pnl: -1 },
      { state: "SEMI-OPEN", pnl: 1 },
      { state: "OPEN", pnl: null },
      { source: "LIVE", state: "OPEN", pnl: null },
    ];

    expect(rows.map(activeTradePriority)).toEqual([4, 2, 1, 0]);
  });
});
