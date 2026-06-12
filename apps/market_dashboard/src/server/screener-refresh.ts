import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fetchScreeners, type ScreenerFile } from "@/server/screener-scanner";
import { getOwnerUserId, ingestScreenerRec } from "@/server/a-list-extractor";
import { expireStaleRecCandidates } from "@/server/alist-maintenance";

const DEFAULT_FRESH_WINDOW_MS = 15 * 60 * 1000;

export interface StoredScreenerRow {
  bucketDate: Date;
  snapshot: unknown;
  source: string;
  refreshedAt: Date;
  durationMs: number | null;
}

export interface ScreenerRefreshResult {
  row: StoredScreenerRow;
  file: ScreenerFile;
  totalHits: number;
  recCandidates: number;
}

let refreshInFlight: Promise<ScreenerRefreshResult> | null = null;

export function screenerFreshWindowMs(): number {
  const configured = Number(process.env.SCREENER_FRESH_WINDOW_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_FRESH_WINDOW_MS;
}

export function isScreenerRowFresh(
  row: StoredScreenerRow | null,
  now = Date.now(),
  windowMs = screenerFreshWindowMs(),
): boolean {
  if (!row) return false;
  return now - row.refreshedAt.getTime() < windowMs;
}

export async function getLatestScreenerRow(): Promise<StoredScreenerRow | null> {
  return prisma.screenerSnapshot.findFirst({ orderBy: { refreshedAt: "desc" } });
}

function bucketDateForNow(): Date {
  return new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
}

function countHits(file: ScreenerFile): number {
  return file.screeners.reduce((n, screener) => n + screener.hits.length, 0);
}

async function refreshNow(source: string): Promise<ScreenerRefreshResult> {
  const today = bucketDateForNow();
  const { file, durationMs } = await fetchScreeners();
  const totalHits = countHits(file);
  if (totalHits === 0) {
    throw new Error("0 hits - TV may have rate-limited; not overwriting");
  }

  const row = await prisma.screenerSnapshot.upsert({
    where: { bucketDate: today },
    create: {
      bucketDate: today,
      snapshot: file as unknown as Prisma.InputJsonValue,
      source,
      durationMs,
    },
    update: {
      snapshot: file as unknown as Prisma.InputJsonValue,
      source,
      durationMs,
      refreshedAt: new Date(),
    },
  });

  let recCandidates = 0;
  try {
    recCandidates = (await ingestScreenerRec(file)).count;
  } catch (e) {
    console.error("[screener-refresh] REC ingest failed (non-fatal):", e);
  }

  // Entry-validity sweep: flip stale ACTIVE REC picks to EXPIRED so a
  // pre-open pick that never set up stops counting as actionable.
  try {
    const ownerId = await getOwnerUserId();
    if (ownerId) {
      const { expired, tickers } = await expireStaleRecCandidates(ownerId);
      if (expired > 0) console.log(`[screener-refresh] expired ${expired} stale REC picks: ${tickers.join(", ")}`);
    }
  } catch (e) {
    console.error("[screener-refresh] expiry sweep failed (non-fatal):", e);
  }

  return { row, file, totalHits, recCandidates };
}

export async function refreshScreenerSnapshot(source = "tv-scanner"): Promise<ScreenerRefreshResult> {
  if (refreshInFlight) return refreshInFlight;
  const task = refreshNow(source).finally(() => {
    refreshInFlight = null;
  });
  refreshInFlight = task;
  return task;
}

export function serializeScreenerRow(row: StoredScreenerRow, extraMeta: Record<string, unknown> = {}) {
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
