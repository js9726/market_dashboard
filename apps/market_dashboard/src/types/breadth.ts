/**
 * Shape of `public/market-dashboard/breadth.json`, written by
 * `apps/market_dashboard_backend/scripts/breadth_scan.py`.
 */

export interface MarketBreadth {
  new_highs: number;
  new_lows: number;
  advance: number;
  decline: number;
  stage_counts: Record<"1" | "2" | "3" | "4", number>;
  universe_size: number;
}

export interface MomentumBreadth {
  up_from_open: number;
  down_from_open: number;
  up_on_volume: number;
  down_on_volume: number;
  up_4pct: number;
  down_4pct: number;
}

export interface SectorRow {
  sector: string;
  n: number;
  pct_above_50sma: number;
  delta_wow?: number | null;
  delta_mom?: number | null;
}

export interface IndustryRow {
  industry: string;
  n: number;
  pct_above_50sma: number;
  delta_wow?: number | null;
  delta_mom?: number | null;
}

export interface BreadthSnapshot {
  built_at: string;
  mcap_floor: number;
  market: MarketBreadth;
  momentum: MomentumBreadth;
  sectors: SectorRow[];
  industries: IndustryRow[];
}
