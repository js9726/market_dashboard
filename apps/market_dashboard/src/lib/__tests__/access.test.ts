import { describe, expect, it } from "vitest";
import {
  canSeePersonalBook,
  canSeeSharedData,
  isOwner,
  roleOf,
  scopeUserId,
} from "@/lib/access";

const session = (id: string | null, role?: string | null) => ({
  user: { id, role },
});

describe("SaaS access policy", () => {
  it("normalises legacy allowed users as members", () => {
    const s = session("user-1", "allowed");

    expect(roleOf(s)).toBe("member");
    expect(canSeePersonalBook(s)).toBe(true);
    expect(canSeeSharedData(s)).toBe(true);
  });

  it("scopes personal data to the caller even for owners", () => {
    const owner = session("owner-1", "owner");

    expect(isOwner(owner)).toBe(true);
    expect(scopeUserId(owner)).toBe("owner-1");
  });

  it("blocks pending and denied users from personal-book data", () => {
    expect(canSeePersonalBook(session("pending-1", "pending"))).toBe(false);
    expect(canSeePersonalBook(session("denied-1", "denied"))).toBe(false);
  });

  it("allows shared data for signed-in users except denied users", () => {
    expect(canSeeSharedData(session("pending-1", "pending"))).toBe(true);
    expect(canSeeSharedData(session("denied-1", "denied"))).toBe(false);
    expect(canSeeSharedData(null)).toBe(false);
  });
});
