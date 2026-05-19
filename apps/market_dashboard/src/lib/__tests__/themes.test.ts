import { describe, expect, it } from "vitest";
import { classifyTheme, themeLabel, THEME_THRESHOLDS } from "@/lib/themes";
import type { TickerRow } from "@/types/market-dashboard";

function row(overrides: Partial<TickerRow>): TickerRow {
  return {
    ticker: "TAN",
    daily: 0,
    intra: 0,
    "5d": 0,
    "20d": 0,
    atr_pct: 1,
    dist_sma50_atr: 0,
    rs: 50,
    rs_chart: null,
    long: [],
    short: [],
    abc: "B",
    ...overrides,
  };
}

describe("classifyTheme", () => {
  describe("heating", () => {
    it("classifies a clear breakout as heating", () => {
      const r = row({ daily: 3.2, intra: 0.5, rs: 78, abc: "A" });
      expect(classifyTheme(r)).toBe("heating");
    });

    it("requires abc=A — abc=B with hot daily falls to accumulate", () => {
      const r = row({ daily: 3.0, intra: 0.5, rs: 75, abc: "B", "5d": 2 });
      expect(classifyTheme(r)).toBe("accumulate");
    });

    it("requires intra > 0 — flat intra demotes", () => {
      const r = row({ daily: 3.0, intra: 0, rs: 75, abc: "A", "5d": 2 });
      expect(classifyTheme(r)).toBe("accumulate");
    });

    it("requires rs >= 70 — rs=69 demotes", () => {
      const r = row({ daily: 3.0, intra: 0.5, rs: 69, abc: "A", "5d": 2 });
      expect(classifyTheme(r)).toBe("accumulate");
    });

    it("boundary: daily = 2.0 exactly qualifies (>=)", () => {
      const r = row({ daily: THEME_THRESHOLDS.heating.minDaily, intra: 0.1, rs: 70, abc: "A" });
      expect(classifyTheme(r)).toBe("heating");
    });

    it("boundary: rs = 70 exactly qualifies (>=)", () => {
      const r = row({ daily: 2.5, intra: 0.1, rs: THEME_THRESHOLDS.heating.minRs, abc: "A" });
      expect(classifyTheme(r)).toBe("heating");
    });
  });

  describe("cooling", () => {
    it("classifies a sharp drop as cooling", () => {
      const r = row({ daily: -2.1, "5d": -4.5, rs: 41, abc: "C" });
      expect(classifyTheme(r)).toBe("cooling");
    });

    it("cooling beats accumulate (priority order)", () => {
      // Has the accumulate signal AND the cooling signal — cooling wins.
      const r = row({ daily: -1.8, "5d": 2, rs: 80, abc: "A" });
      expect(classifyTheme(r)).toBe("cooling");
    });

    it("triggers on dist_sma50_atr < -1 alone", () => {
      const r = row({ daily: 0.5, dist_sma50_atr: -1.5, rs: 60, abc: "B" });
      expect(classifyTheme(r)).toBe("cooling");
    });

    it("triggers on 5d < -3 AND abc=C", () => {
      const r = row({ daily: 0, "5d": -4, abc: "C" });
      expect(classifyTheme(r)).toBe("cooling");
    });

    it("5d < -3 alone does NOT trigger cooling without abc=C", () => {
      // Confirms the AND: 5d<-3 needs abc=C to fire cooling.
      // With abc=B and negative 5d, accumulate's 5d>0 requirement also fails,
      // so the row falls to neutral — the important point is it's NOT cooling.
      const r = row({ daily: 0, "5d": -4, abc: "B", rs: 60 });
      expect(classifyTheme(r)).not.toBe("cooling");
    });

    it("boundary: daily = -1.5 exactly qualifies (<=)", () => {
      const r = row({ daily: THEME_THRESHOLDS.cooling.maxDaily, rs: 80, abc: "A" });
      expect(classifyTheme(r)).toBe("cooling");
    });
  });

  describe("accumulate", () => {
    it("classifies a warming theme as accumulate", () => {
      const r = row({ daily: 0.4, intra: 0.1, rs: 68, abc: "A", "5d": 2.1 });
      expect(classifyTheme(r)).toBe("accumulate");
    });

    it("requires 5d > 0", () => {
      const r = row({ daily: 0.4, rs: 68, abc: "A", "5d": 0 });
      expect(classifyTheme(r)).toBe("neutral");
    });

    it("accepts abc=B", () => {
      const r = row({ daily: 0.4, rs: 60, abc: "B", "5d": 1.5 });
      expect(classifyTheme(r)).toBe("accumulate");
    });

    it("rejects abc=C even with strong 5d", () => {
      const r = row({ daily: 0.4, rs: 60, abc: "C", "5d": 1.5 });
      expect(classifyTheme(r)).toBe("neutral");
    });

    it("boundary: rs = 55 exactly qualifies (>=)", () => {
      const r = row({ daily: 0.4, rs: THEME_THRESHOLDS.accumulate.minRs, abc: "A", "5d": 1 });
      expect(classifyTheme(r)).toBe("accumulate");
    });
  });

  describe("neutral", () => {
    it("falls through when no bucket fires", () => {
      const r = row({ daily: 0.3, "5d": -1, rs: 40, abc: "B" });
      expect(classifyTheme(r)).toBe("neutral");
    });

    it("returns neutral for all-nulls", () => {
      const r = row({ daily: null, intra: null, "5d": null, rs: null, abc: null });
      expect(classifyTheme(r)).toBe("neutral");
    });
  });
});

describe("themeLabel", () => {
  it("returns the human name for known tickers", () => {
    expect(themeLabel("TAN")).toBe("Solar");
    expect(themeLabel("CIBR")).toBe("Cybersecurity");
    expect(themeLabel("AIQ")).toBe("AI Software");
  });

  it("falls back to the ticker for unknown ones", () => {
    expect(themeLabel("ZZZZ")).toBe("ZZZZ");
  });
});
