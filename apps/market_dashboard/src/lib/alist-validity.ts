/**
 * A-list REC validity math (pure — no prisma).
 *
 * A REC pick answers "is this entry still live?" — gap plays die fast, base
 * setups keep for a week. Day-0 = pickDate. Validity is measured in weekday
 * SESSIONS (holiday-blind approximation; a one-day skew is acceptable for a
 * staleness gate). The 14-session day-0→14 OUTCOME tracking continues even
 * after entry-validity expires — expiry only stops the row counting as an
 * actionable ACTIVE pick.
 */

/** Weekday sessions elapsed after `from` (UTC date) up to and including `to`. */
export function sessionsBetween(from: Date, to: Date): number {
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  if (end <= start) return 0;
  let sessions = 0;
  for (let t = start + 86400e3; t <= end; t += 86400e3) {
    const dow = new Date(t).getUTCDay();
    if (dow >= 1 && dow <= 5) sessions++;
  }
  return sessions;
}

/** Entry-validity window in sessions for a setup classification. */
export function validitySessions(setup: string | null | undefined): number {
  const s = (setup ?? "").toUpperCase();
  if (s.startsWith("EP") || s === "PARABOLIC") return 2; // catalyst plays die fast
  if (!s) return 3; // unclassified — middle ground
  return 5; // base setups (BO-*, PB-*, MA-PULLBACK, POST-GAP-VCP)
}

/** Last UTC date on which the pick is still entry-valid. */
export function validUntil(pickDate: Date, setup: string | null | undefined): Date {
  let remaining = validitySessions(setup);
  let t = Date.UTC(pickDate.getUTCFullYear(), pickDate.getUTCMonth(), pickDate.getUTCDate());
  while (remaining > 0) {
    t += 86400e3;
    const dow = new Date(t).getUTCDay();
    if (dow >= 1 && dow <= 5) remaining--;
  }
  return new Date(t);
}

/** True when the pick's entry window has lapsed as of `now`. */
export function isEntryExpired(pickDate: Date, setup: string | null | undefined, now: Date): boolean {
  return sessionsBetween(pickDate, now) > validitySessions(setup);
}
