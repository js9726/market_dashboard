import { describe, expect, it } from "vitest";
import {
  MARKET_CONDITIONS,
  MOOD_EMOJIS,
  MOOD_OPTIONS,
  SLEEP_HOURS_MAX,
  SLEEP_HOURS_MIN,
  isValidMarketCondition,
  isValidMood,
  isValidSleepHours,
  moodLabel,
  moodScore,
} from "@/lib/journal/mood";

describe("MOOD_OPTIONS", () => {
  it("exposes exactly 5 options spanning -2..+2", () => {
    expect(MOOD_OPTIONS).toHaveLength(5);
    const scores = MOOD_OPTIONS.map((m) => m.score);
    expect(scores).toEqual([-2, -1, 0, 1, 2]);
  });

  it("MOOD_EMOJIS mirrors MOOD_OPTIONS emoji column", () => {
    expect(MOOD_EMOJIS).toEqual(MOOD_OPTIONS.map((m) => m.emoji));
  });
});

describe("moodScore", () => {
  it("returns the option's score for a known emoji", () => {
    expect(moodScore("😣")).toBe(-2);
    expect(moodScore("😐")).toBe(0);
    expect(moodScore("😄")).toBe(2);
  });

  it("returns null for unknown / empty input", () => {
    expect(moodScore("🐈")).toBeNull();
    expect(moodScore(null)).toBeNull();
    expect(moodScore(undefined)).toBeNull();
    expect(moodScore("")).toBeNull();
  });
});

describe("moodLabel", () => {
  it("returns the human label for a known emoji", () => {
    expect(moodLabel("😣")).toBe("Frustrated");
    expect(moodLabel("🙂")).toBe("Confident");
  });
  it("returns null for unknown / empty input", () => {
    expect(moodLabel("🐶")).toBeNull();
    expect(moodLabel(null)).toBeNull();
  });
});

describe("isValidMood", () => {
  it("accepts every defined emoji", () => {
    for (const opt of MOOD_OPTIONS) {
      expect(isValidMood(opt.emoji)).toBe(true);
    }
  });
  it("rejects unknown emoji + nullish", () => {
    expect(isValidMood("🤡")).toBe(false);
    expect(isValidMood(null)).toBe(false);
    expect(isValidMood(undefined)).toBe(false);
    expect(isValidMood("")).toBe(false);
  });
});

describe("isValidMarketCondition", () => {
  it("accepts each defined condition", () => {
    for (const c of MARKET_CONDITIONS) {
      expect(isValidMarketCondition(c)).toBe(true);
    }
  });
  it("accepts null (treated as 'not specified')", () => {
    expect(isValidMarketCondition(null)).toBe(true);
    expect(isValidMarketCondition(undefined)).toBe(true);
  });
  it("rejects unknown values", () => {
    expect(isValidMarketCondition("nuclear war")).toBe(false);
  });
});

describe("isValidSleepHours", () => {
  it("accepts in-range numbers", () => {
    expect(isValidSleepHours(SLEEP_HOURS_MIN)).toBe(true);
    expect(isValidSleepHours(SLEEP_HOURS_MAX)).toBe(true);
    expect(isValidSleepHours(6.5)).toBe(true);
  });
  it("accepts null + undefined as 'not specified'", () => {
    expect(isValidSleepHours(null)).toBe(true);
    expect(isValidSleepHours(undefined)).toBe(true);
  });
  it("rejects out-of-range + non-finite", () => {
    expect(isValidSleepHours(-0.5)).toBe(false);
    expect(isValidSleepHours(12.5)).toBe(false);
    expect(isValidSleepHours(NaN)).toBe(false);
    expect(isValidSleepHours(Infinity)).toBe(false);
  });
});
