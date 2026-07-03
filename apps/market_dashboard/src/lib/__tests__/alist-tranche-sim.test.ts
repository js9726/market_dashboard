import { describe, expect, it } from "vitest";
import { simulateTranches, type SimBar } from "../alist-tranche-sim";

const b = (date: string, o: number, h: number, l: number, c: number): SimBar => ({ date, open: o, high: h, low: l, close: c });

describe("simulateTranches — 3-lot scale-out from the trigger day", () => {
  // Trigger day: close 100, low 96 → 1R = 4. Targets 104 / 108 / 112.
  const d0 = b("2026-06-01", 98, 101, 96, 100);

  it("stops all 3 lots at -1R when the stop hits first", () => {
    const sim = simulateTranches([d0, b("2026-06-02", 99, 100, 95, 95.5)], 5);
    expect(sim).not.toBeNull();
    expect(sim!.events).toHaveLength(1);
    expect(sim!.events[0].kind).toBe("STOP");
    expect(sim!.events[0].lots).toBe(3);
    expect(sim!.blendedR).toBe(-1);
  });

  it("scales out T1/T2 then stops the last lot at breakeven (not -1R)", () => {
    const sim = simulateTranches(
      [
        d0,
        b("2026-06-02", 100, 105, 99, 104.5), // T1 fills → stop rises to breakeven
        b("2026-06-03", 104, 109, 103, 108.5), // T2 fills
        b("2026-06-04", 108, 109, 99, 99.5), // breakeven stop hits the last lot
      ],
      5,
    );
    const kinds = sim!.events.map((e) => e.kind);
    expect(kinds).toEqual(["T1", "T2", "STOP"]);
    expect(sim!.events[2].r).toBe(0); // breakeven, the whole point of scaling
    expect(sim!.blendedR).toBe(1); // (+1 +2 +0) / 3
    expect(sim!.done).toBe(true);
  });

  it("is pessimistic when a bar spans both stop and target", () => {
    const sim = simulateTranches([d0, b("2026-06-02", 100, 105, 95, 104)], 5);
    expect(sim!.events[0].kind).toBe("STOP");
  });

  it("uses the ATR floor when the LoD stop is tighter than 0.75×ATR", () => {
    const tight = b("2026-06-01", 99, 101, 99.5, 100); // LoD stop only 0.5 away
    const sim = simulateTranches([tight, b("2026-06-02", 100, 101, 99.8, 100.5)], 4);
    expect(sim!.stopSource).toBe("atr-floor");
    expect(sim!.stop).toBeCloseTo(97, 5); // 100 − 0.75×4
  });

  it("marks open lots at the final close once the window completes", () => {
    const bars = [d0];
    for (let i = 2; i <= 16; i++) bars.push(b(`2026-06-${String(i).padStart(2, "0")}`, 100, 102, 99, 101));
    const sim = simulateTranches(bars, 5);
    expect(sim!.done).toBe(true);
    const mark = sim!.events.find((e) => e.kind === "MARK");
    expect(mark).toBeDefined();
    expect(mark!.lots).toBe(3);
    expect(sim!.blendedR).toBeCloseTo(0.25, 2); // (101−100)/4
  });
});
