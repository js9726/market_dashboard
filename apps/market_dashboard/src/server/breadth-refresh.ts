import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  fetchBreadth,
  type BreadthSnapshot,
  type IndustryBreadthRow,
  type SectorBreadthRow,
} from "@/server/breadth-scanner";

const DEFAULT_FRESH_WINDOW_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface StoredBreadthRow {
  bucketDate: Date;
  snapshot: unknown;
  source: string;
  refreshedAt: Date;
  durationMs: number | null;
}

let refreshInFlight: Promise<StoredBreadthRow> | null = null;

export function breadthFreshWindowMs(): number {
  const configured = Number(process.env.BREADTH_FRESH_WINDOW_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_FRESH_WINDOW_MS;
}

export function isBreadthRowFresh(
  row: StoredBreadthRow | null,
  now = Date.now(),
  windowMs = breadthFreshWindowMs(),
): boolean {
  if (!row) return false;
  return now - row.refreshedAt.getTime() < windowMs;
}

export async function getLatestBreadthRow(): Promise<StoredBreadthRow | null> {
  return prisma.marketBreadthSnapshot.findFirst({
    orderBy: { refreshedAt: "desc" },
  });
}

function bucketDateForNow(): Date {
  return new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
}

function coerceSnapshot(value: unknown): BreadthSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<BreadthSnapshot>;
  if (!Array.isArray(candidate.sectors) || !Array.isArray(candidate.industries)) return null;
  if (!candidate.market || !candidate.momentum) return null;
  return candidate as BreadthSnapshot;
}

function findComparisonSnapshot(rows: StoredBreadthRow[], cutoffMs: number): BreadthSnapshot | null {
  for (const row of rows) {
    if (row.refreshedAt.getTime() > cutoffMs) continue;
    const snapshot = coerceSnapshot(row.snapshot);
    if (snapshot) return snapshot;
  }
  return null;
}

function delta(current: number, previous: number | null | undefined): number | null {
  if (previous == null || Number.isNaN(previous)) return null;
  return Math.round((current - previous) * 10) / 10;
}

function withSectorDeltas(
  rows: SectorBreadthRow[],
  week: BreadthSnapshot | null,
  month: BreadthSnapshot | null,
): SectorBreadthRow[] {
  const weekMap = new Map((week?.sectors ?? []).map((row) => [row.sector, row]));
  const monthMap = new Map((month?.sectors ?? []).map((row) => [row.sector, row]));
  return rows.map((row) => ({
    ...row,
    delta_wow: delta(row.pct_above_50sma, weekMap.get(row.sector)?.pct_above_50sma),
    delta_mom: delta(row.pct_above_50sma, monthMap.get(row.sector)?.pct_above_50sma),
  }));
}

function withIndustryDeltas(
  rows: IndustryBreadthRow[],
  week: BreadthSnapshot | null,
  month: BreadthSnapshot | null,
): IndustryBreadthRow[] {
  const weekMap = new Map((week?.industries ?? []).map((row) => [row.industry, row]));
  const monthMap = new Map((month?.industries ?? []).map((row) => [row.industry, row]));
  return rows.map((row) => ({
    ...row,
    delta_wow: delta(row.pct_above_50sma, weekMap.get(row.industry)?.pct_above_50sma),
    delta_mom: delta(row.pct_above_50sma, monthMap.get(row.industry)?.pct_above_50sma),
  }));
}

function attachHistoryDeltas(snapshot: BreadthSnapshot, historyRows: StoredBreadthRow[]): BreadthSnapshot {
  const now = Date.now();
  const week = findComparisonSnapshot(historyRows, now - 6 * DAY_MS);
  const month = findComparisonSnapshot(historyRows, now - 25 * DAY_MS);
  return {
    ...snapshot,
    sectors: withSectorDeltas(snapshot.sectors, week, month),
    industries: withIndustryDeltas(snapshot.industries, week, month),
  };
}

async function refreshNow(source: string): Promise<StoredBreadthRow> {
  const today = bucketDateForNow();
  const historyRows = await prisma.marketBreadthSnapshot.findMany({
    orderBy: { refreshedAt: "desc" },
    take: 45,
  });
  const { snapshot, durationMs } = await fetchBreadth();
  const enriched = attachHistoryDeltas(snapshot, historyRows);

  return prisma.marketBreadthSnapshot.upsert({
    where: { bucketDate: today },
    create: {
      bucketDate: today,
      snapshot: enriched as unknown as Prisma.InputJsonValue,
      source,
      durationMs,
    },
    update: {
      snapshot: enriched as unknown as Prisma.InputJsonValue,
      source,
      durationMs,
      refreshedAt: new Date(),
    },
  });
}

export async function refreshBreadthSnapshot(source = "tv-scanner"): Promise<StoredBreadthRow> {
  if (refreshInFlight) return refreshInFlight;
  const task = refreshNow(source).finally(() => {
    refreshInFlight = null;
  });
  refreshInFlight = task;
  return task;
}

export function serializeBreadthRow(row: StoredBreadthRow, extraMeta: Record<string, unknown> = {}) {
  const snapshot = row.snapshot as Record<string, unknown>;
  return {
    ...snapshot,
    _meta: {
      source: row.source,
      refreshedAt: row.refreshedAt.toISOString(),
      ageMs: Date.now() - row.refreshedAt.getTime(),
      durationMs: row.durationMs,
      ...extraMeta,
    },
  };
}
