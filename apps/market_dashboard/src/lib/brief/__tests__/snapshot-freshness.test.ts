import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readFile: vi.fn(), findMany: vi.fn(), liveIndices: vi.fn() }));
vi.mock("node:fs/promises", () => ({ default: { readFile: mocks.readFile } }));
vi.mock("@/lib/prisma", () => ({ prisma: { liveQuote: { findMany: mocks.findMany } } }));
vi.mock("@/lib/live-index-quotes", () => ({ getLiveIndexQuotes: mocks.liveIndices }));
import { composeSnapshot } from "../snapshot";

const fresh = "2026-10-05T14:49:30Z";
const stale = "2026-10-02T14:49:30Z";
function files(baselineAt: string, screenerAt: string, breadthAt: string) {
  mocks.readFile.mockImplementation(async (path: string) => JSON.stringify(path.endsWith("snapshot.json")
    ? { built_at: baselineAt, industry_performance: { all: [{ industry: "OldIndustry", perf_1d: 35 }] } }
    : path.endsWith("tv_screeners.json")
      ? { fetched_at: screenerAt, screeners: [{ id: "ep", name: "EP", hits: [{ ticker: "VKTX", industry: "Biotech",
        change: 35.67, close: 30, relative_volume_10d_calc: 16.2 }] }] }
      : { as_of: breadthAt, built_at: fresh, market: { advance: 99, decline: 1 }, industries: [] }));
}
describe("snapshot independent source gates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T14:50:00Z"));
    mocks.findMany.mockResolvedValue([{ symbol: "SPY", price: 600, changePct: -1,
      observedAt: new Date(fresh), source: "test" }]);
    mocks.liveIndices.mockResolvedValue([]);
  });
  afterEach(() => vi.useRealTimers());

  it("fresh indices never bless old baseline, screeners or breadth (even when breadth was rewritten)", async () => {
    files(stale, stale, stale);
    const result = await composeSnapshot(["VKTX"]);
    expect(result.indices.SPY.changePct).toBe(-1);
    expect(result.liveAsOf).toBe(new Date(fresh).toISOString());
    expect(result.baseline).toBeNull();
    expect(result.breadth).toBeNull();
    expect(result.industryMovers).toEqual([]);
    expect(result.symbolEvidence?.VKTX).toBeUndefined();
  });

  it("accepts only the independently fresh screener and preserves symbol provenance", async () => {
    files(stale, fresh, stale);
    const result = await composeSnapshot([]);
    expect(result.baseline).toBeNull();
    expect(result.breadth).toBeNull();
    expect(result.industryMovers.map((r) => r.industry)).toEqual(["Biotech"]);
    expect(result.symbolEvidence?.VKTX).toMatchObject({ observedAt: fresh, source: "TradingView: EP", changePct: 35.67 });
  });

  it("uses the newer quote rather than the larger screener move and drops unrelated RVOL", async () => {
    files(stale, "2026-10-05T14:45:00Z", stale);
    mocks.findMany.mockResolvedValue([{ symbol: "VKTX", price: 29, changePct: -1.75,
      observedAt: new Date(fresh), source: "test-quote" }]);
    const result = await composeSnapshot(["VKTX"]);
    expect(result.symbolEvidence?.VKTX).toMatchObject({ changePct: -1.75, rvol: null, source: "test-quote" });
    expect(result.industryMovers[0].leaders?.[0].changePct).toBe(-1.75);
  });

  it("orders timestamps by instant across offsets, not lexically", async () => {
    files(stale, "2026-10-05T10:49:45-04:00", stale);
    mocks.findMany.mockResolvedValue([{ symbol: "VKTX", price: 29, changePct: -1.75,
      observedAt: new Date(fresh), source: "test-quote" }]);
    const result = await composeSnapshot(["vktx", "VKTX"]);
    expect(result.symbolEvidence?.VKTX).toMatchObject({ kind: "screener", changePct: 35.67 });
  });
});
