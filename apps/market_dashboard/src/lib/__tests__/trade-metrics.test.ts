import { describe, expect, it } from "vitest";
import {
  compositeInputFromTrades,
  isClosedTradeRecord,
  maxDrawdownFromPnlSequence,
} from "@/lib/profile/trade-metrics";

describe("profile trade metrics", () => {
  it("uses state as the primary closed-trade signal", () => {
    expect(isClosedTradeRecord({ state: "CLOSE", pnl: -10 })).toBe(true);
    expect(isClosedTradeRecord({ state: "OPEN", pnl: 25 })).toBe(false);
    expect(isClosedTradeRecord({ state: "SEMI-OPEN", pnl: 25 })).toBe(false);
    expect(isClosedTradeRecord({ state: "PLANNING", pnl: 25 })).toBe(false);
  });

  it("keeps legacy null-state pnl rows as closed", () => {
    expect(isClosedTradeRecord({ state: null, pnl: 10 })).toBe(true);
    expect(isClosedTradeRecord({ state: null, pnl: null })).toBe(false);
  });

  it("builds composite inputs from closed rows only", () => {
    const input = compositeInputFromTrades([
      { state: "CLOSE", pnl: 100, buyPrice: 10, quantity: 10 },
      { state: "CLOSE", pnl: -50, buyPrice: 10, quantity: 10 },
      { state: "OPEN", pnl: 999, buyPrice: 10, quantity: 10 },
      { state: "PLANNING", pnl: -999, buyPrice: 10, quantity: 10 },
    ]);

    expect(input.closedTrades).toBe(2);
    expect(input.wins).toBe(1);
    expect(input.totalPnl).toBe(50);
  });

  it("does not report zero drawdown for an all-negative equity curve", () => {
    expect(maxDrawdownFromPnlSequence([-100, -50])).toBe(1);
  });
});
