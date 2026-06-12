import { describe, expect, it } from "vitest";
import { isEntryExpired, sessionsBetween, validitySessions, validUntil } from "../alist-validity";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("sessionsBetween", () => {
  it("counts weekday sessions, skipping weekends", () => {
    expect(sessionsBetween(d("2026-06-11"), d("2026-06-11"))).toBe(0); // Thu, day 0
    expect(sessionsBetween(d("2026-06-11"), d("2026-06-12"))).toBe(1); // Fri
    expect(sessionsBetween(d("2026-06-11"), d("2026-06-14"))).toBe(1); // Sun → still 1
    expect(sessionsBetween(d("2026-06-11"), d("2026-06-15"))).toBe(2); // Mon
    expect(sessionsBetween(d("2026-06-01"), d("2026-06-12"))).toBe(9);
  });
});

describe("validitySessions", () => {
  it("gives catalyst plays 2 sessions, bases 5, unclassified 3", () => {
    expect(validitySessions("EP-FRESH")).toBe(2);
    expect(validitySessions("PARABOLIC")).toBe(2);
    expect(validitySessions("BO-CB")).toBe(5);
    expect(validitySessions("PB-21EMA")).toBe(5);
    expect(validitySessions(null)).toBe(3);
  });
});

describe("validUntil / isEntryExpired", () => {
  it("EP picked Thursday is valid through Monday (2 sessions over a weekend)", () => {
    expect(validUntil(d("2026-06-11"), "EP-FRESH").toISOString().slice(0, 10)).toBe("2026-06-15");
    expect(isEntryExpired(d("2026-06-11"), "EP-FRESH", d("2026-06-15"))).toBe(false);
    expect(isEntryExpired(d("2026-06-11"), "EP-FRESH", d("2026-06-16"))).toBe(true);
  });

  it("base setup keeps a full week", () => {
    expect(isEntryExpired(d("2026-06-08"), "BO-CB", d("2026-06-12"))).toBe(false); // 4 sessions
    expect(isEntryExpired(d("2026-06-08"), "BO-CB", d("2026-06-16"))).toBe(true); // 6 sessions
  });
});
