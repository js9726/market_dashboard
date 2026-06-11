import { describe, expect, it } from "vitest";
import { etMidnightUtc, needsQuotaReset } from "../quota";

describe("etMidnightUtc", () => {
  it("returns 04:00 UTC during EDT (summer)", () => {
    expect(etMidnightUtc(new Date("2026-06-11T12:00:00Z")).toISOString()).toBe(
      "2026-06-11T04:00:00.000Z",
    );
  });

  it("returns 05:00 UTC during EST (winter)", () => {
    expect(etMidnightUtc(new Date("2026-01-15T12:00:00Z")).toISOString()).toBe(
      "2026-01-15T05:00:00.000Z",
    );
  });

  it("rolls to the previous ET day before the UTC offset boundary", () => {
    // 03:59 UTC in June = 23:59 ET on the PREVIOUS day.
    expect(etMidnightUtc(new Date("2026-06-11T03:59:00Z")).toISOString()).toBe(
      "2026-06-10T04:00:00.000Z",
    );
  });
});

describe("needsQuotaReset", () => {
  const now = new Date("2026-06-11T12:00:00Z"); // 08:00 ET

  it("true when last reset was yesterday ET", () => {
    expect(needsQuotaReset(new Date("2026-06-10T20:00:00Z"), now)).toBe(true);
  });

  it("false when already reset today ET (idempotent)", () => {
    expect(needsQuotaReset(new Date("2026-06-11T04:05:00Z"), now)).toBe(false);
  });
});
