import { describe, expect, it } from "vitest";
import { buildJournalCalendarData, type JournalCalendarTrade } from "@/lib/journal/calendar-data";

function trade(partial: Partial<JournalCalendarTrade> & { id: string; ticker: string }): JournalCalendarTrade {
  return {
    state: "OPEN",
    occurredAt: new Date("2026-07-10T14:00:00Z"),
    closed: false,
    usdPnl: null,
    ...partial,
  };
}

describe("buildJournalCalendarData", () => {
  it("keeps open broker trades visible without treating unrealized P&L as realized", () => {
    const days = buildJournalCalendarData([
      trade({ id: "open-twlo", ticker: "TWLO", usdPnl: 95.05 }),
      trade({ id: "closed-cdw", ticker: "CDW", state: "CLOSE", closed: true, usdPnl: 35.14 }),
    ]);

    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({
      date: "2026-07-10",
      pnl: 35.14,
      trades: 2,
      openTrades: 1,
      realizedTrades: 1,
    });
    expect(days[0].items.find((item) => item.id === "open-twlo")?.pnl).toBeNull();
  });

  it("sorts days and uses the supplied fallback occurrence time", () => {
    const days = buildJournalCalendarData([
      trade({ id: "later", ticker: "OKTA", occurredAt: new Date("2026-07-11T01:00:00Z") }),
      trade({ id: "earlier", ticker: "MTLS", occurredAt: new Date("2026-01-28T09:00:00Z") }),
      trade({ id: "missing", ticker: "NONE", occurredAt: null }),
    ]);

    expect(days.map((day) => day.date)).toEqual(["2026-01-28", "2026-07-11"]);
    expect(days.flatMap((day) => day.items).map((item) => item.id)).not.toContain("missing");
  });
});
