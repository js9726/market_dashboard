import { describe, expect, it } from "vitest";
import { TIERS, UNRANKED, tierForScore, tierInfo } from "@/lib/profile/tiers";

describe("TIERS ladder", () => {
  it("has 7 ranked tiers in descending minScore order", () => {
    expect(TIERS).toHaveLength(7);
    for (let i = 1; i < TIERS.length; i++) {
      expect(TIERS[i].minScore).toBeLessThan(TIERS[i - 1].minScore);
    }
  });

  it("starts at Legend and ends at Bronze", () => {
    expect(TIERS[0].key).toBe("legend");
    expect(TIERS[TIERS.length - 1].key).toBe("bronze");
  });
});

describe("tierForScore", () => {
  it("Legend at 90+", () => {
    expect(tierForScore(90).key).toBe("legend");
    expect(tierForScore(99).key).toBe("legend");
  });

  it("Masters at 80..89", () => {
    expect(tierForScore(80).key).toBe("masters");
    expect(tierForScore(89.9).key).toBe("masters");
  });

  it("Diamond at 70..79", () => {
    expect(tierForScore(70).key).toBe("diamond");
    expect(tierForScore(75).key).toBe("diamond");
  });

  it("Bronze at 0..39", () => {
    expect(tierForScore(39).key).toBe("bronze");
    expect(tierForScore(0).key).toBe("bronze");
  });

  it("Unranked for null/undefined/NaN", () => {
    expect(tierForScore(null).key).toBe("unranked");
    expect(tierForScore(undefined).key).toBe("unranked");
    expect(tierForScore(NaN).key).toBe("unranked");
  });
});

describe("tierInfo", () => {
  it("looks up by key", () => {
    expect(tierInfo("diamond").label).toBe("Diamond");
    expect(tierInfo("legend").label).toBe("Legend");
  });

  it("returns UNRANKED for the unranked key", () => {
    expect(tierInfo("unranked")).toBe(UNRANKED);
  });
});
