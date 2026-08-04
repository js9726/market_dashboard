import type { DailyScreenerPayload } from "@/lib/daily-screener/schema";

export const PAPER_SIGNAL_AUTHORITY = "tradingview-daily-screener/v2";

const HOUR_MS = 60 * 60 * 1000;

function newYorkDateParts(now: Date): { weekday: string; isoDate: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    weekday: value("weekday"),
    isoDate: `${value("year")}-${value("month")}-${value("day")}`,
  };
}

export function finalRunFreshness(
  runDate: string,
  generatedAt: string,
  now = new Date(),
): { fresh: boolean; ageHours: number; maxAgeHours: number } {
  const generated = new Date(generatedAt);
  const ageHours = (now.getTime() - generated.getTime()) / HOUR_MS;
  const ny = newYorkDateParts(now);
  const runDay = new Date(`${runDate}T00:00:00.000Z`).getUTCDay();
  const isMondayUsingFriday = ny.weekday === "Mon" && runDay === 5;
  const maxAgeHours = isMondayUsingFriday ? 96 : 36;
  return {
    fresh:
      Number.isFinite(ageHours) &&
      ageHours >= 0 &&
      ageHours <= maxAgeHours &&
      runDate <= ny.isoDate,
    ageHours,
    maxAgeHours,
  };
}

export function buildPaperSignals(
  payload: DailyScreenerPayload,
  run: { id: string; goListHash: string },
) {
  return payload.candidates.goList.map((candidate) => ({
    signalId: `${run.id}:${run.goListHash}:${candidate.ticker}`,
    ticker: candidate.ticker,
    setup: candidate.setup,
    entryZone: candidate.execution.entry,
    stop: candidate.execution.stop,
    target: candidate.execution.target,
    conviction: candidate.score,
    trigger: candidate.trigger,
    cancel: candidate.cancel,
    runId: run.id,
    runDate: payload.runDate,
    generatedAt: payload.generatedAt,
  }));
}
