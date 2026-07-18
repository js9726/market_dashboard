import { beforeEach, describe, expect, it, vi } from "vitest";

const { findFirst, update } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn(),
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
    goal: { findFirst, update },
  },
}));
vi.mock("@/server/goals-alerts", () => ({
  GOAL_KINDS: ["MAX_DAILY_LOSS", "MAX_DRAWDOWN", "WIN_RATE"],
  computeGoalProgress: vi.fn(async () => []),
}));

import { PATCH } from "../route";

describe("PATCH /api/goals", () => {
  beforeEach(() => {
    findFirst.mockReset().mockResolvedValue({ id: "goal-1", kind: "MAX_DAILY_LOSS" });
    update.mockReset().mockResolvedValue({ id: "goal-1" });
  });

  it("rejects non-positive loss limits before updating", async () => {
    const response = await PATCH(new Request("http://localhost/api/goals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "goal-1", target: -200 }),
    }));

    expect(response).toBeDefined();
    if (!response) throw new Error("PATCH returned no response");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "loss/drawdown targets are positive magnitudes (e.g. 200 = -$200)",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("accepts a positive loss magnitude", async () => {
    const response = await PATCH(new Request("http://localhost/api/goals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "goal-1", target: 200 }),
    }));

    expect(response).toBeDefined();
    if (!response) throw new Error("PATCH returned no response");
    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "goal-1" },
      data: { target: expect.objectContaining({}) },
    }));
  });
});
