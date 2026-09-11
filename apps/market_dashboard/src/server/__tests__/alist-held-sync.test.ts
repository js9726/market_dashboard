import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const db = vi.hoisted(() => ({
  position: { findMany: vi.fn() },
  tradeFill: { findMany: vi.fn() },
  aListCandidate: {
    findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(),
    update: vi.fn(), updateMany: vi.fn(), upsert: vi.fn(), delete: vi.fn(),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
import { syncHeldPositions } from "../alist-held-sync";

const date = new Date("2026-09-11T15:00:00Z");
function position(id = "live", account = "account-a") {
  return { id, brokerAccountId: account, ticker: "US.IT", qty: 3, avgCost: 200, openedAt: date };
}
function held(id: string, positionId: string | null, extra = {}) {
  return {
    id, heldPositionId: positionId, ticker: "IT", status: "ACTIVE", isHeld: true,
    pickDate: date, entryFillAt: date, source: "HELD", onBook: false,
    entryAvgCost: new Prisma.Decimal(200), heldQty: new Prisma.Decimal(3),
    ...extra,
  };
}

describe("syncHeldPositions broker authority", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.position.findMany.mockResolvedValue([]);
    db.tradeFill.findMany.mockResolvedValue([]);
    db.aListCandidate.findMany.mockResolvedValue([]);
    db.aListCandidate.findFirst.mockResolvedValue(null);
    db.aListCandidate.findUnique.mockResolvedValue(null);
    db.aListCandidate.upsert.mockResolvedValue({ id: "new" });
    db.aListCandidate.updateMany.mockResolvedValue({ count: 1 });
  });

  it("does not seed from a historical BUY without a current Position", async () => {
    db.tradeFill.findMany.mockResolvedValue([{ ticker: "IT", side: "BUY", qty: 3 }]);
    const result = await syncHeldPositions("owner");
    expect(result.tickers).toEqual([]);
    expect(db.tradeFill.findMany).not.toHaveBeenCalled();
    expect(db.aListCandidate.upsert).not.toHaveBeenCalled();
  });

  it("expires a dangling exact ID without inventing trade outcomes", async () => {
    db.aListCandidate.findMany.mockResolvedValue([held("old", "deleted")]);
    const result = await syncHeldPositions("owner");
    expect(result.expired).toBe(1);
    expect(db.position.findMany).toHaveBeenLastCalledWith({
      where: { id: { in: ["deleted"] }, brokerAccount: { userId: "owner" } },
      select: { id: true },
    });
    expect(db.aListCandidate.updateMany).toHaveBeenCalledWith({
      where: { id: "old", userId: "owner", status: "ACTIVE", heldPositionId: "deleted" },
      data: { status: "EXPIRED" },
    });
  });

  it("cannot keep a dangling link alive using another account's same ticker", async () => {
    db.position.findMany.mockResolvedValueOnce([position("other", "account-b")]).mockResolvedValueOnce([]);
    db.aListCandidate.findMany.mockResolvedValue([held("old", "deleted")]);
    db.aListCandidate.findUnique.mockResolvedValue(held("old", "deleted"));
    const result = await syncHeldPositions("owner");
    expect(result).toMatchObject({ expired: 1, skipped: 1 });
    expect(db.aListCandidate.upsert).not.toHaveBeenCalled();
    expect(db.aListCandidate.update).not.toHaveBeenCalled();
  });

  it("preserves extant links even when the position is absent from the live-positive lane", async () => {
    db.position.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "paper-or-zero" }]);
    db.aListCandidate.findMany.mockResolvedValue([held("candidate", "paper-or-zero")]);
    expect((await syncHeldPositions("owner")).expired).toBe(0);
    expect(db.aListCandidate.updateMany).not.toHaveBeenCalled();
  });

  it("reports never-linked rows as unresolved", async () => {
    db.aListCandidate.findMany.mockResolvedValue([held("legacy", null)]);
    expect(await syncHeldPositions("owner")).toMatchObject({ unresolved: 1, expired: 0 });
    expect(db.aListCandidate.updateMany).not.toHaveBeenCalled();
  });

  it("prioritizes exact identity and preserves another account's same-date row", async () => {
    db.position.findMany.mockResolvedValueOnce([position()]).mockResolvedValueOnce([{ id: "live" }, { id: "other" }]);
    db.aListCandidate.findMany.mockResolvedValue([held("other-row", "other"), held("ours", "live")]);
    const result = await syncHeldPositions("owner");
    expect(result.linked).toBe(1);
    expect(db.aListCandidate.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "ours" } }));
    expect(db.aListCandidate.delete).not.toHaveBeenCalled();
  });

  it("allows a current reopened position without consulting historical closure as a blacklist", async () => {
    db.position.findMany.mockResolvedValueOnce([position()]);
    const result = await syncHeldPositions("owner");
    expect(result.tickers).toEqual(["IT"]);
    expect(db.aListCandidate.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ heldPositionId: "live", heldQty: new Prisma.Decimal(3) }),
    }));
  });

  it("does not overwrite a historical row when the legacy day key collides", async () => {
    db.position.findMany.mockResolvedValueOnce([position()]);
    db.aListCandidate.findUnique.mockResolvedValue(held("history", "old", { status: "CLOSED" }));
    expect((await syncHeldPositions("owner")).skipped).toBe(1);
    expect(db.aListCandidate.upsert).not.toHaveBeenCalled();
  });

  it("counts only successful conditional retirements after a concurrent relink", async () => {
    db.aListCandidate.findMany.mockResolvedValue([held("old", "deleted")]);
    db.aListCandidate.updateMany.mockResolvedValue({ count: 0 });
    expect((await syncHeldPositions("owner")).expired).toBe(0);
  });

  it("is idempotent once the dangling candidate is inactive", async () => {
    db.aListCandidate.findMany.mockResolvedValueOnce([held("old", "deleted")]).mockResolvedValueOnce([]);
    expect((await syncHeldPositions("owner")).expired).toBe(1);
    expect((await syncHeldPositions("owner")).expired).toBe(0);
    expect(db.aListCandidate.updateMany).toHaveBeenCalledTimes(1);
  });
});
