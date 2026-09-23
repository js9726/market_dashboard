import { isDailyBarComplete } from "@/lib/market-clock";

/** Partial bars must not latch trigger states or consume the one-per-bar analysis. */
export function completedDailyPath<T extends { date: string }>(bars: T[], now = new Date()): T[] {
  return bars.filter((bar) => isDailyBarComplete(bar.date, now));
}

/** Re-analyse a new completed bar or trigger state; retry failed/legacy analyses once. */
export function shouldQueueConviction(input: {
  triggerState: string | null;
  day0Score: number | null;
  barDate: string;
  previous: unknown;
  now?: Date;
}): boolean {
  if (!isDailyBarComplete(input.barDate, input.now)) return false;
  if (input.triggerState !== "TRIGGERED" &&
      !(input.triggerState === "ARMED" && Number.isFinite(input.day0Score) && input.day0Score! >= 65)) return false;
  const prior = input.previous && typeof input.previous === "object"
    ? input.previous as Record<string, unknown> : null;
  return prior?.barComplete !== true || prior.barDate !== input.barDate || prior.triggerState !== input.triggerState;
}
