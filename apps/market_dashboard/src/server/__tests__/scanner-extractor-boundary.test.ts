/**
 * The scanner -> extractor -> persistence boundary, end to end.
 *
 * Re-review finding 1 (2026-09-23). screener-scanner stopped emitting "GO" because a
 * trigger-free pre-score cannot assert one, but a-list-extractor still required a
 * literal "GO" for breakout and EP. Both units passed their own tests; the seam
 * between them dropped every non-pullback candidate. Nothing tested the seam.
 *
 * These tests run the REAL algoScore output through the REAL extractor.
 */
import { describe, it, expect } from "vitest";
import { algoScore } from "@/server/screener-scanner";
import { extractScreenerCandidates } from "@/server/a-list-extractor";

/** A raw screener row shaped as the scanner maps it, tuned to a given pattern. */
function rawHit(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ticker: "TEST", exchange: "NASDAQ", close: 100, market_cap_basic: 21e9,
    change: 6, "Perf.1M": 18, relative_volume_10d_calc: 2.4,
    "High.All": 105, "Low.All": 40, sector: "Technology", ...over,
  };
}

function fileOf(...hits: Record<string, unknown>[]) {
  return { screeners: [{ id: "test-screen", name: "Test", hits }] };
}

/** Scanner output, exactly as fetchScreeners would place it on the hit. */
function scanned(over: Record<string, unknown> = {}) {
  const h = rawHit(over);
  return { ...h, ...algoScore(h) };
}

describe("scanner -> extractor boundary", () => {
  it("the scanner never labels anything GO (it has no trigger state)", () => {
    for (const perf of [-30, 0, 10, 25, 60]) {
      const s = algoScore(rawHit({ "Perf.1M": perf }));
      expect(s.verdict).not.toBe("GO");
      expect(["PROBE", "WAIT", "PASS"]).toContain(s.verdict);
    }
  });

  it("a high-scoring BREAKOUT survives the extractor", () => {
    const hit = scanned({ change: 6, "Perf.1M": 18, relative_volume_10d_calc: 2.4 });
    expect(hit.verdict).toBe("PROBE");
    const out = extractScreenerCandidates(fileOf(hit));
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].ticker).toBe("TEST");
  });

  it("a high-scoring EP survives the extractor", () => {
    const hit = scanned({ ticker: "EPX", change: 14, "Perf.1M": 30, relative_volume_10d_calc: 5.0 });
    expect(extractScreenerCandidates(fileOf(hit)).map((c) => c.ticker)).toContain("EPX");
  });

  it("the persisted day0Verdict keeps the band the scanner assigned", () => {
    const hit = scanned();
    const out = extractScreenerCandidates(fileOf(hit));
    expect(out[0].day0Verdict).toBe(hit.verdict);
    expect(out[0].day0Verdict).not.toBe("WAIT"); // PROBE was collapsed to WAIT before the fix
  });

  it("a PROBE at 65-69 is admitted, not floored at the GO line", () => {
    const hit = { ...rawHit({ ticker: "MIDBAND" }), score: 66, verdict: "PROBE", pattern: "BREAKOUT" };
    const out = extractScreenerCandidates(fileOf(hit));
    expect(out.map((c) => c.ticker)).toContain("MIDBAND");
    expect(out[0].day0Verdict).toBe("PROBE");
  });

  it("a GO is still admitted if anything upstream ever produces one", () => {
    const hit = { ...rawHit({ ticker: "GOX" }), score: 82, verdict: "GO", pattern: "BREAKOUT" };
    const out = extractScreenerCandidates(fileOf(hit));
    expect(out[0].day0Verdict).toBe("GO");
  });

  it("WAIT and PASS are still rejected on the breakout lane", () => {
    for (const verdict of ["WAIT", "PASS"]) {
      const hit = { ...rawHit({ ticker: "LOW" }), score: 80, verdict, pattern: "BREAKOUT" };
      expect(extractScreenerCandidates(fileOf(hit))).toHaveLength(0);
    }
  });

  it("a PROBE below its own 65 floor is rejected", () => {
    const hit = { ...rawHit({ ticker: "TOOLOW" }), score: 64, verdict: "PROBE", pattern: "BREAKOUT" };
    expect(extractScreenerCandidates(fileOf(hit))).toHaveLength(0);
  });

  it("the breakout lane still requires the volume surge", () => {
    const hit = { ...rawHit({ ticker: "NOVOL", relative_volume_10d_calc: 0.9 }), score: 80, verdict: "PROBE", pattern: "BREAKOUT" };
    expect(extractScreenerCandidates(fileOf(hit))).toHaveLength(0);
  });

  it("the pullback lane still admits on contraction and keeps its band", () => {
    const hit = { ...rawHit({ ticker: "PB", relative_volume_10d_calc: 0.7 }), score: 66, verdict: "PROBE", pattern: "PULLBACK" };
    const out = extractScreenerCandidates(fileOf(hit));
    expect(out.map((c) => c.ticker)).toContain("PB");
    expect(out[0].day0Verdict).toBe("PROBE");
  });

  it("an empty or absent file is handled without throwing", () => {
    expect(extractScreenerCandidates(null)).toEqual([]);
    expect(extractScreenerCandidates({ screeners: [] })).toEqual([]);
  });
});
