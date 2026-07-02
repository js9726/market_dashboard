/**
 * /api/cron/rescore-day14
 *
 * Daily cron (Vercel Cron schedule in vercel.json).
 *
 * Finds TradeVerdictHistory rows with kind='day-0' that are 14+ days old AND
 * lack a corresponding kind='day-14-rescore' row. For each, fetches +21 days
 * of OHLCV from yfinance (covers ~14 trading days), computes a heuristic
 * match grade comparing the day-0 prediction vs actual price action, and
 * inserts a kind='day-14-rescore' row with outcomeMetrics.
 *
 * Heuristic grading (mirrors scripts/audit_trades.py in jie_wiki):
 *   A — stop held + target hit
 *   C-whipsaw — stop breached but trade closed positive (drift: stop too tight)
 *   C-undershoot — stop held but target undershot by >50% (drift: target too ambitious)
 *   B — everything else (partial match)
 *
 * No LLM call. Free.
 *
 * Auth:
 *   - Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` if CRON_SECRET env var set
 *   - Manual triggers (curl, GitHub Action) must include the same header
 */

import { NextResponse } from "next/server";
import yahooFinance from "yahoo-finance2";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

type OhlcvBar = {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type GradeResult = {
  grade: "A" | "B" | "C";
  notes: string;
  driftDetected: boolean;
  suggestions: Array<{ type: string; ticker: string; entry_date: string; concern: string }>;
};

function gradeMatch(
  ticker: string,
  entryDateIso: string,
  bars: OhlcvBar[],
  predictedExit: number | null,
  predictedStop: number | null
): GradeResult & { metrics: Record<string, number | null> } {
  if (bars.length < 2) {
    return {
      grade: "C",
      notes: "Insufficient OHLCV",
      driftDetected: false,
      suggestions: [],
      metrics: {},
    };
  }

  const firstClose = bars[0].close;
  const lastClose = bars[bars.length - 1].close;
  const lowWindow = Math.min(...bars.map((b) => b.low));
  const highWindow = Math.max(...bars.map((b) => b.high));
  const pctMove = ((lastClose - firstClose) / firstClose) * 100;

  const stopBreached = predictedStop != null && lowWindow < predictedStop;
  const targetHit = predictedExit != null && highWindow >= predictedExit * 0.95;
  const closedHigher = lastClose >= firstClose;

  const fmt = (v: number | null) => (v != null ? `$${v.toFixed(2)}` : "N/A");
  const sign = (v: number) => (v >= 0 ? "+" : "");

  let grade: "A" | "B" | "C" = "B";
  let driftDetected = false;
  const notes: string[] = [];
  const suggestions: GradeResult["suggestions"] = [];

  if (!stopBreached && targetHit) {
    grade = "A";
    notes.push(`Target ${fmt(predictedExit)} reached (high ${fmt(highWindow)}); stop held`);
  } else if (stopBreached && closedHigher) {
    grade = "C";
    driftDetected = true;
    notes.push(
      `Whipsaw: stop ${fmt(predictedStop)} breached at low ${fmt(lowWindow)} but close ${fmt(lastClose)} (${sign(pctMove)}${pctMove.toFixed(1)}%) above entry — stop too tight`
    );
    suggestions.push({
      type: "rubric-stop-too-tight",
      ticker,
      entry_date: entryDateIso,
      concern: `Predicted stop ${fmt(predictedStop)} would have whipsawed out of a ${sign(pctMove)}${pctMove.toFixed(1)}% recoverable trade`,
    });
  } else if (stopBreached && !closedHigher) {
    notes.push(
      `Stop ${fmt(predictedStop)} hit at low ${fmt(lowWindow)}; close ${fmt(lastClose)} (${sign(pctMove)}${pctMove.toFixed(1)}%) — stop protected from further loss`
    );
  } else if (predictedExit != null && lastClose < predictedExit * 0.5) {
    grade = "C";
    driftDetected = true;
    notes.push(
      `Severe undershoot: target ${fmt(predictedExit)} not reached (high ${fmt(highWindow)}, close ${fmt(lastClose)}, only ${sign(pctMove)}${pctMove.toFixed(1)}%)`
    );
    suggestions.push({
      type: "rubric-target-too-ambitious",
      ticker,
      entry_date: entryDateIso,
      concern: `Realised only ${sign(pctMove)}${pctMove.toFixed(1)}% vs predicted move to ${fmt(predictedExit)}`,
    });
  } else {
    notes.push(
      `Stop held; target ${fmt(predictedExit)} not hit (close ${fmt(lastClose)}, ${sign(pctMove)}${pctMove.toFixed(1)}%)`
    );
  }

  return {
    grade,
    notes: notes.join("; "),
    driftDetected,
    suggestions,
    metrics: {
      actual_close_d14: lastClose,
      actual_pct_move_14d: Math.round(pctMove * 100) / 100,
      actual_high_d14: highWindow,
      actual_low_d14: lowWindow,
      first_close: firstClose,
    },
  };
}

async function fetchOhlcv(ticker: string, start: Date, days: number): Promise<OhlcvBar[]> {
  const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
  // yahoo-finance2 typing is loose; cast to any to avoid friction
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const yf = yahooFinance as any;
  const result = await yf.historical(ticker, { period1: start, period2: end, interval: "1d" });
  return (result || []) as OhlcvBar[];
}

export async function GET(request: Request) {
  // Auth: Vercel Cron passes Authorization: Bearer <CRON_SECRET>; reject if mismatched
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const cutoff = new Date(Date.now() - FOURTEEN_DAYS_MS);

  // Find candidates: kind='day-0', 14+ days old. Ordered FIFO so longest-pending get scored first.
  const candidates = await prisma.tradeVerdictHistory.findMany({
    where: {
      kind: "day-0",
      createdAt: { lt: cutoff },
    },
    include: { trade: true },
    orderBy: { createdAt: "asc" },
    take: 200, // cap per run; cron repeats daily so any backlog drains over days
  });

  type RunResult =
    | { status: "scored"; tradeId: string; ticker: string; grade: string; drift: boolean }
    | { status: "skip"; tradeId: string; ticker: string; reason: string };

  const results: RunResult[] = [];
  let scored = 0;
  let skipped = 0;

  for (const v of candidates) {
    // Skip if a day-14-rescore already exists for this trade
    const existingRescore = await prisma.tradeVerdictHistory.findFirst({
      where: { tradeId: v.tradeId, kind: "day-14-rescore" },
      select: { id: true },
    });
    if (existingRescore) {
      skipped++;
      continue;
    }

    if (!v.trade.tradeDate) {
      results.push({ status: "skip", tradeId: v.tradeId, ticker: v.ticker, reason: "no trade date" });
      skipped++;
      continue;
    }

    let bars: OhlcvBar[] = [];
    try {
      bars = await fetchOhlcv(v.ticker, v.trade.tradeDate, 21);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ status: "skip", tradeId: v.tradeId, ticker: v.ticker, reason: `yfinance: ${message}` });
      skipped++;
      continue;
    }

    if (bars.length < 2) {
      results.push({ status: "skip", tradeId: v.tradeId, ticker: v.ticker, reason: "insufficient OHLCV" });
      skipped++;
      continue;
    }

    const verdictData = v.verdict as Record<string, unknown>;
    const predictedExit = (verdictData?.predicted_exit_price as number | null | undefined) ?? null;
    const predictedStop = (verdictData?.predicted_stop_price as number | null | undefined) ?? null;
    const entryDateIso = v.trade.tradeDate.toISOString().slice(0, 10);

    const grading = gradeMatch(v.ticker, entryDateIso, bars, predictedExit, predictedStop);

    const outcomeMetrics = {
      ...grading.metrics,
      predicted_exit_price: predictedExit,
      predicted_stop_price: predictedStop,
      match_grade: grading.grade,
      match_notes: grading.notes,
      drift_detected: grading.driftDetected,
      wiki_changes_suggested: grading.suggestions,
      source_day0_id: v.id,
      rescore_timestamp: new Date().toISOString(),
    };

    await prisma.tradeVerdictHistory.create({
      data: {
        tradeId: v.tradeId,
        ticker: v.ticker,
        tradeDate: v.trade.tradeDate,
        model: "heuristic-no-llm",
        provider: "internal-cron",
        style: v.style,
        kind: "day-14-rescore",
        verdict: { source_day0_id: v.id } as Prisma.InputJsonValue,
        outcomeMetrics: outcomeMetrics as Prisma.InputJsonValue,
        score: null,
      },
    });

    results.push({
      status: "scored",
      tradeId: v.tradeId,
      ticker: v.ticker,
      grade: grading.grade,
      drift: grading.driftDetected,
    });
    scored++;
  }

  return NextResponse.json({
    candidatesFound: candidates.length,
    scored,
    skipped,
    results,
    runAt: new Date().toISOString(),
  });
}
