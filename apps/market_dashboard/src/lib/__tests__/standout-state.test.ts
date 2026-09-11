import { describe, expect, it } from "vitest";
import type { BriefStandout } from "@/types/structured-brief";
import { resolveStandoutState } from "@/lib/brief/standout-state";

const selected: BriefStandout = {
  ticker: "NVDA",
  side: "LONG",
  score: 85,
  sector: "Technology",
  rs: 90,
  grade: "A",
  thesis: "Tight continuation setup.",
  entry: 180,
  stop: 174,
  target: 195,
  rrr: 2.5,
  tags: ["VCP"],
};

describe("resolveStandoutState", () => {
  it("keeps an unloaded brief in the loading state", () => {
    expect(resolveStandoutState(false, null)).toEqual({ status: "loading" });
  });

  it("treats a deliberate null as a completed no-pick decision", () => {
    expect(resolveStandoutState(true, null)).toEqual({ status: "none" });
  });

  it("returns the selected standout once the brief is complete", () => {
    expect(resolveStandoutState(true, selected)).toEqual({ status: "selected", standout: selected });
  });
});
