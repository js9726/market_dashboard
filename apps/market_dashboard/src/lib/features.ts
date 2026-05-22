/**
 * Feature flags
 * =============
 *
 * Centralised gating for in-development features so they can ship to
 * production behind an env flag without blocking unrelated commits.
 *
 * Phase 0 (2026-05): multi-broker / multi-tenant journal.
 *   Flip NEXT_PUBLIC_FEATURE_BROKER_JOURNAL=true in Vercel when ready to
 *   reveal /portfolio, /journal/new, /journal/import, /settings/brokers.
 *
 * Each flag must be NEXT_PUBLIC_-prefixed so it's available client-side.
 * Default to OFF for any unset value (fail closed).
 */

function readBool(envVar: string | undefined): boolean {
  if (!envVar) return false;
  const v = envVar.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export const features = {
  // Multi-broker journal (Phase 0+): manual trade entry, portfolio view,
  // CSV import, broker settings, per-trade analyser output.
  brokerJournal: readBool(process.env.NEXT_PUBLIC_FEATURE_BROKER_JOURNAL),
} as const;

export type FeatureFlag = keyof typeof features;

/** Throw helper for server components / API routes when a flag is off. */
export function assertFeature(flag: FeatureFlag): void {
  if (!features[flag]) {
    throw new Error(`Feature '${flag}' is not enabled in this environment.`);
  }
}
