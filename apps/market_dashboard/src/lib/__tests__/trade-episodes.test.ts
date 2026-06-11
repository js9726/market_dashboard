import { describe, expect, it } from "vitest";
import {
  buildEpisodes,
  pickCanonical,
  plainTicker,
  type CanonicalCandidate,
  type FillLike,
} from "../trade-episodes";

let fillSeq = 0;
function fill(partial: Partial<FillLike> & { side: string; qty: number; price: number; at: string }): FillLike {
  return {
    id: partial.id ?? `f${++fillSeq}`,
    ticker: partial.ticker ?? "US.MCHP",
    side: partial.side,
    qty: partial.qty,
    price: partial.price,
    fees: partial.fees ?? 0,
    currency: partial.currency ?? null,
    executedAt: new Date(partial.at),
    tradeRecordId: partial.tradeRecordId ?? null,
  };
}

describe("plainTicker", () => {
  it("strips market prefixes and uppercases", () => {
    expect(plainTicker("US.MCHP")).toBe("MCHP");
    expect(plainTicker("hk.00700")).toBe("00700");
    expect(plainTicker("mchp")).toBe("MCHP");
  });
});

describe("buildEpisodes", () => {
  it("reproduces the MCHP history: two closed episodes with broker-true P&L", () => {
    const fills = [
      fill({ side: "BUY", qty: 10, price: 78.92, fees: 2.27, at: "2026-04-20T10:55:32Z" }),
      fill({ side: "SELL", qty: 10, price: 90.87, fees: 2.33, at: "2026-04-23T20:26:57Z" }),
      fill({ side: "BUY", qty: 9, price: 97.4, fees: 1.9029, at: "2026-06-04T10:32:23Z" }),
      fill({ side: "BUY", qty: 5, price: 97.4, fees: 1.0571, at: "2026-06-04T10:32:24Z" }),
      fill({ side: "SELL", qty: 14, price: 93.2, fees: 2.96, at: "2026-06-05T09:30:03Z" }),
    ];
    const eps = buildEpisodes(fills);
    expect(eps).toHaveLength(2);

    expect(eps[0].closedAt).not.toBeNull();
    expect(eps[0].buyQty).toBe(10);
    expect(eps[0].realized).toBeCloseTo(10 * 90.87 - 10 * 78.92 - 4.6, 2);

    expect(eps[1].closedAt?.toISOString()).toBe("2026-06-05T09:30:03.000Z");
    expect(eps[1].buyQty).toBe(14);
    expect(eps[1].avgBuy).toBeCloseTo(97.4, 4);
    expect(eps[1].avgSell).toBeCloseTo(93.2, 4);
    expect(eps[1].realized).toBeCloseTo(14 * 93.2 - 14 * 97.4 - 5.92, 2);
    expect(eps[1].usdSafe).toBe(true); // US.* ticker, no currency tag
  });

  it("handles partial trims as one episode with weighted exit", () => {
    const eps = buildEpisodes([
      fill({ side: "BUY", qty: 30, price: 10, at: "2026-05-01T14:00:00Z" }),
      fill({ side: "SELL", qty: 10, price: 12, at: "2026-05-02T14:00:00Z" }),
      fill({ side: "SELL", qty: 20, price: 15, at: "2026-05-05T14:00:00Z" }),
    ]);
    expect(eps).toHaveLength(1);
    expect(eps[0].closedAt).not.toBeNull();
    expect(eps[0].avgSell).toBeCloseTo((10 * 12 + 20 * 15) / 30, 6);
    expect(eps[0].realized).toBeCloseTo(10 * 12 + 20 * 15 - 30 * 10, 2);
  });

  it("splits a re-entry after flat into a second (open) episode", () => {
    const eps = buildEpisodes([
      fill({ side: "BUY", qty: 5, price: 100, at: "2026-05-01T14:00:00Z" }),
      fill({ side: "SELL", qty: 5, price: 110, at: "2026-05-03T14:00:00Z" }),
      fill({ side: "BUY", qty: 8, price: 120, at: "2026-05-10T14:00:00Z" }),
    ]);
    expect(eps).toHaveLength(2);
    expect(eps[0].closedAt).not.toBeNull();
    expect(eps[1].closedAt).toBeNull();
    expect(eps[1].realized).toBeNull();
    expect(eps[1].buyQty).toBe(8);
  });

  it("marks non-USD fills usdSafe=false", () => {
    const eps = buildEpisodes([
      fill({ ticker: "HK.00700", currency: "HKD", side: "BUY", qty: 100, price: 300, at: "2026-05-01T02:00:00Z" }),
      fill({ ticker: "HK.00700", currency: "HKD", side: "SELL", qty: 100, price: 310, at: "2026-05-02T02:00:00Z" }),
    ]);
    expect(eps[0].usdSafe).toBe(false);
  });
});

describe("pickCanonical", () => {
  const episode = buildEpisodes([
    fill({ side: "BUY", qty: 14, price: 97.4, at: "2026-06-04T10:32:23Z" }),
    fill({ side: "SELL", qty: 14, price: 93.2, at: "2026-06-05T09:30:03Z" }),
  ])[0];

  function candidate(p: Partial<CanonicalCandidate> & { id: string }): CanonicalCandidate {
    return {
      ticker: "MCHP",
      state: "OPEN",
      source: "SHEET",
      notes: null,
      connectionId: "conn1",
      brokerOrderId: null,
      quantity: 14,
      tradeDate: new Date("2026-06-04T00:00:00Z"),
      executedAt: null,
      platform: "Moo Moo",
      hasVerdict: false,
      ...p,
    };
  }

  it("prefers the user-authored sheet row over the bridge stopgap (MCHP case)", () => {
    const sheet = candidate({ id: "sheet1", state: "CLOSE" });
    const stopgap = candidate({
      id: "stopgap1",
      source: "BRIDGE",
      brokerOrderId: "position:MCHP",
      connectionId: null,
      tradeDate: new Date("2026-06-04T14:32:50Z"),
    });
    expect(pickCanonical([stopgap, sheet], episode)?.id).toBe("sheet1");
  });

  it("falls back to the stopgap when it is the only row", () => {
    const stopgap = candidate({
      id: "stopgap1",
      source: "BRIDGE",
      brokerOrderId: "position:MCHP",
      connectionId: null,
    });
    expect(pickCanonical([stopgap], episode)?.id).toBe("stopgap1");
  });

  it("never matches a record outside the date window (April row vs June episode)", () => {
    const april = candidate({ id: "april", quantity: 10, tradeDate: new Date("2026-04-20T00:00:00Z") });
    expect(pickCanonical([april], episode)).toBeNull();
  });

  it("prefers quantity match within the window", () => {
    const wrongQty = candidate({ id: "wrongQty", quantity: 5 });
    const rightQty = candidate({ id: "rightQty", quantity: 14 });
    expect(pickCanonical([wrongQty, rightQty], episode)?.id).toBe("rightQty");
  });
});
