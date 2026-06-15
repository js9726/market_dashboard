/**
 * Shape of `public/market-dashboard/tv_screeners.json`, written by
 * `apps/market_dashboard_backend/scripts/tv_screener_fetch.py`.
 */

export interface TvScreenerHit {
  ticker: string;
  exchange: string | null;
  name?: string | null;
  /** Day's open price (intraday snapshot). */
  open?: number | null;
  /** Day's high price (intraday snapshot). */
  high?: number | null;
  /** Day's low price (intraday snapshot). */
  low?: number | null;
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

  // Populated by the algorithmic scorer (always) or upgraded by DeepSeek (when --score is used).
  score?: number | null;
  verdict?: "GO" | "WAIT" | "PASS" | null;
  thesis?: string | null;
  /** Setup pattern classified by the scoring engine. */
  pattern?: "EP" | "BREAKOUT" | "PULLBACK" | "PARABOLIC" | "STAGE4-BOUNCE" | "UNCLEAR" | null;
  /** Conviction sub-scores (Setup/40 + Entry/30 + Theme/20 + Sentiment/10). */
  stages?: {
    setup:     number;  // Setup quality (/40)
    entry:     number;  // Entry readiness (/30)
    theme:     number;  // Theme + leadership (/20)
    sentiment: number;  // Market sentiment (/10)
  } | null;
  /**
   * Score confidence source:
   *   "deepseek"    — AI-upgraded score with sector/thesis context (once-daily DeepSeek pass)
   *   "algorithmic" — deterministic Python rules only; no LLM context; medium confidence
   */
  score_source?: "deepseek" | "algorithmic" | null;
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
  /** Number of top hits DeepSeek-upgraded per screener (added in v2). */
  score_top?: number;
  /** When the last DeepSeek scoring pass ran (null when algorithmic-only). */
  deepseek_scored_at?: string | null;
  /** Whether the US equity market was open when this data was fetched. */
  market_was_open?: boolean;
  screeners: TvScreener[];
}
