/**
 * Downstream band migration (review finding R2, completed 2026-09-23 on Jie's decision).
 *
 * The scorer moved to GO>=70+trigger / PROBE 65-69 on 2026-09-22 while seven downstream
 * sites stayed at 75, so a 70-74 GO was scored and then silently dropped before it could
 * reach the A-list. These tests pin the completed contract, including the one deliberate
 * exception: retrospective grading uses the bar that was live on the entry date.
 */
import { describe, it, expect } from "vitest";
import { gradeEntryVsBar, scoreBarFor, BAND_RECALIBRATION_DATE } from "@/server/alist-metrics";

describe("scoreBarFor — history is graded against its own bar", () => {
  it("uses 75 before the recalibration and 70 from that date on", () => {
    expect(scoreBarFor("2026-09-19")).toBe(75);
    expect(scoreBarFor("2026-09-21")).toBe(75);
    expect(scoreBarFor(BAND_RECALIBRATION_DATE)).toBe(70);
    expect(scoreBarFor("2026-09-23")).toBe(70);
  });

  it("defaults to the current bar when the date is unknown", () => {
    expect(scoreBarFor(null)).toBe(70);
    expect(scoreBarFor(undefined)).toBe(70);
  });
});

describe("gradeEntryVsBar", () => {
  const base = { rvol: 2.0, setup: "BO-CB" };

  it("a 72 entry taken before the change still fails its bar", () => {
    const g = gradeEntryVsBar({ ...base, score: 72, verdict: "GO", entryDate: "2026-09-19" });
    expect(g.passedBar).toBe(false);
    expect(g.reasons).toContain("score 72 < 75");
  });

  it("the same 72 entry taken after the change passes", () => {
    expect(gradeEntryVsBar({ ...base, score: 72, verdict: "GO", entryDate: "2026-09-23" }).passedBar).toBe(true);
  });

  it("PROBE counts as a qualifying verdict, WAIT does not", () => {
    expect(gradeEntryVsBar({ ...base, score: 72, verdict: "PROBE", entryDate: "2026-09-23" }).passedBar).toBe(true);
    const wait = gradeEntryVsBar({ ...base, score: 72, verdict: "WAIT", entryDate: "2026-09-23" });
    expect(wait.passedBar).toBe(false);
    expect(wait.reasons.some((r) => r.includes("not GO/PROBE"))).toBe(true);
  });

  it("an off-book entry is still ungraded, not failed", () => {
    const g = gradeEntryVsBar({ score: null, verdict: null, rvol: null });
    expect(g.grade).toBeNull();
    expect(g.passedBar).toBe(false);
  });

  it("the RVOL surge still binds for breakouts and is still waived for pullbacks", () => {
    expect(gradeEntryVsBar({ score: 80, verdict: "GO", rvol: 1.0, setup: "BO-CB", entryDate: "2026-09-23" }).passedBar).toBe(false);
    expect(gradeEntryVsBar({ score: 80, verdict: "GO", rvol: 1.0, setup: "PB-21EMA", entryDate: "2026-09-23" }).passedBar).toBe(true);
  });

  it("reason strings quote the bar actually applied", () => {
    expect(gradeEntryVsBar({ ...base, score: 60, verdict: "GO", entryDate: "2026-09-19" }).reasons).toContain("score 60 < 75");
    expect(gradeEntryVsBar({ ...base, score: 60, verdict: "GO", entryDate: "2026-09-23" }).reasons).toContain("score 60 < 70");
  });
});
