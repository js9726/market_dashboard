import { describe, expect, it } from "vitest";
import { isLiveQuoteFresh, selectFreshLiveQuotes } from "@/lib/live-quote-freshness";

describe("live quote freshness", () => {
  const marketHours = new Date("2026-08-26T14:00:00.000Z");

  it("rejects a stale CRWD row even when another symbol is fresh", () => {
    const selection = selectFreshLiveQuotes([
      { symbol: "CRWD", observedAt: "2026-05-29T15:24:49.354Z", price: 714.925 },
      { symbol: "NVDA", observedAt: "2026-08-26T13:59:30.000Z", price: 213.05 },
    ], marketHours);

    expect(selection.bySymbol.has("CRWD")).toBe(false);
    expect(selection.bySymbol.get("NVDA")?.price).toBe(213.05);
    expect(selection.latestObservedAt?.toISOString()).toBe("2026-08-26T13:59:30.000Z");
  });

  it("keeps the freshest eligible duplicate at the symbol seam", () => {
    const selection = selectFreshLiveQuotes([
      { symbol: "crwd", observedAt: "2026-08-26T13:58:30.000Z", price: 184 },
      { symbol: "CRWD", observedAt: "2026-08-26T13:59:30.000Z", price: 185.38 },
    ], marketHours);

    expect(selection.bySymbol.get("CRWD")?.price).toBe(185.38);
  });

  it("fails closed on invalid or implausibly future timestamps", () => {
    expect(isLiveQuoteFresh("not-a-date", marketHours)).toBe(false);
    expect(isLiveQuoteFresh("2026-08-26T14:06:00.000Z", marketHours)).toBe(false);
  });
});
