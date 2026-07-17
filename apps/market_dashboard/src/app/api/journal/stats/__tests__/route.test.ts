import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, findUnique } = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "owner", role: "owner" } })),
}));
vi.mock("@/lib/access", () => ({
  canSeePersonalBook: vi.fn(() => true),
  scopeUserId: vi.fn(() => "owner"),
}));
vi.mock("@/lib/equity-currency", () => ({
  getUsdMyrRate: vi.fn(async () => 4.2),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    tradeRecord: { findMany },
    spreadsheetConnection: { findUnique },
  },
}));

import { GET } from "../route";

describe("GET /api/journal/stats", () => {
  beforeEach(() => {
    findMany.mockReset().mockResolvedValue([]);
    findUnique.mockReset().mockResolvedValue(null);
  });

  it("excludes paper-account records while retaining live and legacy sheet records", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId: "owner",
        AND: [
          { OR: [{ brokerOrderId: null }, { NOT: { brokerOrderId: { endsWith: ":dup" } } }] },
          { OR: [{ brokerAccountId: null }, { brokerAccount: { isLive: true } }] },
        ],
      },
    }));
  });
});
