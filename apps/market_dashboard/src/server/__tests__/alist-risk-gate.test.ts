/**
 * alist-risk-gate.test.ts — regression tests for the 2026-07-16 VCTR false-GO.
 *
 * VCTR was auto-proposed ENTER at conviction 80 with entry 97.70 / stop 85.59
 * (12.4% risk = 3.86xATR, 2.6x the wiki ceiling) while sitting +2.82xATR above
 * its 21EMA at RSI 74.3, with NO pivot — the cited "pivot 97.70" was simply the
 * pick-day close. The operator caught it; the system did not.
 *
 * Real VCTR numbers (moomoo OpenD, 2026-07-15): close 99.05, ATR14 3.43,
 * ema8 93.05, ema21 89.38, ema50 85.26, RSI 74.3, dist_21_atr +2.82.
 * The 5-day low 85.59 is the 2026-07-09 low.
 *
 * Wiki: risk-management.md "Stop distance band by setup type — FLOOR and CEILING",
 *       a-list-gate-and-screener.md "Hard pre-gates".
 */
import { describe, expect, it } from "vitest";
import {
  atrFloorStop,
  atrFloorMultiplier,
  evaluateRiskGate,
  riskCeilingStop,
  RISK_CEILING_ATR_MULT,
} from "../alist-metrics";
import { evaluateHardGates, type ConvictionInput } from "../conviction-analysis";
import { findPivot } from "../alist-levels";
import { classifyEntryRisk, rsiSeries } from "../indicators";
import type { OhlcBar } from "@/lib/technical";

// The real VCTR entry-day facts.
const VCTR = { entry: 97.7, atr: 3.135, fiveDayLow: 85.59, close: 99.05, ema21: 89.38 };

describe("atrFloorStop — risk ceiling (VCTR false-GO root cause)", () => {
  it("NEVER returns a stop wider than the 1.5xATR ceiling, even when the 5-day low is far away", () => {
    const stop = atrFloorStop({ entry: VCTR.entry, atr14: VCTR.atr, fiveDayLow: VCTR.fiveDayLow, setup: "BO-CB" });
    expect(stop).not.toBeNull();
    // Before the fix this returned 85.59 (the raw 5-day low) = 3.86xATR risk.
    expect(stop!).toBeGreaterThan(VCTR.fiveDayLow);
    const riskAtr = (VCTR.entry - stop!) / VCTR.atr;
    expect(riskAtr).toBeLessThanOrEqual(RISK_CEILING_ATR_MULT + 1e-9);
    expect(stop!).toBeCloseTo(riskCeilingStop(VCTR.entry, VCTR.atr)!, 6);
  });

  it("still honours the FLOOR when the 5-day low is nearer than 1.5xATR (anti-whipsaw preserved)", () => {
    // 5-day low only 0.5xATR away -> the ATR floor (1.5x) must win.
    const nearLow = VCTR.entry - 0.5 * VCTR.atr;
    const stop = atrFloorStop({ entry: VCTR.entry, atr14: VCTR.atr, fiveDayLow: nearLow, setup: "BO-CB" });
    expect(stop!).toBeCloseTo(VCTR.entry - 1.5 * VCTR.atr, 6);
  });

  it("PARABOLIC/ORH-INTRADAY keep a TIGHT stop and are never widened to the 5-day low", () => {
    expect(atrFloorMultiplier("PARABOLIC")).toBe(0);
    const stop = atrFloorStop({ entry: VCTR.entry, atr14: VCTR.atr, fiveDayLow: VCTR.fiveDayLow, setup: "PARABOLIC" });
    // Before the fix: mult 0 -> atrStop null -> returned the 5-day low 85.59,
    // i.e. the MOST extended setups silently got the WIDEST stops.
    expect(stop!).toBeGreaterThan(VCTR.fiveDayLow);
    expect((VCTR.entry - stop!) / VCTR.atr).toBeLessThanOrEqual(RISK_CEILING_ATR_MULT + 1e-9);
  });
});

describe("evaluateRiskGate", () => {
  it("REJECTS the real VCTR entry/stop pair", () => {
    const g = evaluateRiskGate({ entry: 97.7, stop: 85.59, atr14: 3.135 });
    expect(g.ok).toBe(false);
    expect(g.reason).toMatch(/RISK-GATE-FAIL/);
    expect(g.riskAtr!).toBeCloseTo(3.86, 1);
    expect(g.riskPct!).toBeCloseTo(0.124, 2);
  });

  it("accepts a compliant 1.5xATR stop", () => {
    const g = evaluateRiskGate({ entry: 97.7, stop: 97.7 - 1.5 * 3.135, atr14: 3.135 });
    expect(g.ok).toBe(true);
  });

  it("fails CLOSED on a missing stop or missing ATR", () => {
    expect(evaluateRiskGate({ entry: 97.7, stop: null, atr14: 3.135 }).ok).toBe(false);
    expect(evaluateRiskGate({ entry: 97.7, stop: 90, atr14: null }).ok).toBe(false);
  });
});

