import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  tokenFindUnique: vi.fn(),
  tokenUpdate: vi.fn(),
  accountFindFirst: vi.fn(),
  fillFindMany: vi.fn(),
  fillFindUnique: vi.fn(),
  fillUpdate: vi.fn(),
  fillCreateMany: vi.fn(),
  fillCreate: vi.fn(),
  positionUpsert: vi.fn(),
  positionFindMany: vi.fn(),
  positionDeleteMany: vi.fn(),
  liveQuoteUpsert: vi.fn(),
  equityUpsert: vi.fn(),
  reconcile: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brokerBridgeToken: { findUnique: db.tokenFindUnique, update: db.tokenUpdate },
    userBrokerAccount: { findFirst: db.accountFindFirst },
    tradeFill: {
      findMany: db.fillFindMany,
      findUnique: db.fillFindUnique,
      update: db.fillUpdate,
      createMany: db.fillCreateMany,
      create: db.fillCreate,
    },
    position: { upsert: db.positionUpsert, findMany: db.positionFindMany, deleteMany: db.positionDeleteMany },
    liveQuote: { upsert: db.liveQuoteUpsert },
    equitySnapshot: { upsert: db.equityUpsert },
  },
}));
vi.mock("@/server/trade-reconciler", () => ({ reconcileBrokerTrades: db.reconcile }));

import { POST } from "../route";

const fill = (n: number, ticker = "US.AAA", fees: number | null = 1) => ({
  brokerFillId: `deal-${n}`,
  ticker,
  side: "BUY",
  qty: 1,
  price: 10 + n,
  executedAt: `2026-10-${String(1 + (n % 20)).padStart(2, "0")}T14:30:00.000Z`,
  fees,
  currency: "USD",
});

const position = (ticker: string) => ({ ticker, qty: 10, avgCost: 100, currency: "USD", currentPrice: 101 });

function syncRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/bridge/sync", {
    method: "POST",
    headers: {
      authorization: "Bearer plaintext-token",
      "x-timestamp": String(Math.floor(Date.now() / 1000)),
      "content-type": "application/json",
    },
    body: JSON.stringify({ brokerAccountAlias: "moomoo Malaysia", brokerType: "MOOMOO_FUTUMY", ...body }),
  });
}

/** Rows the batched lookup reports as already stored. */
function stored(...brokerFillIds: string[]) {
  return brokerFillIds.map((brokerFillId) => ({ id: `row-${brokerFillId}`, brokerFillId, fees: 1 }));
}

