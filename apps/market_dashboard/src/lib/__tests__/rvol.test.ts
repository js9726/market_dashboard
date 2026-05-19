import { describe, expect, it } from "vitest";
import {
  RVOL_THRESHOLDS,
  pct52wTone,
  rvolBucket,
  rvolLabel,
  rvolTone,
  sortByRvolDesc,
} from "@/lib/rvol";
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
    rvol: 1.0,
    off_52w_high_pct: -5,
    ...overrides,
  };
}

describe("rvolBucket", () => {
  it("returns surge at the threshold and above", () => {
    expect(rvolBucket(RVOL_THRESHOLDS.surge)).toBe("surge");
    expect(rvolBucket(3.5)).toBe("surge");
  });

  it("returns high between high and surge thresholds", () => {
    expect(rvolBucket(RVOL_THRESHOLDS.high)).toBe("high");
    expect(rvolBucket(1.5)).toBe("high");
    expect(rvolBucket(1.99)).toBe("high");
  });

  it("returns normal in the 0.7-1.3 band", () => {
    expect(rvolBucket(1.0)).toBe("normal");
    expect(rvolBucket(0.8)).toBe("normal");
    expect(rvolBucket(1.29)).toBe("normal");
  });

  it("returns low between dry and low thresholds", () => {
    expect(rvolBucket(0.5)).toBe("low");
    expect(rvolBucket(RVOL_THRESHOLDS.dry)).toBe("low");
  });

  it("returns dry below the dry threshold", () => {
    expect(rvolBucket(0.3)).toBe("dry");
    expect(rvolBucket(0.0)).toBe("dry");
  });

  it("returns unknown for null/undefined/NaN", () => {
    expect(rvolBucket(null)).toBe("unknown");
    expect(rvolBucket(undefined)).toBe("unknown");
    expect(rvolBucket(NaN)).toBe("unknown");
  });
});

describe("rvolTone", () => {
  it("returns surge tone with gain background for high RVOL", () => {
    const t = rvolTone(2.5);
    expect(t.label).toBe("SURGE");
    expect(t.background).toContain("gain");
  });

  it("returns dry tone with loss background for very low RVOL", () => {
    const t = rvolTone(0.2);
    expect(t.label).toBe("DRY");
    expect(t.background).toContain("loss");
  });

  it("returns a placeholder dash for null", () => {
    expect(rvolTone(null).label).toBe("-");
  });
});

describe("sortByRvolDesc", () => {
  it("sorts non-null values descending", () => {
    const result = sortByRvolDesc([
      row({ ticker: "A", rvol: 0.5 }),
      row({ ticker: "B", rvol: 2.5 }),
      row({ ticker: "C", rvol: 1.0 }),
    ]);
    expect(result.map((r) => r.ticker)).toEqual(["B", "C", "A"]);
  });

  it("pushes null/undefined RVOL to the end", () => {
    const result = sortByRvolDesc([
      row({ ticker: "A", rvol: null }),
      row({ ticker: "B", rvol: 1.5 }),
      row({ ticker: "C", rvol: undefined }),
      row({ ticker: "D", rvol: 3.0 }),
    ]);
    expect(result.map((r) => r.ticker)).toEqual(["D", "B", "A", "C"]);
  });

  it("returns a NEW array (does not mutate input)", () => {
    const input = [row({ ticker: "A", rvol: 1 }), row({ ticker: "B", rvol: 2 })];
    const result = sortByRvolDesc(input);
    expect(result).not.toBe(input);
    expect(input.map((r) => r.ticker)).toEqual(["A", "B"]); // unchanged
  });
});

describe("pct52wTone", () => {
  it("greens when within 3% of high", () => {
    expect(pct52wTone(0).color).toContain("gain");
    expect(pct52wTone(-2.5).color).toContain("gain");
    expect(pct52wTone(-3).color).toContain("gain");
  });

  it("neutral between -3% and -10%", () => {
    const t = pct52wTone(-7);
    expect(t.color).not.toContain("gain");
    expect(t.color).not.toContain("loss");
  });

  it("reds beyond -10%", () => {
    expect(pct52wTone(-12).color).toContain("loss");
    expect(pct52wTone(-30).color).toContain("loss");
  });

  it("handles null/NaN", () => {
    expect(pct52wTone(null).color).toContain("fg-3");
    expect(pct52wTone(NaN).color).toContain("fg-3");
  });
});

describe("rvolLabel", () => {
  it("returns human name from the THEME_LABELS map", () => {
    expect(rvolLabel("TAN")).toBe("Solar");
    expect(rvolLabel("ROBO")).toBe("Robotics & Automation");
  });

  it("falls back to the ticker for unknown ones", () => {
    expect(rvolLabel("ZZZZ")).toBe("ZZZZ");
  });
});
