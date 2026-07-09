/**
 * Feature flags
 * =============
 *
 * Centralised gating for in-development features so they can ship to
 * production behind an env flag without blocking unrelated commits.
 *
 * Each flag must be NEXT_PUBLIC_-prefixed so it's available client-side.
 * In-development flags default OFF (fail closed); shipped-product flags
 * default ON with the env var as a kill-switch.
 */

function readBool(envVar: string | undefined, defaultOn = false): boolean {
  if (!envVar) return defaultOn;
  const v = envVar.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export const features = {
  // Multi-broker journal: manual trade entry, portfolio view, CSV import,
  // broker settings, per-trade analyser output. GRADUATED 2026-06-29
  // (client-beta Phase 0.4): the journal IS the beta product, so it defaults
  // ON everywhere; set NEXT_PUBLIC_FEATURE_BROKER_JOURNAL=false to disable.
  brokerJournal: readBool(process.env.NEXT_PUBLIC_FEATURE_BROKER_JOURNAL, true),
} as const;

export type FeatureFlag = keyof typeof features;

/** Throw helper for server components / API routes when a flag is off. */
export function assertFeature(flag: FeatureFlag): void {
  if (!features[flag]) {
    throw new Error(`Feature '${flag}' is not enabled in this environment.`);
  }
}
