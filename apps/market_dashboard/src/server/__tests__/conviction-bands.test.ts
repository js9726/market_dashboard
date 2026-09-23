/**
 * Band classification — score AND trigger.
 *
 * Regression for review finding R3 (2026-09-23): the 2026-09-22 recalibration
 * shipped `conviction >= 70 ? "GO" : ...` with no trigger term at all, so every
 * score over 70 was published as a full-size GO no matter what the lane said.
 */
import { describe, it, expect } from "vitest";
import { classifyConviction, type GateResult } from "@/server/conviction-analysis";

const SCORES = [64, 65, 69, 70, 74, 75];

describe("classifyConviction — the trigger term Codex found missing", () => {
  it("only a completed trigger at >=70 produces a full-size GO", () => {
    for (const c of SCORES) {
      const r = classifyConviction(c, "TRIGGERED");
      expect([r.verdict, r.sizePct]).toEqual(c >= 70 ? ["GO", 0.5] : c >= 65 ? ["PROBE", 0.25] : ["WATCH", 0]);
    }
  });

  it("an incomplete (ARMED) trigger caps every score at a half-size PROBE", () => {
    for (const c of SCORES) {
      const r = classifyConviction(c, "ARMED");
      expect(r.verdict).toBe(c >= 65 ? "PROBE" : "WATCH");
      expect(r.sizePct).toBe(c >= 65 ? 0.25 : 0);
    }
  });

  it("75 ARMED is a PROBE, not the GO the old code emitted", () => {
    const r = classifyConviction(75, "ARMED");
    expect(r.verdict).toBe("PROBE");
    expect(r.classification).toMatch(/trigger ARMED is incomplete/);
  });

  it.each(["INVALIDATED", "EXPIRED", "NEEDS-PIVOT"])("%s is PASS at any score", (state) => {
    for (const c of SCORES) expect(classifyConviction(c, state).verdict).toBe("PASS");
    expect(classifyConviction(100, state).sizePct).toBe(0);
  });

  it("an unknown or missing trigger state authorises no size (fail-closed)", () => {
    for (const state of [null, "", "  ", "MAYBE"]) {
      const r = classifyConviction(88, state);
      expect(r.verdict).toBe("WATCH");
      expect(r.moderator).toBe("WAIT");
      expect(r.sizePct).toBe(0);
    }
  });

  it("a failed hard gate outranks score and trigger together", () => {
    const gate: GateResult = { ok: false, code: "EXTENDED-GATE-FAIL", reason: "3.1xATR above the 21EMA" };
    const r = classifyConviction(100, "TRIGGERED", gate);
    expect(r).toMatchObject({ verdict: "PASS", moderator: "PASS", sizePct: 0 });
  });

  it("a passing gate object does not change the band", () => {
    const gate: GateResult = { ok: true, code: null, reason: "hard gates passed" };
    expect(classifyConviction(72, "TRIGGERED", gate).verdict).toBe("GO");
  });

  it("below 50 is PASS regardless of a completed trigger", () => {
    expect(classifyConviction(49, "TRIGGERED").verdict).toBe("PASS");
    expect(classifyConviction(50, "TRIGGERED").verdict).toBe("WATCH");
  });

  it("moderator and size never disagree with the verdict", () => {
    for (const c of [0, 49, 50, 64, 65, 69, 70, 74, 75, 100])
      for (const state of ["TRIGGERED", "ARMED", "INVALIDATED", "EXPIRED", "NEEDS-PIVOT", null]) {
        const r = classifyConviction(c, state);
        expect(r.moderator).toBe(r.verdict === "GO" || r.verdict === "PROBE" ? "ENTER" : r.verdict === "WATCH" ? "WAIT" : "PASS");
        expect(r.sizePct > 0).toBe(r.moderator === "ENTER");
        expect(r.classification.length).toBeGreaterThan(0);
      }
  });
});
