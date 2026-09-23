import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  getOwnerUserId: vi.fn(),
  reconcileClosedHeld: vi.fn(),
  runConvictionAnalysis: vi.fn(),
  marketContextNow: vi.fn(),
  callLLM: vi.fn(),
}));

const db = vi.hoisted(() => ({
  brokerDailyBar: { findMany: vi.fn() },
  positionDailyTrack: { upsert: vi.fn() },
  aListCandidate: {
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/server/a-list-extractor", () => ({
  getOwnerUserId: (...args: unknown[]) => mocks.getOwnerUserId(...args),
}));
vi.mock("@/server/alist-close", () => ({
  reconcileClosedHeld: (...args: unknown[]) => mocks.reconcileClosedHeld(...args),
}));
vi.mock("@/server/conviction-analysis", () => ({
  runConvictionAnalysis: (...args: unknown[]) => mocks.runConvictionAnalysis(...args),
}));
vi.mock("@/utils/llm-router", () => ({ callLLM: (...args: unknown[]) => mocks.callLLM(...args) }));
vi.mock("@/lib/market-context", () => ({
  marketContextNow: (...args: unknown[]) => mocks.marketContextNow(...args),
}));

import { GET } from "@/app/api/cron/track-positions/route";

type TestCandle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

function decimal(value: number | null) {
  return value == null ? null : new Prisma.Decimal(value);
}

function weekdaysThrough(end: string, count: number): string[] {
  const days: string[] = [];
  const cursor = new Date(`${end}T00:00:00.000Z`);
  while (days.length < count) {
    if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) {
      days.unshift(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return days;
}

function candle(date: string, values: Partial<Omit<TestCandle, "date">> = {}): TestCandle {
  return {
    date,
    open: 100,
    high: 100.5,
    low: 99.5,
    close: 100,
    volume: 1_000,
    ...values,
  };
}

const history = weekdaysThrough("2026-09-21", 24).map((date) => candle(date));
const pickBar = candle("2026-09-22", { high: 101 });
const triggerBar = candle("2026-09-23", {
  high: 103,
  low: 99.75,
  close: 102,
  volume: 2_000,
});

function candidate(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    userId: "owner",
    ticker: id.toUpperCase(),
    status: "ACTIVE",
    isHeld: false,
    pickDate: new Date("2026-09-22T00:00:00.000Z"),
    entryFillAt: null,
    entryAvgCost: null,
    entryZone: decimal(100),
    day0Price: decimal(100),
    heldQty: null,
    stop: decimal(99),
    target: decimal(150),
    setupClassification: "EP-FRESH",
    sector: "Technology",
    day0Thesis: "Deterministic test fixture",
    day0Score: 70,
    day0Rvol: decimal(1),
    setupScore: 20,
    entryScore: 20,
    themeScore: 15,
    sentimentScore: 15,
    triggerState: "ARMED",
    triggerStateAt: null,
    triggerReason: "awaiting first forward session",
    agentConviction: null,
    agentConvictionAt: null,
    day14ComputedAt: null,
    exitMarket: null,
    ...extra,
  };
}

function yahooResponse(candles: TestCandle[]) {
  return {
    ok: true,
    json: async () => ({
      chart: {
        result: [{
          timestamp: candles.map((bar) => Math.floor(new Date(`${bar.date}T12:00:00.000Z`).getTime() / 1_000)),
          indicators: {
            quote: [{
              open: candles.map((bar) => bar.open),
              high: candles.map((bar) => bar.high),
              low: candles.map((bar) => bar.low),
              close: candles.map((bar) => bar.close),
              volume: candles.map((bar) => bar.volume),
            }],
          },
        }],
      },
    }),
  };
}

function cronRequest() {
  return new Request("http://localhost/api/cron/track-positions", {
    headers: { authorization: "Bearer test-cron-secret" },
  });
}

async function runCron() {
  const response = await GET(cronRequest());
  expect(response.status).toBe(200);
  return response.json() as Promise<Record<string, unknown>>;
}

function installStatefulCandidateUpdates(rows: Array<Record<string, any>>) {
  db.aListCandidate.update.mockImplementation(async ({ where, data }) => {
    const row = rows.find((item) => item.id === where.id);
    if (row) Object.assign(row, data);
    return row ?? null;
  });
}

describe("track-positions completed-bar conviction integration", () => {
  beforeEach(async () => {
    const actualScorer = await vi.importActual<typeof import("@/server/conviction-analysis")>("@/server/conviction-analysis");
    vi.useFakeTimers();
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    vi.stubEnv("LLM_DISABLED", "0");
    mocks.getOwnerUserId.mockResolvedValue("owner");
    mocks.reconcileClosedHeld.mockResolvedValue({ closed: [] });
    mocks.marketContextNow.mockResolvedValue(null);
    mocks.callLLM.mockResolvedValue(JSON.stringify({ setup: 32, entry: 24, theme: 14, sentiment: 7,
      moderator: "ENTER", verdict: "GO", reasoning: {} }));
    mocks.runConvictionAnalysis.mockImplementation(actualScorer.runConvictionAnalysis);
    db.brokerDailyBar.findMany.mockResolvedValue([]);
    db.positionDailyTrack.upsert.mockResolvedValue({});
    db.aListCandidate.update.mockResolvedValue({});
    db.aListCandidate.updateMany.mockResolvedValue({ count: 0 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("drops the current partial candle and clears a legacy trigger latched from it", async () => {
    vi.setSystemTime(new Date("2026-09-23T19:00:00.000Z")); // 15:00 ET
    const row = candidate("partial", {
      triggerState: "TRIGGERED",
      triggerStateAt: new Date("2026-09-23T00:00:00.000Z"),
      triggerReason: "legacy intraday latch",
      agentConviction: {
        moderator: "ENTER",
        barDate: "2026-09-23",
        barComplete: false,
        triggerState: "TRIGGERED",
      },
      agentConvictionAt: new Date("2026-09-23T18:00:00.000Z"),
    });
    db.aListCandidate.findMany.mockResolvedValue([row]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(yahooResponse([...history, pickBar, triggerBar])));

    const body = await runCron();

    // Yesterday's completed ARMED bar is still eligible for a PROBE; today's
    // partial trigger must not be used to produce GO.
    expect(body).toMatchObject({ processed: 1, triggered: 1, analyzed: 1 });
    expect(db.positionDailyTrack.upsert).toHaveBeenCalledTimes(1);
    expect(db.positionDailyTrack.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { candidateId_sessionDate: { candidateId: "partial", sessionDate: new Date("2026-09-22T00:00:00.000Z") } },
    }));
    expect(db.aListCandidate.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "partial" },
      data: expect.objectContaining({
        triggerState: "ARMED",
        triggerStateAt: null,
      }),
    }));
    expect(mocks.runConvictionAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      triggerState: "ARMED", barDate: "2026-09-22", barComplete: true,
    }));
    expect(db.aListCandidate.update).toHaveBeenCalledWith(expect.objectContaining({ data:
      expect.objectContaining({ agentConviction: expect.objectContaining({ verdict: "PROBE", sizePct: 0.25 }) }),
    }));
  });

  it("persists an ARMED completed-bar PROBE once, then refreshes on a completed trigger bar", async () => {
    const row = candidate("transition");
    const rows = [row];
    let suppliedCandles = [...history, pickBar];
    db.aListCandidate.findMany.mockImplementation(async () => rows);
    installStatefulCandidateUpdates(rows);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => yahooResponse(suppliedCandles)));

    vi.setSystemTime(new Date("2026-09-22T21:00:00.000Z")); // 17:00 ET
    expect(await runCron()).toMatchObject({ triggered: 1, analyzed: 1 });
    expect(mocks.runConvictionAnalysis).toHaveBeenCalledTimes(1);
    expect(mocks.runConvictionAnalysis).toHaveBeenLastCalledWith(expect.objectContaining({
      ticker: "TRANSITION",
      triggerState: "ARMED",
      barDate: "2026-09-22",
      barComplete: true,
    }));
    expect(row.agentConviction).toMatchObject({
      moderator: "ENTER", verdict: "PROBE", sizePct: 0.25,
      barDate: "2026-09-22",
      barComplete: true,
      triggerState: "ARMED",
    });

    expect(await runCron()).toMatchObject({ triggered: 0, analyzed: 0 });
    expect(mocks.runConvictionAnalysis).toHaveBeenCalledTimes(1);

    suppliedCandles = [...history, pickBar, triggerBar];
    vi.setSystemTime(new Date("2026-09-23T21:00:00.000Z")); // 17:00 ET
    expect(await runCron()).toMatchObject({ triggered: 1, analyzed: 1 });
    expect(mocks.runConvictionAnalysis).toHaveBeenCalledTimes(2);
    expect(mocks.runConvictionAnalysis).toHaveBeenLastCalledWith(expect.objectContaining({
      ticker: "TRANSITION",
      triggerState: "TRIGGERED",
      barDate: "2026-09-23",
      barComplete: true,
    }));
    expect(row.agentConviction).toMatchObject({
      barDate: "2026-09-23",
      barComplete: true,
      triggerState: "TRIGGERED",
      moderator: "ENTER", verdict: "GO", sizePct: 0.5,
    });
  });

  it("drains the ninth never-analysed candidate on the next bounded daily run", async () => {
    vi.setSystemTime(new Date("2026-09-22T21:00:00.000Z"));
    const rows = Array.from({ length: 9 }, (_, index) => candidate(`cand-${index + 1}`));
    db.aListCandidate.findMany.mockImplementation(async () => rows);
    installStatefulCandidateUpdates(rows);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(yahooResponse([...history, pickBar])));

    expect(await runCron()).toMatchObject({ candidates: 9, triggered: 9, analyzed: 8 });
    expect(mocks.runConvictionAnalysis).toHaveBeenCalledTimes(8);
    expect(rows[8].agentConviction).toBeNull();

    // All nine become eligible again on the next day. The never-analysed ninth
    // must precede the eight refreshed yesterday, even with the eight-call cap.
    vi.setSystemTime(new Date("2026-09-23T21:00:00.000Z"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(yahooResponse([...history, pickBar, triggerBar])));
    expect(await runCron()).toMatchObject({ candidates: 9, triggered: 9, analyzed: 8 });
    expect(mocks.runConvictionAnalysis).toHaveBeenCalledTimes(16);
    expect(mocks.runConvictionAnalysis.mock.calls[8][0].ticker).toBe("CAND-9");
    expect(rows[8].agentConviction).toMatchObject({
      barDate: "2026-09-23",
      barComplete: true,
      triggerState: "TRIGGERED",
    });
  });
});
