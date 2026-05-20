import { describe, expect, it } from "vitest";
import {
  AGENT_WEIGHTS,
  runDataAgent,
  runModerator,
  runRiskAgent,
  type AgentReport,
} from "@/lib/analysis/agents";
import type { TickerRow } from "@/types/market-dashboard";

function report(
  agent: AgentReport["agent"],
  verdict: AgentReport["verdict"],
  confidence = 80,
): AgentReport {
  return {
    agent,
    status: "ok",
    verdict,
    confidence,
    headline: "",
    details: [],
  };
}

describe("AGENT_WEIGHTS", () => {
  it("only the three stubs and moderator have zero weight", () => {
    expect(AGENT_WEIGHTS.news).toBe(0);
    expect(AGENT_WEIGHTS.chart).toBe(0);
    expect(AGENT_WEIGHTS.historical).toBe(0);
    expect(AGENT_WEIGHTS.moderator).toBe(0);
    expect(AGENT_WEIGHTS.data).toBeGreaterThan(0);
    expect(AGENT_WEIGHTS.fundamental).toBeGreaterThan(0);
    expect(AGENT_WEIGHTS.technical).toBeGreaterThan(0);
    expect(AGENT_WEIGHTS.risk).toBeGreaterThan(0);
  });
});

describe("runModerator", () => {
  it("BUY when bullish weight clearly dominates", () => {
    const out = runModerator([
      report("data", "bullish", 80),
      report("fundamental", "bullish", 80),
      report("technical", "bullish", 70),
      report("risk", "bullish", 80),
    ]);
    expect(out.verdict).toBe("BUY");
    expect(out.confidence).toBeGreaterThan(20);
  });

  it("PASS when bearish weight clearly dominates", () => {
    const out = runModerator([
      report("data", "bearish", 90),
      report("fundamental", "bearish", 90),
      report("technical", "bearish", 90),
      report("risk", "bearish", 80),
    ]);
    expect(out.verdict).toBe("PASS");
  });

  it("HOLD when signals are mixed", () => {
    const out = runModerator([
      report("data", "bullish", 70),
      report("technical", "bearish", 70),
      report("risk", "neutral", 60),
    ]);
    expect(out.verdict).toBe("HOLD");
  });

  it("HOLD with 0 confidence when no agent produces a signal", () => {
    const out = runModerator([
      report("data", "unknown", 0),
      report("news", "unknown", 0),
    ]);
    expect(out.verdict).toBe("HOLD");
    expect(out.confidence).toBe(0);
  });

  it("stub agents (news/chart/historical) do NOT sway the verdict", () => {
    const reports: AgentReport[] = [
      report("news", "bullish", 100),
      report("chart", "bullish", 100),
      report("historical", "bullish", 100),
      report("risk", "neutral", 30),
    ];
    const out = runModerator(reports);
    // All bullish votes from stubs should be ignored — risk neutral keeps it HOLD.
    expect(out.verdict).toBe("HOLD");
  });
});

describe("runDataAgent", () => {
  function ticker(overrides: Partial<TickerRow>): TickerRow {
    return {
      ticker: "AAPL",
      daily: 0,
      intra: 0,
      "5d": 0,
      "20d": 0,
      atr_pct: 1.5,
      dist_sma50_atr: 0,
      rs: 50,
      rs_chart: null,
      long: [],
      short: [],
      abc: "B",
      rvol: 1,
      off_52w_high_pct: -5,
      ...overrides,
    };
  }

  it("skipped when ticker not in snapshot", () => {
    const out = runDataAgent("NOPE", null);
    expect(out.status).toBe("skipped");
    expect(out.verdict).toBe("unknown");
  });

  it("bullish on a clean up day", () => {
    const out = runDataAgent("AAPL", ticker({ daily: 2.0, dist_sma50_atr: 1.0, rs: 75 }));
    expect(out.verdict).toBe("bullish");
    expect(out.confidence).toBeGreaterThan(20);
  });

  it("bearish on a sharp down day", () => {
    const out = runDataAgent("AAPL", ticker({ daily: -2.5 }));
    expect(out.verdict).toBe("bearish");
  });

  it("bearish below the 50-SMA in ATR units", () => {
    const out = runDataAgent("AAPL", ticker({ daily: 0.2, dist_sma50_atr: -1.5 }));
    expect(out.verdict).toBe("bearish");
  });
});

describe("runRiskAgent", () => {
  it("skipped when price or ATR missing", () => {
    expect(runRiskAgent("AAPL", null).status).toBe("skipped");
    expect(runRiskAgent("AAPL", { price: 0, atrPct: 1 }).status).toBe("skipped");
    expect(runRiskAgent("AAPL", { price: 100, atrPct: 0 }).status).toBe("skipped");
  });

  it("bullish in a clean ATR band (1.5–5%)", () => {
    const out = runRiskAgent("AAPL", { price: 100, atrPct: 2 });
    expect(out.verdict).toBe("bullish");
    expect((out.metrics?.shares as number) ?? 0).toBeGreaterThan(0);
  });

  it("bearish when ATR > 8% (too volatile to size cleanly)", () => {
    const out = runRiskAgent("AAPL", { price: 100, atrPct: 10 });
    expect(out.verdict).toBe("bearish");
  });

  it("stop is exactly 2 × ATR below entry", () => {
    const out = runRiskAgent("AAPL", { price: 100, atrPct: 2 });
    expect(out.metrics?.stop).toBe(96);
  });

  it("target is rMultiple × (entry - stop) above entry", () => {
    const out = runRiskAgent("AAPL", { price: 100, atrPct: 2, rMultiple: 3 });
    expect(out.metrics?.target).toBe(112); // 100 + 3 * (100 - 96) = 112
  });
});
