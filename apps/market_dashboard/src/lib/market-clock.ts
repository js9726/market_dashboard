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

/** NYSE regular session: Mon-Fri 09:30-16:00 ET. (Exchange holidays not modelled.) */
export function isUSMarketOpen(now: Date = new Date()): boolean {
  const et = toEt(now);
  const day = et.getDay(); // 0 Sun .. 6 Sat
  if (day === 0 || day === 6) return false;
  const mins = et.getHours() * 60 + et.getMinutes();
  return mins >= 9 * 60 + 30 && mins <= 16 * 60;
}

export function marketSessionLabel(now: Date = new Date()): "LIVE" | "CLOSED" {
  return isUSMarketOpen(now) ? "LIVE" : "CLOSED";
}

/** Short ET date label for when a quote was observed, e.g. "May 29". */
export function observedLabel(observedAt: string | Date | null | undefined): string | null {
  if (!observedAt) return null;
  const d = typeof observedAt === "string" ? new Date(observedAt) : observedAt;
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: ET });
}
