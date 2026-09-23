/**
 * market-clock.ts — US equity session helpers.
 *
 * Purpose: stop the dashboard from presenting a stale prior-session move as if
 * it were "today" (the persistent weekend / PC-off stale-data complaint). When
 * the market is closed, a quote's daily change is last session's, not today's —
 * the UI should say so instead of showing a fresh-looking green number.
 */
const ET = "America/New_York";

function toEt(now: Date): Date {
  return new Date(now.toLocaleString("en-US", { timeZone: ET }));
}

export type USMarketSession = "PREMARKET" | "REGULAR" | "AFTER_HOURS" | "CLOSED";

/** US equity session buckets: Mon-Fri 04:00-20:00 ET. (Exchange holidays not modelled.) */
export function usMarketSession(now: Date = new Date()): USMarketSession {
  const et = toEt(now);
  const day = et.getDay(); // 0 Sun .. 6 Sat
  if (day === 0 || day === 6) return "CLOSED";
  const mins = et.getHours() * 60 + et.getMinutes();
  if (mins >= 4 * 60 && mins < 9 * 60 + 30) return "PREMARKET";
  if (mins >= 9 * 60 + 30 && mins <= 16 * 60) return "REGULAR";
  if (mins > 16 * 60 && mins <= 20 * 60) return "AFTER_HOURS";
  return "CLOSED";
}

/** NYSE regular session: Mon-Fri 09:30-16:00 ET. (Exchange holidays not modelled.) */
export function isUSMarketOpen(now: Date = new Date()): boolean {
  return usMarketSession(now) === "REGULAR";
}

export function marketSessionLabel(now: Date = new Date()): "LIVE" | "CLOSED" {
  return isUSMarketOpen(now) ? "LIVE" : "CLOSED";
}

/** Today's date in ET as YYYY-MM-DD. */
export function etDateString(now: Date = new Date()): string {
  const et = toEt(now);
  return `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, "0")}-${String(et.getDate()).padStart(2, "0")}`;
}

/**
 * Whether a DAILY bar dated `barDate` (YYYY-MM-DD) is finished.
 *
 * No band above WATCH may be issued from an unfinished bar
 * (wiki/trading/traders/trader-styles.md). A bar for today is still being
 * written until the regular session ends: its high is not the high and its
 * close strength does not exist. VLO on 2026-09-22 printed 387.58 at 11:05 ET
 * and closed at 377.14.
 *
 * Fail-closed: a missing or unparseable date is NOT complete.
 */
export function isDailyBarComplete(barDate: string | null | undefined, now: Date = new Date()): boolean {
  if (!barDate || !/^\d{4}-\d{2}-\d{2}$/.test(barDate) || !Number.isFinite(now.getTime())) return false;
  const parsed = new Date(`${barDate}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== barDate) return false;
  if (parsed.getUTCDay() === 0 || parsed.getUTCDay() === 6) return false;
  const today = etDateString(now);
  if (barDate < today) return true;
  if (barDate > today) return false; // a future-dated bar is not evidence of anything
  // CLOSED also includes 00:00-04:00, before today's bar even starts.
  // Conservatively wait until the normal close on early-close sessions too.
  const et = toEt(now);
  return et.getHours() * 60 + et.getMinutes() >= 16 * 60;
}

/** Short ET date label for when a quote was observed, e.g. "May 29". */
export function observedLabel(observedAt: string | Date | null | undefined): string | null {
  if (!observedAt) return null;
  const d = typeof observedAt === "string" ? new Date(observedAt) : observedAt;
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: ET });
}
