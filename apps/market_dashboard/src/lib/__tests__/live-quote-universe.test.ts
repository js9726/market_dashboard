import { describe, expect, it } from "vitest";
import {
  LIVE_QUOTE_CHANGE_BASIS,
  LIVE_QUOTE_DEFAULT_WATCHLIST,
  LIVE_QUOTE_INDEX_SYMBOLS,
  LIVE_QUOTE_SECTORS,
  requiredLiveQuoteSymbols,
} from "@/lib/live-quote-universe";

describe("live quote universe", () => {
  it("defines session change explicitly and includes CRWD", () => {
    expect(LIVE_QUOTE_CHANGE_BASIS).toBe("regular-session-vs-previous-close");
    expect(LIVE_QUOTE_DEFAULT_WATCHLIST).toContain("CRWD");
  });

  it("derives one unique product universe and keeps configured additions", () => {
    const required = requiredLiveQuoteSymbols(["tenb", "NVDA"]);
    const promised = [
      ...LIVE_QUOTE_INDEX_SYMBOLS,
      ...LIVE_QUOTE_SECTORS.map((sector) => sector.symbol),
      ...LIVE_QUOTE_DEFAULT_WATCHLIST,
      "TENB",
    ];

    expect(new Set(required).size).toBe(required.length);
    expect(required).toEqual(expect.arrayContaining(promised));
  });
});
