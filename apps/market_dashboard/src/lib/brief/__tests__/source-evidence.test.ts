import { describe, expect, it } from "vitest";
import { isBriefInputFresh, liveIdeasFromBrief, markIngestUnverified, reconcileSnapshotBrief } from "../source-evidence";
import { selectFreshestBriefWithContent } from "../provider-selection";
import type { ComposedSnapshot } from "../snapshot";
import type { BriefSymbolEvidence, StructuredBrief } from "@/types/structured-brief";

const now = new Date("2026-10-05T14:50:00Z");
const observedAt = "2026-10-05T14:49:30Z";
const evidence: BriefSymbolEvidence = { observedAt, source: "test-quote", kind: "quote", price: 29,
  changePct: -1.75, rvol: null };
const raw = { movers: [{ ticker: "VKTX", side: "LONG", changePct: 35.67,
  why: "Catalyst with 16.2x RVOL", traderLens: "Buy now" }],
  standout: { ticker: "VKTX", side: "LONG", score: 99 }, news: [{ headline: "unsupported" }],
  calendar: [{ name: "unsupported" }], ratings: { upgrades: [{ ticker: "VKTX" }] } } as StructuredBrief;
function snapshot(symbols: Record<string, BriefSymbolEvidence> = {}): ComposedSnapshot {
  return { builtAt: now.toISOString(), baselineBuiltAt: null, liveAsOf: observedAt, indices: {},
    sectors: {}, watchlist: {}, industryMovers: [], breadth: null, marketDirection: null,
    baseline: null, symbolEvidence: symbols };
}

describe("brief source evidence", () => {
  it("requires age, market date, valid timestamp and bounded future skew", () => {
    expect(isBriefInputFresh(observedAt, now)).toBe(true);
    for (const at of [null, "bad", "2026-10-05", "2026-10-05T13:40:00Z", "2026-10-02T14:49:30Z", "2026-10-05T15:00:00Z"]) {
      expect(isBriefInputFresh(at, now)).toBe(false);
    }
    expect(isBriefInputFresh("2026-10-05T03:59:59Z", new Date("2026-10-05T04:01:00Z"))).toBe(false);
  });

  it("cannot promote an unsupported VKTX claim using fresh indices or a new write", () => {
    const result = reconcileSnapshotBrief(raw, snapshot({ SPY: evidence }), now);
    expect(result.movers).toEqual([]);
    expect(result.standout).toBeNull();
    expect(liveIdeasFromBrief(raw, now)).toBeNull();
    expect(selectFreshestBriefWithContent({ gemini: {
      structured: raw, generatedAt: now.toISOString(), stale: false, error: null,
    } }, now)).toBeNull();
  });

  it("copies observed values and discards model metrics, catalyst text and trade ratings", () => {
    const result = reconcileSnapshotBrief(raw, snapshot({ VKTX: evidence }), now);
    expect(result.movers).toEqual([{ ticker: "VKTX", side: null, changePct: -1.75, rvol: null,
      observedAt, source: "test-quote", why: null, traderLens: null }]);
    expect(result.news).toBeNull();
    expect(result.ratings).toBeNull();
    expect(result.calendar).toBeNull();
    expect(result.standout).toBeNull();
    expect(liveIdeasFromBrief(result, now)?.movers?.[0].changePct).toBe(-1.75);
    expect(selectFreshestBriefWithContent({ gemini: {
      structured: result, liveIdeas: result, generatedAt: now.toISOString(), stale: false, error: null,
    } }, now)?.entry.liveIdeasAsOf).toBe(observedAt);
  });

  it("expires each symbol independently, even if the cache was written just now", () => {
    const result = reconcileSnapshotBrief(raw, snapshot({ VKTX: evidence }), now);
    expect(liveIdeasFromBrief(result, new Date("2026-10-05T14:52:00Z"))).toBeNull();
    const mixed = { ...result, movers: [...result.movers!, { ...result.movers![0], ticker: "SPY" }],
      marketEvidence: { ...result.marketEvidence!, symbols: { VKTX: { ...evidence, observedAt: "2026-10-02T14:49:30Z" }, SPY: evidence } } };
    expect(liveIdeasFromBrief(mixed, now)?.movers?.map((m) => m.ticker)).toEqual(["SPY"]);
  });

  it("external ingest cannot forge server provenance or inherit validation from a previous row", () => {
    const result = reconcileSnapshotBrief(raw, snapshot({ VKTX: evidence }), now);
    const ingested = markIngestUnverified(result) as StructuredBrief;
    expect(ingested.movers).toEqual(result.movers);
    expect(ingested.marketEvidence?.status).toBe("unverified");
    expect(liveIdeasFromBrief(ingested, now)).toBeNull();
  });
});
