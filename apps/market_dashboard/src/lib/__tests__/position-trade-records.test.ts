import { beforeEach, describe, expect, it, vi } from "vitest";

const { positionFindMany } = vi.hoisted(() => ({ positionFindMany: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    position: { findMany: positionFindMany },
  },
}));

import { materializeOpenPositionTradeRecords } from "@/lib/trades/position-trade-records";

describe("materializeOpenPositionTradeRecords", () => {
  beforeEach(() => {
    positionFindMany.mockReset().mockResolvedValue([]);
  });

  it("can scope default Journal materialization to live broker accounts", async () => {
    await materializeOpenPositionTradeRecords("owner", { liveOnly: true });

    expect(positionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { brokerAccount: { userId: "owner", isLive: true } },
    }));
  });
});