describe("POST /api/bridge/sync", () => {
  beforeEach(() => {
    for (const mock of Object.values(db)) mock.mockReset();
    db.tokenFindUnique.mockResolvedValue({ id: "token-1", userId: "owner", revokedAt: null, user: { id: "owner", role: "owner" } });
    db.tokenUpdate.mockResolvedValue({});
    db.accountFindFirst.mockResolvedValue({ id: "acct-1", displayCurrency: "USD", preset: { currency: "USD" } });
    db.fillFindMany.mockResolvedValue([]);
    db.fillCreateMany.mockImplementation(async ({ data }: { data: unknown[] }) => ({ count: data.length }));
    db.fillCreate.mockResolvedValue({});
    db.fillUpdate.mockResolvedValue({});
    db.positionUpsert.mockResolvedValue({});
    db.positionFindMany.mockResolvedValue([]);
    db.positionDeleteMany.mockResolvedValue({ count: 0 });
    db.liveQuoteUpsert.mockResolvedValue({});
    db.equityUpsert.mockResolvedValue({});
    db.reconcile.mockResolvedValue({ recordsClosed: 0, duplicatesDeleted: 0, deferredTickers: [] });
  });

  it("dedups a 100-fill catch-up with one lookup and one insert, then reconciles only the new tickers", async () => {
    const fills = Array.from({ length: 100 }, (_, n) => fill(n));
    fills[40] = fill(40, "US.PLTR");
    fills[90] = fill(90, "US.NET");
    db.fillFindMany.mockResolvedValue(stored(...fills.map((f) => f.brokerFillId).filter((id) => id !== "deal-40" && id !== "deal-90")));

    const res = await POST(syncRequest({ positions: [position("US.MTLS")], fills }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(db.fillFindUnique).not.toHaveBeenCalled();
    expect(db.fillFindMany).toHaveBeenCalledTimes(1);
    expect(db.fillFindMany.mock.calls[0][0].where).toEqual({
      brokerAccountId: "acct-1",
      brokerFillId: { in: fills.map((f) => f.brokerFillId) },
    });
    expect(db.fillCreateMany).toHaveBeenCalledTimes(1);
    const { data, skipDuplicates } = db.fillCreateMany.mock.calls[0][0];
    expect(skipDuplicates).toBe(true);
    expect(data.map((row: { brokerFillId: string; ticker: string; source: string }) => [row.brokerFillId, row.ticker, row.source]))
      .toEqual([["deal-40", "US.PLTR", "BRIDGE"], ["deal-90", "US.NET", "BRIDGE"]]);

    expect(db.reconcile).toHaveBeenCalledTimes(1);
    const opts = db.reconcile.mock.calls[0][0];
    expect(opts).toMatchObject({ brokerAccountId: "acct-1", stopgapsOnly: false });
    expect([...opts.tickers].sort()).toEqual(["US.NET", "US.PLTR"]);
    expect(opts.deadline).toBeGreaterThan(Date.now());
    expect(opts.deadline).toBeLessThanOrEqual(Date.now() + 20_000);

    expect(Object.keys(body).sort()).toEqual([
      "equityUpserted", "fillsFeeUpdated", "fillsInserted", "fillsSkipped",
      "ok", "positionsRemoved", "positionsUpserted", "reconciled",
    ]);
    expect(body).toMatchObject({ ok: true, fillsInserted: 2, fillsSkipped: 98, fillsFeeUpdated: 0, positionsUpserted: 1, positionsRemoved: 0 });
    expect(body.reconciled).toEqual({ recordsClosed: 0, duplicatesDeleted: 0 });
  });

  it("keeps an unchanged snapshot on the stopgaps-only reconcile", async () => {
    const fills = [fill(1), fill(2)];
    db.fillFindMany.mockResolvedValue(stored("deal-1", "deal-2"));

    const body = await (await POST(syncRequest({ positions: [position("US.AAA")], fills }))).json();

    expect(db.fillCreateMany).not.toHaveBeenCalled();
    expect(db.positionDeleteMany).not.toHaveBeenCalled();
    expect(db.reconcile.mock.calls[0][0]).toMatchObject({ stopgapsOnly: true, tickers: [] });
    expect(body).toMatchObject({ ok: true, fillsInserted: 0, fillsSkipped: 2, positionsRemoved: 0 });
  });

  it("backfills a late fee onto a stored fill and still counts it as skipped", async () => {
    db.fillFindMany.mockResolvedValue([
      { id: "row-1", brokerFillId: "deal-1", fees: null },
      { id: "row-2", brokerFillId: "deal-2", fees: 1 },
    ]);

    const body = await (await POST(syncRequest({ positions: [], fills: [fill(1, "US.AAA", 2.3), fill(2, "US.AAA", 2.3)] }))).json();

    expect(db.fillUpdate).toHaveBeenCalledTimes(1);
    expect(db.fillUpdate.mock.calls[0][0].where).toEqual({ id: "row-1" });
    expect(Number(db.fillUpdate.mock.calls[0][0].data.fees)).toBe(2.3);
    expect(body).toMatchObject({ ok: true, fillsInserted: 0, fillsSkipped: 2, fillsFeeUpdated: 1 });
  });

  it("skips malformed and repeated fills without looking them up", async () => {
    const missingPrice = { ...fill(3), price: null };
    const numericId = { ...fill(4), brokerFillId: 4 };

    const body = await (await POST(syncRequest({ positions: [], fills: [fill(1), fill(1), missingPrice, numericId] }))).json();

    expect(db.fillFindMany.mock.calls[0][0].where.brokerFillId).toEqual({ in: ["deal-1"] });
    expect(body).toMatchObject({ fillsInserted: 1, fillsSkipped: 3 });
  });

  it("falls back to per-fill inserts when the batch insert fails", async () => {
    db.fillCreateMany.mockRejectedValue(new Error("invalid executedAt"));
    db.fillCreate.mockImplementation(async ({ data }: { data: { brokerFillId: string } }) => {
      if (data.brokerFillId === "deal-2") throw new Error("invalid executedAt");
      return {};
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const body = await (await POST(syncRequest({ positions: [], fills: [fill(1, "US.PLTR"), fill(2, "US.NET")] }))).json();
    spy.mockRestore();

    expect(db.fillCreate).toHaveBeenCalledTimes(2);
    expect(body).toMatchObject({ ok: true, fillsInserted: 1, fillsSkipped: 1 });
    expect(db.reconcile.mock.calls[0][0]).toMatchObject({ stopgapsOnly: false, tickers: ["US.PLTR"] });
  });

  it("deletes only positions the broker stopped reporting and reconciles those tickers", async () => {
    db.positionFindMany.mockResolvedValue([{ ticker: "US.PLTR" }]);
    db.positionDeleteMany.mockResolvedValue({ count: 1 });

    const body = await (await POST(syncRequest({ positions: [position("us.mtls")], fills: [] }))).json();

    expect(db.positionFindMany.mock.calls[0][0].where).toEqual({ brokerAccountId: "acct-1", ticker: { notIn: ["US.MTLS"] } });
    expect(db.positionDeleteMany.mock.calls[0][0].where).toEqual({ brokerAccountId: "acct-1", ticker: { in: ["US.PLTR"] } });
    expect(db.fillFindMany).not.toHaveBeenCalled();
    expect(db.reconcile.mock.calls[0][0]).toMatchObject({ stopgapsOnly: false, tickers: ["US.PLTR"] });
    expect(body).toMatchObject({ ok: true, positionsUpserted: 1, positionsRemoved: 1 });
  });
});
