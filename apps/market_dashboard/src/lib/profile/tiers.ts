/**
 * Leaderboard tier system. Names + minimum composite scores. Tier is derived
 * from a 0-100 score in lib/profile/composite.ts — not stored in the DB, so
 * it never goes stale.
 */

export type Tier =
  | "legend"
  | "masters"
  | "diamond"
  | "platinum"
  | "gold"
  | "silver"
  | "bronze"
  | "unranked";

export interface TierInfo {
  key: Tier;
  label: string;
  minScore: number;
  /** Accent colour token (`var(--tier-{key})` is intentionally not used so
   * the colours work without the Feature 9 design-system tokens being live). */
  color: string;
}

/**
 * Tier ladder, top to bottom. `unranked` is appended manually because it
 * isn't score-keyed — it's the "not enough trades yet" state.
 */
export const TIERS: readonly TierInfo[] = [
  { key: "legend",   label: "Legend",   minScore: 90, color: "#FFD54A" },
  { key: "masters",  label: "Masters",  minScore: 80, color: "#E5484D" },
  { key: "diamond",  label: "Diamond",  minScore: 70, color: "#00BCD4" },
  { key: "platinum", label: "Platinum", minScore: 60, color: "#8B5CF6" },
  { key: "gold",     label: "Gold",     minScore: 50, color: "#F2A93B" },
  { key: "silver",   label: "Silver",   minScore: 40, color: "#94A3B8" },
  { key: "bronze",   label: "Bronze",   minScore:  0, color: "#A16207" },
] as const;

export const UNRANKED: TierInfo = {
  key: "unranked",
  label: "Unranked",
  minScore: -1,
  color: "var(--fg-3)",
};

/** Minimum closed trades before a user is ranked. */
export const RANK_MIN_TRADES = 10;

export function tierForScore(score: number | null | undefined): TierInfo {
  if (score == null || Number.isNaN(score)) return UNRANKED;
  for (const t of TIERS) {
    if (score >= t.minScore) return t;
  }
  return UNRANKED;
}

export function tierInfo(key: Tier): TierInfo {
  if (key === "unranked") return UNRANKED;
  return TIERS.find((t) => t.key === key) ?? UNRANKED;
}
