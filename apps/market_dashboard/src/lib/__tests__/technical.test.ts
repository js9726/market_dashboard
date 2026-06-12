import { describe, expect, it } from "vitest";
import { computeAtr, type OhlcBar } from "../technical";

function bar(high: number, low: number, close: number): OhlcBar {
  return { high, low, close };
}

describe("computeAtr", () => {
  it("returns null with insufficient bars", () => {
    expect(computeAtr([bar(10, 9, 9.5)], 14)).toBeNull();
  });

  it("computes the mean true range over the window", () => {
    // 15 identical bars: range 2, no gaps → ATR = 2
    const bars = Array.from({ length: 15 }, () => bar(102, 100, 101));
    expect(computeAtr(bars, 14)).toBeCloseTo(2, 6);
  });

  it("includes gap moves via the prev-close term", () => {
    const bars = [
      ...Array.from({ length: 14 }, () => bar(102, 100, 101)),
      bar(112, 110, 111), // gap up: TR = max(2, |112-101|, |110-101|) = 11
    ];
    const atr = computeAtr(bars, 14);
    // 13 bars of TR=2 plus one TR=11 → (13*2 + 11) / 14
    expect(atr).toBeCloseTo((13 * 2 + 11) / 14, 6);
  });
});
