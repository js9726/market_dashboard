/**
 * Quota-reset time math. The scan quota resets at midnight America/New_York
 * (matches the trading day), regardless of DST.
 */

/** UTC instant of the most recent midnight in America/New_York at `now`. */
export function etMidnightUtc(now: Date): Date {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZoneName: "longOffset",
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const offset = get("timeZoneName").replace("GMT", "") || "-05:00"; // e.g. "-04:00"
  return new Date(`${get("year")}-${get("month")}-${get("day")}T00:00:00${offset}`);
}

/** True when a user last reset before the current ET day started. */
export function needsQuotaReset(lastResetAt: Date, now: Date = new Date()): boolean {
  return lastResetAt.getTime() < etMidnightUtc(now).getTime();
}
