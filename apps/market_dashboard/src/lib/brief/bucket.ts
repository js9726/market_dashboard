/**
 * 15-minute bucket math for the morning-verdict cache.
 *
 * All times are in UTC. The intraday refresh window is the first 2 hours of
 * US market open (9:30–11:30 AM ET). During EDT (Mar–Nov, ~8 months/year)
 * that's 13:30–15:30 UTC; during EST it's 14:30–16:30 UTC. We accept either
 * by widening the window check to 13:30–16:30 UTC.
 *
 * The pre-market run is a single GH Actions cron at 13:00 UTC.
 */

export const BUCKET_MS = 15 * 60 * 1000;

export type BriefProvider = "deepseek" | "gemini" | "openai" | "claude";

export const ALL_PROVIDERS: BriefProvider[] = ["deepseek", "gemini", "openai", "claude"];
export const INTRADAY_PROVIDERS: BriefProvider[] = ["deepseek", "gemini"];
export const PREMARKET_PROVIDERS: BriefProvider[] = ["deepseek", "gemini", "openai", "claude"];

/** floor(date, 15 min) in UTC. */
export function bucketOf(date: Date = new Date()): Date {
  return new Date(Math.floor(date.getTime() / BUCKET_MS) * BUCKET_MS);
}

/** True iff `date` is on a US weekday. */
export function isWeekday(date: Date): boolean {
  const day = date.getUTCDay();
  return day >= 1 && day <= 5;
}

/**
 * True iff `date` is inside the intraday refresh window:
 * weekday AND 13:30 ≤ UTC < 16:30 (covers EDT 9:30–11:30 ET and EST 9:30–11:30 ET).
 *
 * The pre-market run at exactly 13:00 UTC is NOT in this window — its cache
 * miss is filled by the GH Actions cron, not the lazy regen path.
 */
export function isIntradayWindow(date: Date = new Date()): boolean {
  if (!isWeekday(date)) return false;
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const minuteOfDay = hours * 60 + minutes;
  return minuteOfDay >= 13 * 60 + 30 && minuteOfDay < 16 * 60 + 30;
}
