import { describe, expect, it } from "vitest";
import {
  dailyScreenerPayloadSchema,
  formatTelegramGoList,
  goListPayloadHash,
  type DailyScreenerPayload,
} from "@/lib/daily-screener/schema";
import { deliverTelegramGoList } from "@/server/telegram-go";
import { paperExecutionEligibility } from "@/server/daily-screener-paper";

function payload(overrides: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: "tradingview-daily-screener/v2",
    source: "tradingview-daily-screener",
    generatedBy: "codex-local",
    requiresSaasGeneration: false,
    excludedFromSaasRerun: true,
    runDate: "2026-07-26",
    generatedAt: "2026-07-26T12:00:00.000Z",
    reportMarkdown: "# Daily run",
    sections: [{ title: "GO List", text: "" }],
    candidates: {
      goList: [],
      watchList: [],
      technicals: [],
    },
    evidence: { runDir: "C:/run", screenshots: [], screeners: [] },
    chunks: [],
    ...overrides,
  };
}

function goCandidate() {
  return {
    ticker: "nvda",
    decision: "GO",
    source: "vcp-200ma",
    setup: "BO-VCP",
    score: 82,
    entry: "above 181.20",
    stop: "176.40",
    target: "190.80",
    execution: { entry: 181.2, stop: 176.4, target: 190.8 },
    trigger: "pivot break on RVOL >= 1.5x",
    cancel: "close below 176.40",
    whyGo: "Tight base, supported catalyst, and defined risk.",
    evidence: {
      dailyChart: "nvda-daily.png",
      weeklyChart: "nvda-weekly.png",
      catalystSources: ["https://example.com/catalyst"],
      freshnessAsOf: "2026-07-26 10:15 ET",
    },
  };
}

describe("daily screener v2 payload", () => {
  it("accepts an explicit empty GO list", () => {
    const parsed = dailyScreenerPayloadSchema.parse(payload());
    expect(parsed.candidates.goList).toEqual([]);
    expect(formatTelegramGoList(parsed)).toContain("No GO tickers");
  });

  it("accepts the keyed technicals object emitted by the packager", () => {
    const parsed = dailyScreenerPayloadSchema.parse(
      payload({
        candidates: {
          goList: [],
          watchList: [],
          technicals: { generated_at: "2026-07-26T12:00:00Z", candidates: [] },
        },
      }),
    );
    expect(parsed.candidates.technicals).toEqual({
      generated_at: "2026-07-26T12:00:00Z",
      candidates: [],
    });
  });

  it("normalizes a valid GO ticker and formats the risk contract", () => {
    const parsed = dailyScreenerPayloadSchema.parse(
      payload({
        candidates: {
          goList: [goCandidate()],
          watchList: [],
          technicals: [],
        },
      }),
    );
    expect(parsed.candidates.goList[0].ticker).toBe("NVDA");
    const message = formatTelegramGoList(
      parsed,
      "https://market-dashboard.example/dashboard/trades",
    );
    expect(message).toContain("$NVDA");
    expect(message).toContain("Stop 176.40");
    expect(message).toContain("live broker untouched");
  });

  it("rejects GO rows without the final chart/catalyst evidence", () => {
    const candidate = goCandidate();
    candidate.evidence.weeklyChart = "";
    candidate.evidence.catalystSources = [];
    const parsed = dailyScreenerPayloadSchema.safeParse(
      payload({
        candidates: { goList: [candidate], watchList: [], technicals: [] },
      }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects GO rows whose execution levels are not structurally ordered", () => {
    const candidate = goCandidate();
    candidate.execution.stop = 182;
    const parsed = dailyScreenerPayloadSchema.safeParse(
      payload({
        candidates: { goList: [candidate], watchList: [], technicals: [] },
      }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects placeholder catalyst sources", () => {
    const candidate = goCandidate();
    candidate.evidence.catalystSources = ["needs verification"];
    const parsed = dailyScreenerPayloadSchema.safeParse(
      payload({
        candidates: { goList: [candidate], watchList: [], technicals: [] },
      }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects duplicate GO tickers", () => {
    const parsed = dailyScreenerPayloadSchema.safeParse(
      payload({
        candidates: {
          goList: [goCandidate(), { ...goCandidate(), ticker: "NVDA" }],
          watchList: [],
          technicals: [],
        },
      }),
    );
    expect(parsed.success).toBe(false);
  });

  it("dedupes identical final lists across providers", () => {
    const first = dailyScreenerPayloadSchema.parse(
      payload({
        candidates: { goList: [goCandidate()], watchList: [], technicals: [] },
      }),
    );
    const second = {
      ...first,
      generatedBy: "gemini-cloud",
    } satisfies DailyScreenerPayload;
    expect(goListPayloadHash(first)).toBe(goListPayloadHash(second));
  });

  it("fails closed when the dedicated Telegram secrets are absent", async () => {
    const oldToken = process.env.TELEGRAM_GO_BOT_TOKEN;
    const oldChatId = process.env.TELEGRAM_GO_CHAT_ID;
    delete process.env.TELEGRAM_GO_BOT_TOKEN;
    delete process.env.TELEGRAM_GO_CHAT_ID;
    try {
      const parsed = dailyScreenerPayloadSchema.parse(payload());
      await expect(deliverTelegramGoList(parsed)).resolves.toEqual({
        status: "not_configured",
        missing: ["TELEGRAM_GO_BOT_TOKEN", "TELEGRAM_GO_CHAT_ID"],
      });
    } finally {
      if (oldToken) process.env.TELEGRAM_GO_BOT_TOKEN = oldToken;
      if (oldChatId) process.env.TELEGRAM_GO_CHAT_ID = oldChatId;
    }
  });

  it("requires a GO refresh inside 60 minutes and the operator regular-session window", () => {
    const now = new Date("2026-08-03T14:15:00.000Z");
    expect(paperExecutionEligibility("2026-08-03", "2026-08-03T13:30:00.000Z", now)).toMatchObject({
      eligible: true,
      reason: null,
    });
    expect(paperExecutionEligibility("2026-08-03", "2026-08-03T12:00:00.000Z", now)).toMatchObject({
      eligible: false,
      reason: "stale_execution_go",
    });
    expect(paperExecutionEligibility("2026-08-03", "2026-08-03T16:00:00.000Z", new Date("2026-08-03T16:30:00.000Z"))).toMatchObject({
      eligible: false,
      reason: "outside_operator_entry_window",
    });
  });
});
