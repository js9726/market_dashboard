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

function timeParts(now: Date, timeZone: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return { hour: value("hour"), minute: value("minute") };
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

export function paperExecutionEligibility(
  runDate: string,
  generatedAt: string,
  now = new Date(),
): { eligible: boolean; reason: string | null; ageMinutes: number } {
  const generated = new Date(generatedAt);
  const ageMinutes = (now.getTime() - generated.getTime()) / 60_000;
  const ny = newYorkDateParts(now);
  const nyTime = timeParts(now, "America/New_York");
  const mytTime = timeParts(now, "Asia/Kuala_Lumpur");
  const nyMinutes = nyTime.hour * 60 + nyTime.minute;
  const mytMinutes = mytTime.hour * 60 + mytTime.minute;
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(ny.weekday);

  if (!Number.isFinite(ageMinutes) || ageMinutes < 0 || ageMinutes > 60) {
    return { eligible: false, reason: "stale_execution_go", ageMinutes };
  }
  if (runDate !== ny.isoDate) {
    return { eligible: false, reason: "execution_go_not_current_us_session", ageMinutes };
  }
  if (!weekday || nyMinutes < 9 * 60 + 30 || nyMinutes >= 16 * 60) {
    return { eligible: false, reason: "outside_us_regular_session", ageMinutes };
  }
  if (mytMinutes < 21 * 60) {
    return { eligible: false, reason: "outside_operator_entry_window", ageMinutes };
  }
  return { eligible: true, reason: null, ageMinutes };
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
    ownerProvider: payload.generatedBy,
  }));
}