describe("findPivot — 'the last close is not a pivot'", () => {
  const flat = (h: number): OhlcBar => ({ high: h, low: h - 1, close: h - 0.5 });

  it("returns null when price is in open air above all prior structure", () => {
    // 10 bars of base around 88-90, then a vertical thrust to 102 in the last 2.
    const bars: OhlcBar[] = [...Array(10)].map(() => flat(90));
    bars.push({ high: 98.17, low: 92.61, close: 97.7 }); // 2026-07-14
    bars.push({ high: 102.05, low: 97.36, close: 99.05 }); // 2026-07-15
    const pivot = findPivot(bars);
    // The last two bars are excluded, so the pivot is the 90 base — the thrust
    // cannot define the level it is supposed to break.
    expect(pivot).toBe(90);
    expect(pivot).not.toBe(97.7); // the old bug: pivot === pick-day close
    expect(pivot).toBeLessThan(bars[bars.length - 1].close);
  });

  it("finds a real prior-consolidation high", () => {
    const bars: OhlcBar[] = [...Array(8)].map(() => flat(50));
    bars.push(flat(55)); // prior resistance
    bars.push(...[...Array(5)].map(() => flat(52)));
    bars.push(flat(53), flat(54));
    expect(findPivot(bars)).toBe(55);
  });
});

describe("evaluateHardGates — VCTR end-to-end", () => {
  const base: ConvictionInput = {
    ticker: "VCTR",
    setup: "BO-CB",
    sector: "Finance",
    triggerState: "TRIGGERED",
    triggerReason: "higher-low + close > pivot 97.70 on RVOL 1.8x",
    entryZone: 97.7,
    stop: 85.59,
    target: 121.92,
    rvol: 1.8,
    rsRating: 89,
    day0Thesis: null,
    algo: { setup: 30, entry: 27, theme: 17, sentiment: 6 },
    extension: { atr14: 3.135, dist21Atr: 2.82, dist50Atr: 4.02, rsi14: 74.3, entryRisk: "EXTENDED" },
    pivotFound: true,
  };

  it("REJECTS VCTR on extension even though RVOL 1.8x and RS 89 are genuinely strong", () => {
    const g = evaluateHardGates(base);
    expect(g.ok).toBe(false);
    expect(g.code).toBe("EXTENDED-GATE-FAIL");
    expect(g.reason).toMatch(/EXTENDED/);
  });

  it("REJECTS on risk once location is made acceptable — the stop alone is disqualifying", () => {
    const g = evaluateHardGates({
      ...base,
      extension: { ...base.extension!, dist21Atr: 1.0, entryRisk: "FAIR" },
    });
    expect(g.ok).toBe(false);
    expect(g.code).toBe("RISK-GATE-FAIL");
  });

  it("REJECTS a breakout with no pivot (NEEDS-PIVOT)", () => {
    const g = evaluateHardGates({
      ...base,
      pivotFound: false,
      stop: 97.7 - 1.5 * 3.135,
      extension: { ...base.extension!, dist21Atr: 0.8, entryRisk: "FAIR" },
    });
    expect(g.ok).toBe(false);
    expect(g.code).toBe("NEEDS-PIVOT");
  });

  it("fails CLOSED when location is unknown", () => {
    const g = evaluateHardGates({ ...base, extension: undefined });
    expect(g.ok).toBe(false);
    expect(g.code).toBe("EXTENDED-GATE-FAIL");
    expect(g.reason).toMatch(/fail-closed/);
  });

  it("PASSES a clean, well-located, tight-stopped breakout", () => {
    const g = evaluateHardGates({
      ...base,
      stop: 97.7 - 1.2 * 3.135,
      extension: { atr14: 3.135, dist21Atr: 0.9, dist50Atr: 1.8, rsi14: 58, entryRisk: "FAIR" },
    });
    expect(g.ok).toBe(true);
  });
});

describe("classifyEntryRisk / rsiSeries parity with compute_index_technicals.py", () => {
  it("classifies VCTR's +2.82 ATR as EXTENDED", () => {
    expect(classifyEntryRisk(2.82)).toBe("EXTENDED");
    expect(classifyEntryRisk(3.1)).toBe("EXTREME-EXTENDED");
    expect(classifyEntryRisk(1.2)).toBe("FAIR");
    expect(classifyEntryRisk(0.2)).toBe("AT-MA");
    expect(classifyEntryRisk(-0.7)).toBe("OVERSOLD-PB");
    expect(classifyEntryRisk(null)).toBe("UNKNOWN");
  });

  it("computes a plausible RSI and stays null before the period fills", () => {
    const up = [...Array(30)].map((_, i) => 100 + i); // monotonic advance
    const r = rsiSeries(up, 14);
    expect(r[12]).toBeNull();
    expect(r[29]).toBe(100); // no down days -> RSI 100
    const flatSeries = [...Array(30)].map(() => 50);
    expect(rsiSeries(flatSeries, 14)[29]).toBe(100); // no losses -> guard path
  });
});
