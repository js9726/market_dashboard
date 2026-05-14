/**
 * Snapshot composition for the morning-verdict regen path.
 *
 * Two layers:
 *  1. The static `public/market-dashboard/snapshot.json` written by the daily
 *     GH Actions run — this is the structural baseline (sectors, breadth ratios,
 *     macro events, RS table).
 *  2. The `LiveQuote` table — last observed price/changePct per symbol,
 *     populated by the moomoo daemon (or Yahoo fallback). Overlays fresh
 *     prices on top of the baseline.
 *
 * The composed object is what we feed to DeepSeek/Gemini for intraday regen.
 * It's also what we hash to dedupe identical regens (input-hash skip).
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { BreadthSnapshot } from "@/types/breadth";
import type { TvScreenerHit, TvScreenersFile } from "@/types/tv-screener";

export interface SnapshotIndustryLeader {
  ticker: string;
  changePct: number | null;
  rvol: number | null;
  source: string | null;
}

export interface SnapshotIndustryMover {
  industry: string;
  sector: string | null;
  changePct: number | null;
  perf1W: number | null;
  perf1M: number | null;
  breadthPct: number | null;
  deltaWow: number | null;
  leaders: SnapshotIndustryLeader[] | null;
  note: string | null;
}

export interface ComposedSnapshot {
  builtAt: string;
  baselineBuiltAt: string | null;
  liveAsOf: string | null;
  indices: Record<string, { price: number; changePct: number | null; source: string }>;
  sectors: Record<string, { price: number; changePct: number | null; source: string }>;
  watchlist: Record<string, { price: number; changePct: number | null; source: string }>;
  industryMovers: SnapshotIndustryMover[];
  baseline: unknown; // raw snapshot.json content for the LLM
}

const PUBLIC_MARKET_DATA_DIR = path.join(process.cwd(), "public", "market-dashboard");
const PUBLIC_SNAPSHOT_PATH = path.join(PUBLIC_MARKET_DATA_DIR, "snapshot.json");
const PUBLIC_TV_SCREENERS_PATH = path.join(PUBLIC_MARKET_DATA_DIR, "tv_screeners.json");
const PUBLIC_BREADTH_PATH = path.join(PUBLIC_MARKET_DATA_DIR, "breadth.json");

const INDEX_SYMBOLS = ["SPY", "QQQ", "IWM", "DIA", "^VIX"];
const SECTOR_SYMBOLS = ["XLK", "XLF", "XLE", "XLV", "XLI", "XLY", "XLP", "XLU", "XLB", "XLRE", "XLC"];

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[%+,]/g, "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function average(values: Array<number | null | undefined>): number | null {
  const numeric = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (numeric.length === 0) return null;
  return Number((numeric.reduce((sum, value) => sum + value, 0) / numeric.length).toFixed(2));
}

function scoreNumber(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function addLeader(
  leaders: Map<string, SnapshotIndustryLeader>,
  ticker: string,
  candidate: SnapshotIndustryLeader,
) {
  const existing = leaders.get(ticker);
  if (!existing) {
    leaders.set(ticker, candidate);
    return;
  }

  const existingMove = Math.abs(scoreNumber(existing.changePct));
  const candidateMove = Math.abs(scoreNumber(candidate.changePct));
  if (candidateMove > existingMove) leaders.set(ticker, candidate);
}

function topSector(votes: Map<string, number>): string | null {
  let winner: string | null = null;
  let maxVotes = 0;
  for (const [sector, count] of Array.from(votes.entries())) {
    if (count > maxVotes) {
      winner = sector;
      maxVotes = count;
    }
  }
  return winner;
}

interface IndustryAggregate {
  industry: string;
  sectorVotes: Map<string, number>;
  changes: number[];
  premktChanges: number[];
  perf1w: number[];
  perf1m: number[];
  rvols: number[];
  leaders: Map<string, SnapshotIndustryLeader>;
  sources: Set<string>;
  breadthPct: number | null;
  deltaWow: number | null;
  score: number;
}

function getAggregate(map: Map<string, IndustryAggregate>, industry: string): IndustryAggregate {
  const existing = map.get(industry);
  if (existing) return existing;

  const created: IndustryAggregate = {
    industry,
    sectorVotes: new Map(),
    changes: [],
    premktChanges: [],
    perf1w: [],
    perf1m: [],
    rvols: [],
    leaders: new Map(),
    sources: new Set(),
    breadthPct: null,
    deltaWow: null,
    score: 0,
  };
  map.set(industry, created);
  return created;
}

function addHit(aggregate: IndustryAggregate, hit: TvScreenerHit, source: string) {
  if (hit.sector) {
    aggregate.sectorVotes.set(hit.sector, (aggregate.sectorVotes.get(hit.sector) ?? 0) + 1);
  }

  const changePct = asNumber(hit.change);
  const premarketChange = asNumber(hit.premarket_change);
  const weekly = asNumber(hit["Perf.W"]);
  const monthly = asNumber(hit["Perf.1M"]);
  const rvol = asNumber(hit.relative_volume_10d_calc);

  if (changePct != null) aggregate.changes.push(changePct);
  if (premarketChange != null) aggregate.premktChanges.push(premarketChange);
  if (weekly != null) aggregate.perf1w.push(weekly);
  if (monthly != null) aggregate.perf1m.push(monthly);
  if (rvol != null) aggregate.rvols.push(rvol);
  aggregate.sources.add(source);

  const ticker = hit.ticker?.trim().toUpperCase();
  if (!ticker) return;
  addLeader(aggregate.leaders, ticker, {
    ticker,
    changePct: changePct ?? premarketChange,
    rvol,
    source,
  });
}

function addIndustryPerformanceRows(
  aggregates: Map<string, IndustryAggregate>,
  baseline: unknown,
) {
  const base = asObject(baseline);
  const industryPerformance = asObject(base?.industry_performance);
  if (!industryPerformance) return;

  const rows = [industryPerformance.all, industryPerformance.top5, industryPerformance.bottom5]
    .flatMap((value) => (Array.isArray(value) ? value : []))
    .map(asObject)
    .filter((value): value is Record<string, unknown> => value !== null);

  for (const row of rows) {
    const industry = typeof row.industry === "string" ? row.industry : null;
    if (!industry) continue;
    const aggregate = getAggregate(aggregates, industry);
    const daily = asNumber(row.perf_1d);
    const weekly = asNumber(row.perf_1w);
    const monthly = asNumber(row.perf_1m);
    if (daily != null) aggregate.changes.push(daily);
    if (weekly != null) aggregate.perf1w.push(weekly);
    if (monthly != null) aggregate.perf1m.push(monthly);
    aggregate.sources.add("Finviz industry performance");
  }
}

function addBreadthRows(aggregates: Map<string, IndustryAggregate>, breadth: BreadthSnapshot | null) {
  for (const row of breadth?.industries ?? []) {
    const aggregate = getAggregate(aggregates, row.industry);
    aggregate.breadthPct = row.pct_above_50sma;
    aggregate.deltaWow = row.delta_wow ?? null;
    aggregate.sources.add("Breadth scan");
  }
}

export function buildIndustryMovers(opts: {
  baseline: unknown;
  tvScreeners: TvScreenersFile | null;
  breadth: BreadthSnapshot | null;
  limit?: number;
}): SnapshotIndustryMover[] {
  const aggregates = new Map<string, IndustryAggregate>();

  for (const screener of opts.tvScreeners?.screeners ?? []) {
    const source = screener.name || screener.id;
    for (const hit of screener.hits ?? []) {
      if (!hit.industry) continue;
      addHit(getAggregate(aggregates, hit.industry), hit, source);
    }
  }

  addIndustryPerformanceRows(aggregates, opts.baseline);
  addBreadthRows(aggregates, opts.breadth);

  const rows = Array.from(aggregates.values()).map((aggregate) => {
    const changePct = average(aggregate.changes);
    const perf1W = average(aggregate.perf1w);
    const perf1M = average(aggregate.perf1m);
    const rvol = average(aggregate.rvols);
    const premkt = average(aggregate.premktChanges);
    const leaders = Array.from(aggregate.leaders.values())
      .sort((a, b) => Math.abs(scoreNumber(b.changePct)) - Math.abs(scoreNumber(a.changePct)))
      .slice(0, 4);
    const leaderText = leaders
      .slice(0, 3)
      .map((leader) => `${leader.ticker}${leader.changePct == null ? "" : ` ${leader.changePct >= 0 ? "+" : ""}${leader.changePct.toFixed(1)}%`}`)
      .join(", ");

    aggregate.score =
      Math.abs(scoreNumber(changePct)) * 1.5 +
      Math.abs(scoreNumber(premkt)) * 0.8 +
      aggregate.leaders.size * 2 +
      Math.min(scoreNumber(rvol), 10) * 2 +
      Math.max(0, scoreNumber(perf1W)) * 0.25 +
      Math.max(0, scoreNumber(perf1M)) * 0.1 +
      Math.max(0, scoreNumber(aggregate.deltaWow)) * 0.4 +
      Math.max(0, scoreNumber(aggregate.breadthPct) - 50) * 0.1;

    return {
      industry: aggregate.industry,
      sector: topSector(aggregate.sectorVotes),
      changePct,
      perf1W,
      perf1M,
      breadthPct: aggregate.breadthPct,
      deltaWow: aggregate.deltaWow,
      leaders: leaders.length ? leaders : null,
      note: leaderText ? `Leaders: ${leaderText}` : Array.from(aggregate.sources).join(", ") || null,
      score: aggregate.score,
    };
  });

  return rows
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 6)
    .map((row) => ({
      industry: row.industry,
      sector: row.sector,
      changePct: row.changePct,
      perf1W: row.perf1W,
      perf1M: row.perf1M,
      breadthPct: row.breadthPct,
      deltaWow: row.deltaWow,
      leaders: row.leaders,
      note: row.note,
    }));
}

export async function composeSnapshot(watchlist: string[]): Promise<ComposedSnapshot> {
  const [baseline, tvScreeners, breadth] = await Promise.all([
    readJsonFile<unknown>(PUBLIC_SNAPSHOT_PATH),
    readJsonFile<TvScreenersFile>(PUBLIC_TV_SCREENERS_PATH),
    readJsonFile<BreadthSnapshot>(PUBLIC_BREADTH_PATH),
  ]);
  const baselineBuiltAt =
    (baseline && typeof baseline === "object" && "built_at" in baseline
      ? String((baseline as { built_at: unknown }).built_at)
      : null) ?? null;

  const allSymbols = Array.from(
    new Set(INDEX_SYMBOLS.concat(SECTOR_SYMBOLS).concat(watchlist)),
  );
  const liveRows = await prisma.liveQuote.findMany({
    where: { symbol: { in: allSymbols } },
  });
  const liveBySymbol = new Map(liveRows.map((r) => [r.symbol, r]));

  let liveAsOf: Date | null = null;
  for (const r of liveRows) {
    if (!liveAsOf || r.observedAt > liveAsOf) liveAsOf = r.observedAt;
  }

  const pickGroup = (symbols: string[]) =>
    Object.fromEntries(
      symbols
        .map((s): [string, { price: number; changePct: number | null; source: string }] | null => {
          const row = liveBySymbol.get(s);
          if (!row) return null;
          return [
            s,
            {
              price: Number(row.price),
              changePct: row.changePct == null ? null : Number(row.changePct),
              source: row.source,
            },
          ];
        })
        .filter((x): x is [string, { price: number; changePct: number | null; source: string }] => x !== null),
    );

  return {
    builtAt: new Date().toISOString(),
    baselineBuiltAt,
    liveAsOf: liveAsOf ? liveAsOf.toISOString() : null,
    indices: pickGroup(INDEX_SYMBOLS),
    sectors: pickGroup(SECTOR_SYMBOLS),
    watchlist: pickGroup(watchlist),
    industryMovers: buildIndustryMovers({ baseline, tvScreeners, breadth }),
    baseline,
  };
}

/**
 * sha256 of the live-data subset. The baseline doesn't change intraday, so we
 * hash only the live overlay — that way a 15-min bucket whose live data is
 * unchanged from the previous bucket can short-circuit the regen.
 */
export function hashSnapshot(s: ComposedSnapshot): string {
  const subset = { indices: s.indices, sectors: s.sectors, watchlist: s.watchlist, industryMovers: s.industryMovers };
  return crypto.createHash("sha256").update(JSON.stringify(subset)).digest("hex");
}
