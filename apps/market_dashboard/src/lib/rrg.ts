import type { TickerRow } from "@/types/market-dashboard";
import { classifyTheme, themeLabel, type ThemeBucket } from "@/lib/themes";

/**
 * Relative Rotation Graph quadrant.
 *   leading:    rs >= 50 AND 20d > 0     stay long, trail stops
 *   improving:  rs <  50 AND 20d > 0     next-rotation candidates
 *   lagging:    rs <  50 AND 20d <= 0    avoid / no position
 *   weakening:  rs >= 50 AND 20d <= 0    reduce / tighten stops
 *   unknown:    missing rs or 20d        not plotted
 */
export type RrgQuadrant = "leading" | "improving" | "lagging" | "weakening" | "unknown";

export const RRG_MIDPOINTS = {
  rs: 50,
  momentum: 0,
} as const;

export function classifyRrg(row: TickerRow): RrgQuadrant {
  const rs = row.rs;
  const momentum = row["20d"];
  if (rs == null || momentum == null || Number.isNaN(rs) || Number.isNaN(momentum)) {
    return "unknown";
  }
  const strong = rs >= RRG_MIDPOINTS.rs;
  const rising = momentum > RRG_MIDPOINTS.momentum;
  if (strong && rising) return "leading";
  if (!strong && rising) return "improving";
  if (!strong && !rising) return "lagging";
  return "weakening";
}

export interface RrgPoint {
  ticker: string;
  label: string;
  x: number;             // rs (0-100)
  y: number;             // 20d % change
  size: number;          // ATR % (scaled for Recharts)
  quadrant: RrgQuadrant;
  themeBucket: ThemeBucket;
  daily: number | null;
  intra: number | null;
}

/**
 * Convert raw industry rows into Recharts-ready points. Drops rows missing
 * either axis. Size is derived from ATR %: clamped to [4, 32] so the smallest
 * volatility bubble stays visible and the largest doesn't dominate the chart.
 */
export function toRrgPoints(rows: TickerRow[]): RrgPoint[] {
  const out: RrgPoint[] = [];
  for (const row of rows) {
    const quadrant = classifyRrg(row);
    if (quadrant === "unknown") continue;
    const atr = row.atr_pct;
    // Scale ATR (typically 0.5-5 for ETFs) → Recharts ZAxis range scalar.
    const sizeRaw = atr != null && atr > 0 ? atr : 1;
    const size = Math.max(4, Math.min(32, Math.round(sizeRaw * 6)));
    out.push({
      ticker: row.ticker,
      label: themeLabel(row.ticker),
      x: row.rs as number,
      y: row["20d"] as number,
      size,
      quadrant,
      themeBucket: classifyTheme(row),
      daily: row.daily,
      intra: row.intra,
    });
  }
  return out;
}

/**
 * Group counts per quadrant for the side legend.
 */
export function rrgQuadrantCounts(points: RrgPoint[]): Record<RrgQuadrant, number> {
  const counts: Record<RrgQuadrant, number> = {
    leading: 0,
    improving: 0,
    lagging: 0,
    weakening: 0,
    unknown: 0,
  };
  for (const p of points) counts[p.quadrant]++;
  return counts;
}

/**
 * Tone for the theme-bucket colour overlay. Reuses Theme Radar's palette so
 * the two surfaces stay visually consistent — a "heating" theme is the same
 * colour on the RRG chart, the Theme Radar bucket table, and the RVOL table.
 */
export function rrgPointTone(bucket: ThemeBucket): { fill: string; stroke: string } {
  switch (bucket) {
    case "heating":
      return { fill: "var(--gain-fg)", stroke: "var(--gain-fg)" };
    case "accumulate":
      return { fill: "var(--accent)", stroke: "var(--accent)" };
    case "cooling":
      return { fill: "var(--loss-fg)", stroke: "var(--loss-fg)" };
    default:
      return { fill: "var(--fg-3)", stroke: "var(--fg-3)" };
  }
}

/**
 * Static quadrant metadata for rendering corner labels + the side legend.
 */
export const QUADRANT_META: Record<
  Exclude<RrgQuadrant, "unknown">,
  { label: string; subtitle: string; cornerX: "left" | "right"; cornerY: "top" | "bottom" }
> = {
  leading: {
    label: "Leading",
    subtitle: "stay long - trail stops",
    cornerX: "right",
    cornerY: "top",
  },
  improving: {
    label: "Improving",
    subtitle: "next to rotate up",
    cornerX: "left",
    cornerY: "top",
  },
  lagging: {
    label: "Lagging",
    subtitle: "avoid - no position",
    cornerX: "left",
    cornerY: "bottom",
  },
  weakening: {
    label: "Weakening",
    subtitle: "reduce - tighten stops",
    cornerX: "right",
    cornerY: "bottom",
  },
};
