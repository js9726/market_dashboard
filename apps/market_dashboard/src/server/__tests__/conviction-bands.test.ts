/**
 * Band classification — score AND trigger.
 *
 * Regression for review finding R3 (2026-09-23): the 2026-09-22 recalibration
 * shipped `conviction >= 70 ? "GO" : ...` with no trigger term at all, so every
 * score over 70 was published as a full-size GO no matter what the lane said.
 */
import { describe, it, expect } from "vitest";
import { classifyConviction, evaluateHardGates, type GateResult } from "@/server/conviction-analysis";
import { isDailyBarComplete } from "@/lib/market-clock";
import { classifyEntryRisk } from "@/server/indicators";

const SCORES = [64, 65, 69, 70, 74, 75];

describe("classifyConviction — the trigger term Codex found missing", () => {
  it("only a completed trigger at >=70 produces a full-size GO", () => {
    for (const c of SCORES) {
      const r = classifyConviction(c, "TRIGGERED", undefined, true);
      expect([r.verdict, r.sizePct]).toEqual(c >= 70 ? ["GO", 0.5] : c >= 65 ? ["PROBE", 0.25] : ["WATCH", 0]);
    }
  });

  it("an incomplete (ARMED) trigger caps every score at a half-size PROBE", () => {
    for (const c of SCORES) {
      const r = classifyConviction(c, "ARMED", undefined, true);
      expect(r.verdict).toBe(c >= 65 ? "PROBE" : "WATCH");
      expect(r.sizePct).toBe(c >= 65 ? 0.25 : 0);
    }
  });

  it("75 ARMED is a PROBE, not the GO the old code emitted", () => {
    const r = classifyConviction(75, "ARMED", undefined, true);
    expect(r.verdict).toBe("PROBE");
    expect(r.classification).toMatch(/trigger ARMED is incomplete/);
  });

  it.each(["INVALIDATED", "EXPIRED", "NEEDS-PIVOT"])("%s is PASS at any score", (state) => {
    for (const c of SCORES) expect(classifyConviction(c, state, undefined, true).verdict).toBe("PASS");
    expect(classifyConviction(100, state, undefined, true).sizePct).toBe(0);
  });

  it("an unknown or missing trigger state authorises no size (fail-closed)", () => {
    for (const state of [null, "", "  ", "MAYBE"]) {
      const r = classifyConviction(88, state, undefined, true);
      expect(r.verdict).toBe("WATCH");
      expect(r.moderator).toBe("WAIT");
      expect(r.sizePct).toBe(0);
    }
  });

  it("a failed hard gate outranks score and trigger together", () => {
    const gate: GateResult = { ok: false, code: "EXTENDED-GATE-FAIL", reason: "3.1xATR above the 21EMA" };
    const r = classifyConviction(100, "TRIGGERED", gate, true);
    expect(r).toMatchObject({ verdict: "PASS", moderator: "PASS", sizePct: 0 });
  });

  it("a passing gate object does not change the band", () => {
    const gate: GateResult = { ok: true, code: null, reason: "hard gates passed" };
    expect(classifyConviction(72, "TRIGGERED", gate, true).verdict).toBe("GO");
  });

  it("below 50 is PASS regardless of a completed trigger", () => {
    expect(classifyConviction(49, "TRIGGERED", undefined, true).verdict).toBe("PASS");
    expect(classifyConviction(50, "TRIGGERED", undefined, true).verdict).toBe("WATCH");
  });

  it("moderator and size never disagree with the verdict", () => {
    for (const c of [0, 49, 50, 64, 65, 69, 70, 74, 75, 100])
      for (const state of ["TRIGGERED", "ARMED", "INVALIDATED", "EXPIRED", "NEEDS-PIVOT", null]) {
        const r = classifyConviction(c, state, undefined, true);
        expect(r.moderator).toBe(r.verdict === "GO" || r.verdict === "PROBE" ? "ENTER" : r.verdict === "WATCH" ? "WAIT" : "PASS");
        expect(r.sizePct > 0).toBe(r.moderator === "ENTER");
        expect(r.classification.length).toBeGreaterThan(0);
      }
  });
});

describe("unfinished-bar veto (re-review finding 2)", () => {
  it("caps every score at WATCH while the bar is open", () => {
    for (const c of [65, 70, 75, 88, 100]) {
      const r = classifyConviction(c, "TRIGGERED", undefined, false);
      expect(r.verdict).toBe("WATCH");
      expect(r.sizePct).toBe(0);
      expect(r.classification).toMatch(/bar is not closed/);
    }
  });

  it("is fail-closed: omitting the flag is the same as an open bar", () => {
    expect(classifyConviction(88, "TRIGGERED").verdict).toBe("WATCH");
    expect(classifyConviction(88, "TRIGGERED").sizePct).toBe(0);
  });

  it("does not promote a sub-50 score to WATCH", () => {
    expect(classifyConviction(30, "TRIGGERED", undefined, false).verdict).toBe("PASS");
  });

  it("a closed bar restores the normal bands", () => {
    expect(classifyConviction(75, "TRIGGERED", undefined, true).verdict).toBe("GO");
  });
});

