import { describe, expect, it } from "vitest";
import {
  QUADRANT_META,
  RRG_MIDPOINTS,
  classifyRrg,
  rrgPointTone,
  rrgQuadrantCounts,
  toRrgPoints,
} from "@/lib/rrg";
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
    rvol: 1,
    off_52w_high_pct: -5,
    ...overrides,
  };
}

describe("classifyRrg", () => {
  it("classifies high-RS + rising as leading", () => {
    expect(classifyRrg(row({ rs: 80, "20d": 5 }))).toBe("leading");
  });

  it("classifies low-RS + rising as improving", () => {
    expect(classifyRrg(row({ rs: 30, "20d": 4 }))).toBe("improving");
  });

  it("classifies low-RS + falling as lagging", () => {
    expect(classifyRrg(row({ rs: 20, "20d": -3 }))).toBe("lagging");
  });

  it("classifies high-RS + falling as weakening", () => {
    expect(classifyRrg(row({ rs: 70, "20d": -2 }))).toBe("weakening");
  });

  it("midpoint rs=50 with positive momentum -> leading (inclusive)", () => {
    expect(classifyRrg(row({ rs: RRG_MIDPOINTS.rs, "20d": 1 }))).toBe("leading");
  });

  it("midpoint momentum=0 with strong rs -> weakening (>= midpoint)", () => {
    // momentum > midpoint is the strict rising test; equal to midpoint falls
    // into the not-rising bucket. With rs=70 this lands in weakening.
    expect(classifyRrg(row({ rs: 70, "20d": RRG_MIDPOINTS.momentum }))).toBe("weakening");
  });

  it("returns unknown when rs is null", () => {
    expect(classifyRrg(row({ rs: null }))).toBe("unknown");
  });

  it("returns unknown when 20d is null", () => {
    expect(classifyRrg(row({ "20d": null }))).toBe("unknown");
  });

  it("returns unknown on NaN inputs", () => {
    expect(classifyRrg(row({ rs: NaN }))).toBe("unknown");
    expect(classifyRrg(row({ "20d": NaN }))).toBe("unknown");
  });
});

describe("toRrgPoints", () => {
  it("drops rows missing rs or 20d", () => {
    const points = toRrgPoints([
      row({ ticker: "A", rs: 60, "20d": 3 }),
      row({ ticker: "B", rs: null }),
      row({ ticker: "C", "20d": null }),
    ]);
    expect(points.map((p) => p.ticker)).toEqual(["A"]);
  });

  it("scales size from atr_pct and clamps to [4, 32]", () => {
    const points = toRrgPoints([
      row({ ticker: "S", rs: 60, "20d": 1, atr_pct: 0.1 }),  // very small
      row({ ticker: "M", rs: 60, "20d": 1, atr_pct: 2 }),    // typical
      row({ ticker: "L", rs: 60, "20d": 1, atr_pct: 10 }),   // very large
    ]);
    const byTicker = Object.fromEntries(points.map((p) => [p.ticker, p.size]));
    expect(byTicker.S).toBeGreaterThanOrEqual(4);
    expect(byTicker.L).toBeLessThanOrEqual(32);
    expect(byTicker.M).toBeGreaterThan(byTicker.S);
    expect(byTicker.L).toBeGreaterThan(byTicker.M);
  });

  it("attaches both quadrant and themeBucket labels", () => {
    const points = toRrgPoints([
      row({ ticker: "TAN", rs: 78, "20d": 9.1, daily: 3.2, intra: 0.5, abc: "A" }),
    ]);
    expect(points[0].quadrant).toBe("leading");
    expect(points[0].themeBucket).toBe("heating");
    expect(points[0].label).toBe("Solar");
  });

  it("uses ticker fallback when label is unknown", () => {
    const points = toRrgPoints([
      row({ ticker: "ZZZZ", rs: 60, "20d": 2 }),
    ]);
    expect(points[0].label).toBe("ZZZZ");
  });
});

describe("rrgQuadrantCounts", () => {
  it("tallies all four quadrants from a mixed set", () => {
    const points = toRrgPoints([
      row({ ticker: "A", rs: 80, "20d": 5 }),
      row({ ticker: "B", rs: 30, "20d": 4 }),
      row({ ticker: "C", rs: 20, "20d": -3 }),
      row({ ticker: "D", rs: 70, "20d": -2 }),
      row({ ticker: "E", rs: 75, "20d": 6 }),
    ]);
    const counts = rrgQuadrantCounts(points);
    expect(counts).toEqual({
      leading: 2,
      improving: 1,
      lagging: 1,
      weakening: 1,
      unknown: 0,
    });
  });
});

describe("rrgPointTone", () => {
  it("returns gain tone for heating", () => {
    expect(rrgPointTone("heating").fill).toContain("gain");
  });
  it("returns accent tone for accumulate", () => {
    expect(rrgPointTone("accumulate").fill).toContain("accent");
  });
  it("returns loss tone for cooling", () => {
    expect(rrgPointTone("cooling").fill).toContain("loss");
  });
  it("returns muted tone for neutral", () => {
    expect(rrgPointTone("neutral").fill).toContain("fg-3");
  });
});

describe("QUADRANT_META corner positions", () => {
  it("places Leading in the top-right corner", () => {
    expect(QUADRANT_META.leading.cornerX).toBe("right");
    expect(QUADRANT_META.leading.cornerY).toBe("top");
  });
  it("places Improving in the top-left", () => {
    expect(QUADRANT_META.improving.cornerX).toBe("left");
    expect(QUADRANT_META.improving.cornerY).toBe("top");
  });
  it("places Lagging in the bottom-left", () => {
    expect(QUADRANT_META.lagging.cornerX).toBe("left");
    expect(QUADRANT_META.lagging.cornerY).toBe("bottom");
  });
  it("places Weakening in the bottom-right", () => {
    expect(QUADRANT_META.weakening.cornerX).toBe("right");
    expect(QUADRANT_META.weakening.cornerY).toBe("bottom");
  });
});
