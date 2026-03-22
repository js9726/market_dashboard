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
