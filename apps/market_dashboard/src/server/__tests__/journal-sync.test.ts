import { describe, expect, it } from "vitest";
import { isUsMarketHoliday, rollWeekendEntryDate } from "@/server/journal-sync";

describe("weekend entry-date normalization", () => {
  it("rolls a US Saturday past Presidents Day", () => {
    const result = rollWeekendEntryDate(new Date("2026-02-14T00:00:00.000Z"), "CIEN");
    expect(result.rolled).toBe(true);
    expect(result.date.toISOString().slice(0, 10)).toBe("2026-02-17");
  });

  it("rolls a Bursa Sunday to Monday without applying the US holiday calendar", () => {
    const result = rollWeekendEntryDate(new Date("2026-02-15T00:00:00.000Z"), "1155.KL");
    expect(result.date.toISOString().slice(0, 10)).toBe("2026-02-16");
  });

  it("recognizes Monday observance when a fixed holiday falls on Sunday", () => {
    expect(isUsMarketHoliday(new Date("2027-07-05T00:00:00.000Z"))).toBe(true);
  });
});
