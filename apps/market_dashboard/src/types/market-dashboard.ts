export interface TickerRow {
  ticker: string;
  daily: number | null;
  intra: number | null;
  "5d": number | null;
  "20d": number | null;
  atr_pct: number | null;
  dist_sma50_atr: number | null;
  rs: number | null;
  rs_chart: string | null;
  long: string[];
  short: string[];
  abc: string | null;
  // Optional — populated by build_data.py from 2026-05-19. Snapshots produced
  // before that day omit these keys; UI must treat them as nullable.
  rvol?: number | null;
  off_52w_high_pct?: number | null;
  price?: number | null;
  close?: number | null;
  volume?: number | null;
  exchange?: string | null;
}

export interface MarketSnapshot {
  built_at: string;
  groups: Record<string, TickerRow[]>;
  column_ranges: Record<
    string,
    {
      daily: [number, number];
      intra: [number, number];
      "5d": [number, number];
      "20d": [number, number];
    }
  >;
  fear_greed?: {
    value: number | null;
    label: string;
    /** "ok" = live reading; "unavailable" = fail-closed (source rejected/down). */
    status?: "ok" | "unavailable";
    source?: string;
    as_of?: string | null;
    error?: string;
  } | null;
  _meta?: {
    source?: string;
    refreshedAt?: string;
    ageMs?: number;
    baseBuiltAt?: string;
    overlayCount?: number;
    missingTickers?: string[];
    durationMs?: number;
    message?: string;
  };
}

export interface MacroEvent {
  date: string;
  time: string;
  event: string;
}

export interface MarketMeta {
  SECTOR_COLORS: Record<string, string>;
  TICKER_TO_SECTOR: Record<string, string>;
  Industries_COLORS: Record<string, string>;
  SECTOR_ORDER: string[];
  default_symbol: string;
}
