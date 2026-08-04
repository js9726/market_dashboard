import { describe, expect, it } from "vitest";
import { dailyScreenerPayloadSchema } from "@/lib/daily-screener/schema";
import {
  buildPaperSignals,
  finalRunFreshness,
} from "@/server/daily-screener-paper";

function payload() {
  return dailyScreenerPayloadSchema.parse({
    schemaVersion: "tradingview-daily-screener/v2",
    source: "tradingview-daily-screener",
    generatedBy: "codex-local",
    requiresSaasGeneration: false,
    excludedFromSaasRerun: true,
    runDate: "2026-08-03",
    generatedAt: "2026-08-03T20:00:00.000Z",
    reportMarkdown: "# Daily run",
    sections: [],
    candidates: {
      goList: [
        {
          ticker: "HPE",
          decision: "GO",
          source: "vcp-200ma",
          setup: "PB-21EMA",
          score: 78,
          entry: "above 49.89",
          stop: "46.30",
          target: "57.07",
          execution: { entry: 49.89, stop: 46.3, target: 57.07 },
          trigger: "range break on volume",
          cancel: "close below 46.30",
          whyGo: "Evidence-backed trigger.",
          evidence: {
            dailyChart: "hpe-daily.png",
            weeklyChart: "hpe-weekly.png",
            catalystSources: ["https://example.com/hpe"],
            freshnessAsOf: "2026-08-03 16:00 ET",
          },
        },
      ],
      watchList: [],
    },
    evidence: { runDir: "C:/run", screenshots: [], screeners: [] },
    chunks: [],
  });
}

describe("strict daily GO paper feed", () => {
  it("builds deterministic execution signals from final GO rows", () => {
    const signals = buildPaperSignals(payload(), {
      id: "run-1",
      goListHash: "hash-1",
    });
    expect(signals).toEqual([
      expect.objectContaining({
        signalId: "run-1:hash-1:HPE",
        ticker: "HPE",
        entryZone: 49.89,
        stop: 46.3,
        target: 57.07,
      }),
    ]);
  });

  it("rejects ordinary stale runs", () => {
    expect(
      finalRunFreshness(
        "2026-08-03",
        "2026-08-03T20:00:00.000Z",
        new Date("2026-08-05T12:01:00.000Z"),
      ).fresh,
    ).toBe(false);
  });

  it("allows Friday evidence through Monday's paper window", () => {
    const result = finalRunFreshness(
      "2026-07-31",
      "2026-07-31T20:00:00.000Z",
      new Date("2026-08-03T14:00:00.000Z"),
    );
    expect(result.fresh).toBe(true);
    expect(result.maxAgeHours).toBe(96);
  });
});
