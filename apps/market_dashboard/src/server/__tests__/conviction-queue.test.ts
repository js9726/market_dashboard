import { describe, expect, it } from "vitest";
import { completedDailyPath, shouldQueueConviction } from "../conviction-queue";

const afterClose = new Date("2026-09-22T20:30:00Z");
const current = { triggerState: "ARMED", day0Score: 65, barDate: "2026-09-22", now: afterClose };
describe("completed-bar conviction lifecycle", () => {
  it("does not latch a trigger from an unfinished daily candle", () => {
    expect(completedDailyPath([{ date: "2026-09-21" }, { date: "2026-09-22" }],
      new Date("2026-09-22T15:05:00Z"))).toEqual([{ date: "2026-09-21" }]);
    expect(shouldQueueConviction({ ...current, previous: null,
      now: new Date("2026-09-22T15:05:00Z") })).toBe(false);
  });
  it("queues a completed ARMED probe and deduplicates its saved result", () => {
    expect(shouldQueueConviction({ ...current, previous: null })).toBe(true);
    expect(shouldQueueConviction({ ...current, previous: { ...current, barComplete: true } })).toBe(false);
  });
  it("re-scores when ARMED fires instead of freezing its PROBE forever", () => {
    expect(shouldQueueConviction({ ...current, triggerState: "TRIGGERED",
      previous: { ...current, barComplete: true } })).toBe(true);
  });
  it("re-scores a new daily bar and migrates legacy or unfinished results", () => {
    for (const previous of [{ ...current, barDate: "2026-09-21", barComplete: true },
      { ...current, barComplete: false }, { verdict: "WATCH" }]) {
      expect(shouldQueueConviction({ ...current, previous })).toBe(true);
    }
  });
  it("does not queue dead states or sub-probe ARMED scores", () => {
    for (const triggerState of [null, "INVALIDATED", "EXPIRED", "NEEDS-PIVOT"])
      expect(shouldQueueConviction({ ...current, triggerState, previous: null })).toBe(false);
    expect(shouldQueueConviction({ ...current, day0Score: 64, previous: null })).toBe(false);
  });
});
