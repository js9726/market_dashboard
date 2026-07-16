import { describe, expect, it } from "vitest";
import { evaluateTrigger, type TriggerBar } from "../alist-triggers";

function bar(p: Partial<TriggerBar> & { date: string; o: number; h: number; l: number; c: number }): TriggerBar {
  return { date: p.date, open: p.o, high: p.h, low: p.l, close: p.c, ema8: p.ema8 ?? null, ema21: p.ema21 ?? null, rvol: p.rvol ?? 1 };
}

describe("evaluateTrigger — EP-FRESH", () => {
  const d0 = bar({ date: "2026-06-01", o: 30, h: 34, l: 29, c: 33 });

  it("INVALIDATES on a gap-fade below the EP-day low (the ONTO case)", () => {
    const r = evaluateTrigger("EP-FRESH", [d0, bar({ date: "2026-06-02", o: 32, h: 33, l: 27, c: 28, rvol: 1.2 })], null);
    expect(r.state).toBe("INVALIDATED");
    expect(r.reason).toMatch(/lost range/);
  });

  it("TRIGGERS on a daily continuation that holds the range on volume", () => {
    const r = evaluateTrigger("EP-FRESH", [d0, bar({ date: "2026-06-02", o: 33, h: 36, l: 32, c: 35, rvol: 1.4 })], null);
    expect(r.state).toBe("TRIGGERED");
    expect(r.dayIndex).toBe(1);
  });

  it("EXPIRES if no trigger within the 2-session EP window", () => {
    const flat = (d: string) => bar({ date: d, o: 33, h: 33.5, l: 32.5, c: 33, rvol: 0.8 });
    const r = evaluateTrigger("EP-FRESH", [d0, flat("2026-06-02"), flat("2026-06-03"), flat("2026-06-04")], null);
    expect(r.state).toBe("EXPIRED");
  });
});

describe("evaluateTrigger — BO-CB", () => {
  const d0 = bar({ date: "2026-06-01", o: 60, h: 62, l: 59, c: 61.5 });

  it("TRIGGERS on a higher-low + pivot break on volume (day-2+ rule)", () => {
    const r = evaluateTrigger("BO-CB", [d0, bar({ date: "2026-06-02", o: 61, h: 63, l: 60, c: 62.5, rvol: 1.3 })], 62);
    expect(r.state).toBe("TRIGGERED");
    expect(r.reason).toMatch(/higher-low/);
  });

  it("INVALIDATES on a close below the breakout-day low", () => {
    const r = evaluateTrigger("BO-CB", [d0, bar({ date: "2026-06-02", o: 60, h: 60.5, l: 57, c: 58, rvol: 1.1 })], 62);
    expect(r.state).toBe("INVALIDATED");
  });

  it("stays ARMED inside the window with no trigger yet", () => {
    const r = evaluateTrigger("BO-CB", [d0, bar({ date: "2026-06-02", o: 61, h: 61.8, l: 60, c: 61, rvol: 0.7 })], 62);
    expect(r.state).toBe("ARMED");
  });

  // 2026-07-16 (VCTR false-GO): a null pivot previously fell back to `d0.high`,
  // and upstream the "pivot" was the pick-day CLOSE — so a breakout could fire
  // with nothing to break out of. A breakout with no pivot now fails closed.
  it("NEEDS-PIVOT when no prior-consolidation high exists (never falls back to d0.high)", () => {
    const r = evaluateTrigger("BO-CB", [d0, bar({ date: "2026-06-02", o: 61, h: 63, l: 60, c: 62.5, rvol: 1.3 })], null);
    expect(r.state).toBe("NEEDS-PIVOT");
    expect(r.reason).toMatch(/not a pivot/);
  });
});

describe("evaluateTrigger — PB-21EMA", () => {
  const d0 = bar({ date: "2026-06-01", o: 100, h: 101, l: 98, c: 99, ema8: 100, ema21: 96 });

  it("TRIGGERS on an 8EMA reclaim with volume expansion", () => {
    const r = evaluateTrigger("PB-21EMA", [d0, bar({ date: "2026-06-02", o: 99, h: 103, l: 99, c: 102, ema8: 100.5, ema21: 96.5, rvol: 1.3 })], null);
    expect(r.state).toBe("TRIGGERED");
    expect(r.reason).toMatch(/reclaim 8EMA/);
  });

  it("INVALIDATES on a decisive close below the 21EMA", () => {
    const r = evaluateTrigger("PB-21EMA", [d0, bar({ date: "2026-06-02", o: 98, h: 98.5, l: 93, c: 93.5, ema8: 99, ema21: 96, rvol: 1.1 })], null);
    expect(r.state).toBe("INVALIDATED");
  });
});

// ── Wiki pre-screen (entry-methods 2026-07-02: intraday trigger ≠ setup) ──────
import { preScreenStructure } from "../alist-triggers";

describe("preScreenStructure — doctrine pre-screen", () => {
  const steady = (d: number, px: number) =>
    bar({ date: `2026-06-${String(d).padStart(2, "0")}`, o: px, h: px * 1.01, l: px * 0.99, c: px * 1.005, rvol: 0.9 });

  it("passes a quiet, tight structure", () => {
    const bars = Array.from({ length: 21 }, (_, i) => steady(i + 1, 100 + i * 0.2));
    const r = preScreenStructure(bars);
    expect(r.pass).toBe(true);
  });

  it("fails a wide-and-loose structure (the GFS 2026-07-01 case)", () => {
    // Alternating ±6-8% swings like GFS's June range.
    let px = 100;
    const bars = [steady(1, px)];
    for (let i = 2; i <= 21; i++) {
      px = i % 2 === 0 ? px * 1.07 : px * 0.93;
      bars.push(bar({ date: `2026-06-${String(i).padStart(2, "0")}`, o: px, h: px * 1.02, l: px * 0.98, c: px, rvol: 0.9 }));
    }
    const r = preScreenStructure(bars);
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/wide-and-loose/);
  });

  it("fails on repeated high-volume distribution days", () => {
    const bars = Array.from({ length: 21 }, (_, i) => steady(i + 1, 100));
    bars[10] = bar({ date: "2026-06-11", o: 100, h: 100.5, l: 96, c: 97, rvol: 2.2 });
    bars[15] = bar({ date: "2026-06-16", o: 99, h: 99.5, l: 95, c: 96, rvol: 1.8 });
    const r = preScreenStructure(bars);
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/distribution-heavy/);
  });
});
