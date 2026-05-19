/**
 * Shape of `public/market-dashboard/tv_screeners.json`, written by
 * `apps/market_dashboard_backend/scripts/tv_screener_fetch.py`.
 */

export interface TvScreenerHit {
  ticker: string;
  exchange: string | null;
  name?: string | null;
  close?: number | null;
  change?: number | null;
  volume?: number | null;
  relative_volume_10d_calc?: number | null;
  market_cap_basic?: number | null;
  sector?: string | null;
  industry?: string | null;
  premarket_change?: number | null;
  "Perf.W"?: number | null;
  "Perf.1M"?: number | null;
  "ATR.percent"?: number | null;

  // Populated by the optional DeepSeek 4-stage auto-score pass.
  score?: number | null;
  verdict?: "GO" | "WAIT" | "PASS" | null;
  thesis?: string | null;
  /** Setup pattern classified by the scoring engine. */
  pattern?: "EP" | "BREAKOUT" | "PULLBACK" | "PARABOLIC" | "STAGE4-BOUNCE" | "UNCLEAR" | null;
  /** 4-stage sub-scores (each 0-25). */
  stages?: {
    s1_trend:   number;  // Trend Leadership / RS
    s2_pattern: number;  // Pattern Quality
    s3_timing:  number;  // Entry Timing
    s4_risk:    number;  // Risk Quality
  } | null;
}

export interface TvScreener {
  id: string;
  name: string;
  tv_url: string | null;
  hits: TvScreenerHit[];
}

export interface TvScreenersFile {
  fetched_at: string;
  scored: boolean;
  /** Number of top hits auto-scored per screener (added in v2). */
  score_top?: number;
  screeners: TvScreener[];
}
