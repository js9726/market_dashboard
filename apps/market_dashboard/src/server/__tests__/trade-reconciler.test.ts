import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  accountFindMany: vi.fn(),
  positionFindMany: vi.fn(),
  recordFindMany: vi.fn(),
  fillFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    userBrokerAccount: { findMany: db.accountFindMany },
    position: { findMany: db.positionFindMany },
    tradeRecord: { findMany: db.recordFindMany },
    tradeFill: { findMany: db.fillFindMany },
  },
}));

import { reconcileBrokerTrades } from "../trade-reconciler";

/** One closed round trip (buy then sell) for a ticker. */
function roundTrip(ticker: string, day: number) {
  const at = (hour: number) => new Date(`2026-10-${String(day).padStart(2, "0")}T${hour}:00:00.000Z`);
  const base = { ticker, qty: 5, fees: 1, currency: "USD", tradeRecordId: null };
  return [
    { ...base, id: `${ticker}-buy`, side: "BUY", price: 100, executedAt: at(14) },
    { ...base, id: `${ticker}-sell`, side: "SELL", price: 110, executedAt: at(19) },
  ];
}

/** Tickers whose journal candidates were queried (one query per walked ticker). */
const walkedTickers = () =>
  db.recordFindMany.mock.calls
    .map(([args]) => args.where?.ticker)
    .filter((ticker): ticker is string => typeof ticker === "string");

describe("reconcileBrokerTrades ticker scope", () => {
  beforeEach(() => {
    for (const mock of Object.values(db)) mock.mockReset();
    db.accountFindMany.mockResolvedValue([{ id: "acct-1", userId: "owner", alias: "moomoo Malaysia" }]);
    db.positionFindMany.mockResolvedValue([]);
    db.recordFindMany.mockResolvedValue([]);
    db.fillFindMany.mockResolvedValue([
      ...roundTrip("US.NET", 1),
      ...roundTrip("US.AAPL", 2),
      ...roundTrip("US.PLTR", 16),
    ]);
  });

  it("walks every ticker when no scope is given", async () => {
    const report = await reconcileBrokerTrades({ brokerAccountId: "acct-1", dryRun: true });

    expect(walkedTickers()).toEqual(["NET", "AAPL", "PLTR"]);
    expect(report.episodesClosed).toBe(3);
    expect(report.deferredTickers).toEqual([]);
  });

  it("walks only the scoped tickers, matching broker-prefixed and plain forms", async () => {
    const report = await reconcileBrokerTrades({
      brokerAccountId: "acct-1",
      dryRun: true,
      tickers: ["US.PLTR", "net"],
    });

    expect(walkedTickers()).toEqual(["NET", "PLTR"]);
    expect(report.episodesClosed).toBe(2);
    expect(report.actions.join("\n")).not.toContain("AAPL");
  });

  it("defers tickers it has not started once the deadline has passed", async () => {
    const report = await reconcileBrokerTrades({
      brokerAccountId: "acct-1",
      dryRun: true,
      tickers: ["US.NET", "US.PLTR"],
      deadline: Date.now() - 1,
    });

    expect(walkedTickers()).toEqual([]);
    expect(report.episodesClosed).toBe(0);
    expect(report.deferredTickers).toEqual(["NET", "PLTR"]);
  });
});
