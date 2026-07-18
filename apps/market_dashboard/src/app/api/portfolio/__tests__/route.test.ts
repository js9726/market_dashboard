import { beforeEach, describe, expect, it, vi } from "vitest";

const { accountFindMany, marketQuoteFindMany, liveQuoteFindMany, tradeFindMany } = vi.hoisted(() => ({
  accountFindMany: vi.fn(),
  marketQuoteFindMany: vi.fn(),
  liveQuoteFindMany: vi.fn(),
  tradeFindMany: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "owner", role: "owner" } })),
}));
vi.mock("@/lib/access", () => ({
  canSeePersonalBook: vi.fn(() => true),
  scopeUserId: vi.fn(() => "owner"),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    userBrokerAccount: { findMany: accountFindMany },
    marketQuote: { findMany: marketQuoteFindMany },
    liveQuote: { findMany: liveQuoteFindMany },
    tradeRecord: { findMany: tradeFindMany },
  },
}));

import { GET } from "../route";

const position = (id: string, ticker: string, qty: number, avgCost: number) => ({
  id,
  ticker,
  qty,
  avgCost,
  currency: "USD",
  currentPrice: null,
  marketValue: null,
  unrealizedPl: null,
  unrealizedPlPct: null,
  openedAt: new Date("2026-07-17T14:00:00.000Z"),
  lastFillAt: new Date("2026-07-17T14:00:00.000Z"),
  asOf: new Date("2026-07-17T20:00:00.000Z"),
});

describe("GET /api/portfolio", () => {
  beforeEach(() => {
    accountFindMany.mockReset().mockResolvedValue([
      {
        id: "live-1",
        alias: "IBKR main",
        isLive: true,
        displayCurrency: "USD",
        preset: { name: "IBKR Tiered", currency: "USD", region: "US" },
        positions: [position("p-live", "PANW", 2, 360)],
      },
      {
        id: "paper-1",
        alias: "moomoo Paper (SIM)",
        isLive: false,
        displayCurrency: "USD",
        preset: { name: "moomoo", currency: "USD", region: "US" },
        positions: [position("p-paper", "NVDA", 8, 100)],
      },
    ]);
    marketQuoteFindMany.mockReset().mockResolvedValue([
      { symbol: "PANW", price: 365, changePct: 1, observedAt: new Date(), source: "yahoo" },
      { symbol: "NVDA", price: 200, changePct: 2, observedAt: new Date(), source: "yahoo" },
    ]);
    liveQuoteFindMany.mockReset().mockResolvedValue([]);
    tradeFindMany.mockReset().mockResolvedValue([]);
  });

  it("scopes legacy journal links to the authenticated user and separates live totals", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(tradeFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: "owner" }),
    }));
    expect(body.grandTotals.marketValue).toBe(2330);
    expect(body.liveTotals.marketValue).toBe(730);
    expect(body.paperTotals.marketValue).toBe(1600);
  });
});