describe("isDailyBarComplete", () => {
  // 2026-09-22 was a Tuesday.
  const at = (iso: string) => new Date(iso);

  it("does not confuse overnight CLOSED with a completed current bar", () => {
    expect(isDailyBarComplete("2026-09-22", at("2026-09-22T06:00:00Z"))).toBe(false);
    expect(isDailyBarComplete("2026-09-22", at("2026-09-22T12:00:00Z"))).toBe(false);
  });
  it("rejects impossible dates and weekends and follows winter ET", () => {
    expect(isDailyBarComplete("2026-02-30", at("2026-09-22T20:30:00Z"))).toBe(false);
    expect(isDailyBarComplete("2026-09-20", at("2026-09-22T20:30:00Z"))).toBe(false);
    expect(isDailyBarComplete("2026-12-22", at("2026-12-22T20:30:00Z"))).toBe(false);
    expect(isDailyBarComplete("2026-12-22", at("2026-12-22T21:00:00Z"))).toBe(true);
  });

  it("a prior session's bar is complete", () => {
    expect(isDailyBarComplete("2026-09-21", at("2026-09-22T15:05:00Z"))).toBe(true);
  });

  it("today's bar is NOT complete during the regular session", () => {
    // 15:05 UTC = 11:05 ET — the exact moment VLO was scored GO.
    expect(isDailyBarComplete("2026-09-22", at("2026-09-22T15:05:00Z"))).toBe(false);
  });

  it("today's bar is complete after the close", () => {
    // 20:30 UTC = 16:30 ET.
    expect(isDailyBarComplete("2026-09-22", at("2026-09-22T20:30:00Z"))).toBe(true);
  });

  it("a future-dated or malformed bar is never complete", () => {
    expect(isDailyBarComplete("2026-09-23", at("2026-09-22T20:30:00Z"))).toBe(false);
    expect(isDailyBarComplete("not-a-date", at("2026-09-22T20:30:00Z"))).toBe(false);
    expect(isDailyBarComplete(null)).toBe(false);
    expect(isDailyBarComplete(undefined)).toBe(false);
  });
});

describe("evaluateHardGates — structural vetoes (re-review finding 3)", () => {
  const base = {
    ticker: "T", setup: "BO-CB", sector: null, triggerState: "TRIGGERED", triggerReason: null,
    entryZone: null, stop: null, target: null, rvol: 2, rsRating: null, day0Thesis: null,
    algo: { setup: null, entry: null, theme: null, sentiment: null }, pivotFound: true,
  };
  const ext = (dist: number, base10dPct: number | null = 5) => ({
    atr14: 2, dist21Atr: dist, dist50Atr: null, rsi14: null,
    entryRisk: "FAIR" as const, base10dPct,
  });

  it("blocks at EXACTLY 2.5 ATR — the boundary the veto exists for", () => {
    expect(evaluateHardGates({ ...base, extension: ext(2.5) }).ok).toBe(false);
  });

  it("admits just under the veto", () => {
    expect(evaluateHardGates({ ...base, extension: ext(2.49) }).ok).toBe(true);
  });

  it("admits DT's real 2026-09-22 location", () => {
    expect(evaluateHardGates({ ...base, extension: { ...ext(2.24), entryRisk: classifyEntryRisk(2.24) } }).ok).toBe(true);
  });

  it("rejects non-finite measurements instead of letting comparisons fail open", () => {
    expect(evaluateHardGates({ ...base, extension: ext(NaN) }).ok).toBe(false);
    expect(evaluateHardGates({ ...base, extension: ext(1.8, NaN) }).ok).toBe(false);
    expect(classifyConviction(NaN, "TRIGGERED", undefined, true).sizePct).toBe(0);
    expect(classifyConviction(Infinity, "TRIGGERED", undefined, true).sizePct).toBe(0);
    expect(classifyConviction(80, "INVALIDATED", undefined, false).verdict).toBe("PASS");
  });

  it("applies the combined veto: wide base AND >= 1.5 ATR", () => {
    expect(evaluateHardGates({ ...base, extension: ext(1.6, 22) }).ok).toBe(false);
    expect(evaluateHardGates({ ...base, extension: ext(1.6, 12) }).ok).toBe(true);
  });

  it("neither half of the combined veto blocks alone", () => {
    expect(evaluateHardGates({ ...base, extension: ext(1.4, 22) }).ok).toBe(true);
    expect(evaluateHardGates({ ...base, extension: ext(1.6, 18) }).ok).toBe(true);
  });

  it("an unknown base width is fail-closed INSIDE the risk zone only", () => {
    expect(evaluateHardGates({ ...base, extension: ext(1.6, null) }).ok).toBe(false);
    expect(evaluateHardGates({ ...base, extension: ext(0.4, null) }).ok).toBe(true);
  });
});
