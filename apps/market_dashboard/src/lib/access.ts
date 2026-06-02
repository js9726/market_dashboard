/**
 * access.ts - SaaS multi-tenant access policy (single source of truth).
 *
 * Core rule for data isolation: a user only ever reads/writes their OWN
 * personal data (trades, journal, A-list HELD, equity, portfolio). The old
 * behaviour - "non-owner viewers see the owner's data" - is removed; that was a
 * single-tenant convenience and a cross-tenant leak in a multi-client SaaS.
 *
 * Market-wide data (breadth, screeners, REC picks, morning brief, internals) is
 * SHARED and is NOT scoped through here - those routes serve every signed-in user.
 */

export type Role = "owner" | "member" | "pending" | "denied";

type Sessionish = { user?: { id?: string | null; role?: string | null } | null } | null;

/** Normalise the stored role string to the SaaS role set. Legacy "allowed"
 *  (read-only viewer) maps to "member"; unknown/absent maps to "pending". */
export function roleOf(session: Sessionish): Role {
  const r = session?.user?.role ?? undefined;
  if (r === "owner" || r === "member" || r === "pending" || r === "denied") return r;
  if (r === "allowed") return "member";
  return "pending";
}

/** The userId whose PERSONAL data this request may touch. Multi-tenant rule:
 *  always the caller's own id. Returns null if unauthenticated. */
export function scopeUserId(session: Sessionish): string | null {
  return session?.user?.id ?? null;
}

/** Owner has admin powers (user management, operator feed), NOT a data-scope
 *  override. Owner still only sees their own personal book via scopeUserId. */
export function isOwner(session: Sessionish): boolean {
  return roleOf(session) === "owner";
}

/** Can this caller keep/see a personal book (trades, journal, HELD positions)?
 *  owner + member yes; pending/denied no (shared market data only). */
export function canSeePersonalBook(session: Sessionish): boolean {
  const r = roleOf(session);
  return r === "owner" || r === "member";
}

/** Any signed-in, non-denied user may read the shared market-data plane. */
export function canSeeSharedData(session: Sessionish): boolean {
  return !!session?.user?.id && roleOf(session) !== "denied";
}
