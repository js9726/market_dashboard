import { describe, expect, it } from "vitest";
import { closedTradesWhere, keysFor, type PivotTradeRow } from "@/server/journal-pivot";

const row = (platform: string): PivotTradeRow => ({
  ticker: "TEST",
  side: "Long",
  strategy: null,
  source: "SHEET",
  platform,
  industry: null,
  currencyCode: "USD",
  currency: "USD",
  pnl: 1,
  pnlUsd: 1,
  tags: [],
  mistakes: [],
  tradeDate: new Date("2026-07-01T00:00:00.000Z"),
  executedAt: null,
  rrr: null,
});

describe("journal pivot query and broker grouping", () => {
  it("groups legacy Moo Moo and Malaysia labels together but not paper", () => {
    expect(keysFor("platform", row("Moo Moo"))).toEqual(["moomoo Malaysia"]);
    expect(keysFor("platform", row("moomoo Malaysia"))).toEqual(["moomoo Malaysia"]);
    expect(keysFor("platform", row("moomoo Paper (SIM)"))).toEqual(["moomoo Paper (SIM)"]);
  });

  it("keeps duplicate exclusion and date bounds in separate AND clauses", () => {
    const from = new Date("2026-06-01T00:00:00.000Z");
    const to = new Date("2026-06-30T23:59:59.999Z");
    const where = closedTradesWhere("user-1", from, to);
    expect(where.AND).toEqual([
      { OR: [{ brokerOrderId: null }, { NOT: { brokerOrderId: { endsWith: ":dup" } } }] },
      { tradeDate: { gte: from, lte: to } },
    ]);
  });
});
