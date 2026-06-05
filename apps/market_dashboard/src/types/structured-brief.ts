/**
 * Structured-JSON contract for the morning-verdict brief, mirroring the
 * shape requested in `packages/core-skills/morning-brief/prompt.md`.
 *
 * All numeric/string fields are optional — providers return null when
 * data is unavailable, and the dashboard renders a "—" placeholder.
 */

export interface BriefMood {
  label: string | null;
  posture: string | null;
  summary: string | null;
}

export interface BriefBreadth {
  up: number | null;
  down: number | null;
}

export interface BriefFearGreed {
  score: number | null;
  label: string | null;
}

export interface BriefIndex {
  symbol: string;
  name: string | null;
  level: number | null;
  changePct: number | null;
  note: string | null;
  citation: string | null;
}

export interface BriefSectorTheme {
  symbol: string;
  name: string | null;
  changePct: number | null;
  rs: number | null;
  note: string | null;
}

export interface BriefIndustryLeader {
  ticker: string;
  changePct: number | null;
  rvol: number | null;
  source: string | null;
}

export interface BriefIndustryMover {
  industry: string;
  sector: string | null;
  changePct: number | null;
  perf1W: number | null;
  perf1M: number | null;
  breadthPct: number | null;
  deltaWow: number | null;
  leaders: BriefIndustryLeader[] | null;
  note: string | null;
}

export interface BriefMover {
  ticker: string;
  side: "LONG" | "SHORT" | null;
  changePct: number | null;
  why: string | null;
  traderLens: string | null;
}

export interface BriefWatchlistRow {
  ticker: string;
  level: number | null;
  changePct: number | null;
  abc: "A" | "B" | "C" | null;
  note: string | null;
}

export interface BriefTraderView {
  name: string;
  view: string;
}

export interface BriefStandout {
  ticker: string | null;
  side: "LONG" | "SHORT" | null;
  score: number | null;
  sector: string | null;
  rs: number | null;
  grade: "A" | "B" | "C" | null;
  thesis: string | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  rrr: number | null;
  tags: string[] | null;
}

export interface BriefEarningsRow {
  ticker: string;
  consensus?: string | null;
  result?: string | null;
  movePct?: number | null;
}

export interface BriefCalendarRow {
  time: string | null;
  name: string | null;
  consensus: string | null;
}

export interface BriefRating {
  ticker: string;
  firm: string | null;
  rating: string | null;
  pt: number | null;
}

/** High-impact, market-moving news item (2026-06). Surfaced in the morning
 *  brief and pulled into the daily-journal "news" widget. */
export interface BriefNewsItem {
  headline: string;
  impact: "HIGH" | "MED" | "LOW" | null;
  tickers: string[] | null;
  source: string | null; // publisher or URL
  time: string | null; // ISO or human ("pre-market", "08:30 ET")
}

export interface StructuredBrief {
  mood: BriefMood | null;
  breadth: BriefBreadth | null;
  fearGreed: BriefFearGreed | null;
  indices: BriefIndex[] | null;
  indicesNarrative: string | null;
  sectorsThemes: BriefSectorTheme[] | null;
  sectorsNarrative: string | null;
  industryNarrative: string | null;
  industryMovers: BriefIndustryMover[] | null;
  movers: BriefMover[] | null;
  watchlist: BriefWatchlistRow[] | null;
  traderLens: BriefTraderView[] | null;
  standout: BriefStandout | null;
  earnings: {
    bmo?: BriefEarningsRow[] | null;
    amc?: BriefEarningsRow[] | null;
    yesterdayReactions?: BriefEarningsRow[] | null;
  } | null;
  calendar: BriefCalendarRow[] | null;
  ratings: {
    upgrades?: BriefRating[] | null;
    downgrades?: BriefRating[] | null;
  } | null;
  /** High-impact market-moving news (revised brief, 2026-06). Optional so
   *  existing parsers/literals stay valid until WS4 wires the Zod schema + prompt. */
  news?: BriefNewsItem[] | null;
  alert: string | null;
  citations: string[] | null;
}
