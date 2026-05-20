import { describe, expect, it } from "vitest";
import { COMPOSITE_WEIGHTS, computeComposite } from "@/lib/profile/composite";
import { RANK_MIN_TRADES } from "@/lib/profile/tiers";

const base = {
  closedTrades: 50,
  wins: 30,
  totalPnl: 5_000,
  maxDrawdownPct: 0.08,
  pnlStdDevPct: 0.10,
};

describe("computeComposite", () => {
  it("returns unranked when below RANK_MIN_TRADES", () => {
    const out = computeComposite({ ...base, closedTrades: RANK_MIN_TRADES - 1, wins: 5 });
    expect(out.score).toBeNull();
    expect(out.tier).toBe("unranked");
    expect(out.components.winRate).not.toBeNull();
  });

  it("scores a solid trader in the diamond/masters range", () => {
    const out = computeComposite(base);
    expect(out.score).not.toBeNull();
    // 60% win, 8% DD, 10% stddev, $5k PnL → comfortably mid-tier
    expect(out.score!).toBeGreaterThan(50);
    expect(out.score!).toBeLessThan(95);
  });

  it("weights sum to 1.0", () => {
    const total =
      COMPOSITE_WEIGHTS.winRate +
      COMPOSITE_WEIGHTS.drawdown +
      COMPOSITE_WEIGHTS.consistency +
      COMPOSITE_WEIGHTS.pnl;
    expect(total).toBeCloseTo(1.0, 6);
  });

  it("penalises a big drawdown more than a low win-rate (per design)", () => {
    const lowWinRate = computeComposite({ ...base, wins: 20 });            // 40% wins
    const bigDrawdown = computeComposite({ ...base, maxDrawdownPct: 0.20 }); // 20% DD
    expect(bigDrawdown.score).toBeLessThan(lowWinRate.score!);
  });

  it("never returns negative or > 100", () => {
    const terrible = computeComposite({
      closedTrades: 20,
      wins: 0,
      totalPnl: -10_000,
      maxDrawdownPct: 1.0,
      pnlStdDevPct: 1.0,
    });
    expect(terrible.score!).toBeGreaterThanOrEqual(0);

    const elite = computeComposite({
      closedTrades: 500,
      wins: 450,
      totalPnl: 1_000_000,
      maxDrawdownPct: 0.01,
      pnlStdDevPct: 0.02,
    });
    expect(elite.score!).toBeLessThanOrEqual(100);
    expect(elite.tier).toBe("legend");
  });

  it("rounds score to one decimal", () => {
    const out = computeComposite(base);
    expect(out.score).toBe(Math.round(out.score! * 10) / 10);
  });

  it("zero P&L still scores via win-rate + drawdown + consistency", () => {
    const out = computeComposite({ ...base, totalPnl: 0 });
    expect(out.components.pnlScore).toBe(0);
    expect(out.score).not.toBeNull();
    expect(out.score!).toBeGreaterThan(0);
  });
});
