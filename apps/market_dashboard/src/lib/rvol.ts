import type { TickerRow } from "@/types/market-dashboard";
import { THEME_LABELS } from "@/lib/themes";

/**
 * Categorise an RVOL reading into 5 buckets. Used by the RVOL Overview table
 * to drive cell colouring. Thresholds tuned for daily ETF activity:
 *   surge >= 2x average        very strong buying interest
 *   high  >= 1.3x              above-average activity worth noting
 *   normal 0.7-1.3x            typical day
 *   low    0.4-0.7x            quiet day
 *   dry   < 0.4x               unusually thin
 */
export type RvolBucket = "surge" | "high" | "normal" | "low" | "dry" | "unknown";

export const RVOL_THRESHOLDS = {
  surge: 2.0,
  high: 1.3,
  low: 0.7,
  dry: 0.4,
} as const;

export function rvolBucket(rvol: number | null | undefined): RvolBucket {
  if (rvol == null || Number.isNaN(rvol)) return "unknown";
  if (rvol >= RVOL_THRESHOLDS.surge) return "surge";
  if (rvol >= RVOL_THRESHOLDS.high) return "high";
  if (rvol < RVOL_THRESHOLDS.dry) return "dry";
  if (rvol < RVOL_THRESHOLDS.low) return "low";
  return "normal";
}

/**
 * CSS variable name for the cell background tone — paired with a foreground
 * colour for legibility. Returns inline-style object ready for React.
 */
export function rvolTone(rvol: number | null | undefined): {
  background: string;
  color: string;
  label: string;
} {
  switch (rvolBucket(rvol)) {
    case "surge":
      return { background: "var(--gain-bg)", color: "var(--gain-fg)", label: "SURGE" };
    case "high":
      return { background: "var(--accent-soft-bg)", color: "var(--accent)", label: "HIGH" };
    case "normal":
      return { background: "var(--bg-raised)", color: "var(--fg-2)", label: "NORMAL" };
    case "low":
      return { background: "var(--bg-raised)", color: "var(--fg-3)", label: "LOW" };
    case "dry":
      return { background: "var(--loss-bg)", color: "var(--loss-fg)", label: "DRY" };
    default:
      return { background: "var(--bg-raised)", color: "var(--fg-3)", label: "-" };
  }
}

/**
 * Sort rows by RVOL descending. Nulls/undefineds bubble to the bottom so the
 * table always leads with the strongest readings.
 */
export function sortByRvolDesc(rows: TickerRow[]): TickerRow[] {
  return [...rows].sort((a, b) => {
    const ar = a.rvol;
    const br = b.rvol;
    if (ar == null && br == null) return 0;
    if (ar == null) return 1;
    if (br == null) return -1;
    return br - ar;
  });
}

/**
 * Distance-from-52W-high tone. Negative numbers; closer to zero is stronger.
 */
export function pct52wTone(pct: number | null | undefined): { color: string } {
  if (pct == null || Number.isNaN(pct)) return { color: "var(--fg-3)" };
  // Within 3% of 52W high → green; 3-10% → neutral; >10% → red.
  if (pct >= -3) return { color: "var(--gain-fg)" };
  if (pct >= -10) return { color: "var(--fg-2)" };
  return { color: "var(--loss-fg)" };
}

/**
 * Look up a human label for the ETF ticker — reuses the Theme Radar mapping so
 * we don't duplicate the taxonomy. Falls back to the ticker for unknown ETFs.
 */
export function rvolLabel(ticker: string): string {
  return THEME_LABELS[ticker] ?? ticker;
}
