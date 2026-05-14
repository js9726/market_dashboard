/**
 * Brief cache — Postgres-backed, keyed by (bucketAt, provider).
 *
 * Read path: pull the row(s) for the current 15-min bucket. If the bucket is
 * inside the intraday window AND any INTRADAY_PROVIDERS rows are missing,
 * fire-and-forget regen and return whatever's already cached (frontend will
 * poll again at next interval and pick up the freshly written rows).
 *
 * Regen lock: a single in-memory Set tracks (bucketAt × provider) tuples
 * currently being regenerated. Prevents duplicate work inside the same Node
 * process. (Cross-instance dedup is not critical at single-user scale; the
 * unique index on (bucketAt, provider) means duplicate writes upsert rather
 * than error.)
 */
import { prisma } from "@/lib/prisma";
import {
  ALL_PROVIDERS,
  INTRADAY_PROVIDERS,
  bucketOf,
  isIntradayWindow,
  type BriefProvider,
} from "@/lib/brief/bucket";
import { composeSnapshot, hashSnapshot } from "@/lib/brief/snapshot";
import { runProvider } from "./brief-providers";

/** Fallback used only when the DB watchlist is empty and no OWNER_EMAIL is set. */
export const DEFAULT_WATCHLIST = [
  "NVDA", "TSLA", "AAPL", "MSFT", "AMZN", "META",
  "GOOGL", "AMD", "SMCI", "PLTR", "CRWD", "MSTR",
];

/**
 * Fetch the owner's personal watchlist from Postgres.
 * Falls back to DEFAULT_WATCHLIST when the list is empty or the owner
 * user doesn't exist yet (e.g. first boot before first login).
 */
async function getOwnerWatchlist(): Promise<string[]> {
  const ownerEmail = process.env.OWNER_EMAIL;
  if (!ownerEmail) return DEFAULT_WATCHLIST;
  try {
    const owner = await prisma.user.findUnique({
      where: { email: ownerEmail },
      select: {
        watchlist: { select: { ticker: true }, orderBy: { addedAt: "desc" } },
      },
    });
    const tickers = (owner?.watchlist ?? []).map((w) => w.ticker);
    return tickers.length > 0 ? tickers : DEFAULT_WATCHLIST;
  } catch {
    return DEFAULT_WATCHLIST;
  }
}

const inflight = new Set<string>();

function lockKey(bucket: Date, provider: BriefProvider): string {
  return `${bucket.toISOString()}|${provider}`;
}

export async function readBucket(bucket: Date) {
  return prisma.morningBriefCache.findMany({
    where: { bucketAt: bucket },
    orderBy: { provider: "asc" },
  });
}

export async function readLatestRow(provider: BriefProvider) {
  return prisma.morningBriefCache.findFirst({
    where: { provider },
    orderBy: { generatedAt: "desc" },
  });
}

/**
 * Run a provider for the given bucket and write the result. Throws on
 * provider failure; the caller decides whether to upsert an errored row or
 * propagate.
 */
export async function regenAndStore(opts: {
  bucket: Date;
  provider: BriefProvider;
  generatedBy: string;
  watchlist?: string[];
}): Promise<void> {
  // Prefer explicitly-passed watchlist (e.g. from owner rerun route), then DB.
  const watchlist = opts.watchlist ?? (await getOwnerWatchlist());
  const key = lockKey(opts.bucket, opts.provider);
  if (inflight.has(key)) return;
  inflight.add(key);
  try {
    const snapshot = await composeSnapshot(watchlist);
    const inputHash = hashSnapshot(snapshot);

    // Skip regen if the same bucket already has a row with the same input hash.
    const existing = await prisma.morningBriefCache.findUnique({
      where: { bucketAt_provider: { bucketAt: opts.bucket, provider: opts.provider } },
    });
    if (existing && existing.inputHash === inputHash && !existing.errorMsg) {
      return;
    }

    let result;
    try {
      result = await runProvider(opts.provider, snapshot, watchlist);
    } catch (err) {
      // Record the failure so the UI can surface it instead of looping regen.
      await prisma.morningBriefCache.upsert({
        where: { bucketAt_provider: { bucketAt: opts.bucket, provider: opts.provider } },
        create: {
          bucketAt: opts.bucket,
          provider: opts.provider,
          htmlBody: "",
          generatedBy: opts.generatedBy,
          inputHash,
          errorMsg: (err as Error).message.slice(0, 500),
        },
        update: {
          htmlBody: "",
          verdictJson: undefined,
          generatedAt: new Date(),
          generatedBy: opts.generatedBy,
          inputHash,
          errorMsg: (err as Error).message.slice(0, 500),
        },
      });
      return;
    }

    await prisma.morningBriefCache.upsert({
      where: { bucketAt_provider: { bucketAt: opts.bucket, provider: opts.provider } },
      create: {
        bucketAt: opts.bucket,
        provider: opts.provider,
        htmlBody: result.htmlBody,
        verdictJson: (result.verdictJson ?? null) as never,
        structuredJson: (result.structuredJson ?? null) as never,
        generatedBy: opts.generatedBy,
        inputHash,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
      },
      update: {
        htmlBody: result.htmlBody,
        verdictJson: (result.verdictJson ?? null) as never,
        structuredJson: (result.structuredJson ?? null) as never,
        generatedAt: new Date(),
        generatedBy: opts.generatedBy,
        inputHash,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        errorMsg: null,
      },
    });
  } finally {
    inflight.delete(key);
  }
}

/**
 * Read the current bucket; if we're inside the intraday window and any
 * intraday-tier provider is missing, kick off regen in the background and
 * return whatever is already cached. The caller (HTTP route) does NOT await
 * the regen — it would defeat the purpose of TTL caching.
 */
export async function readCurrentBucketWithLazyRegen() {
  const now = new Date();
  const bucket = bucketOf(now);
  const rows = await readBucket(bucket);

  if (isIntradayWindow(now)) {
    const present = new Set(rows.map((r) => r.provider as BriefProvider));
    const missing = INTRADAY_PROVIDERS.filter((p) => !present.has(p));
    for (const provider of missing) {
      // Fire-and-forget. Errors are caught inside regenAndStore.
      void regenAndStore({ bucket, provider, generatedBy: "intraday-lazy" }).catch(() => {});
    }
  }

  return { bucket, rows };
}

/** Used by the ingest endpoint (cron pre-market push). Always upserts. */
export async function ingestRow(opts: {
  bucket: Date;
  provider: BriefProvider;
  htmlBody: string;
  verdictJson: unknown;
  structuredJson: unknown;
  generatedBy: string;
  inputHash: string;
  tokensIn?: number | null;
  tokensOut?: number | null;
  costUsd?: number | null;
}) {
  return prisma.morningBriefCache.upsert({
    where: { bucketAt_provider: { bucketAt: opts.bucket, provider: opts.provider } },
    create: {
      bucketAt: opts.bucket,
      provider: opts.provider,
      htmlBody: opts.htmlBody,
      verdictJson: (opts.verdictJson ?? null) as never,
      structuredJson: (opts.structuredJson ?? null) as never,
      generatedBy: opts.generatedBy,
      inputHash: opts.inputHash,
      tokensIn: opts.tokensIn ?? null,
      tokensOut: opts.tokensOut ?? null,
      costUsd: opts.costUsd ?? null,
    },
    update: {
      htmlBody: opts.htmlBody,
      verdictJson: (opts.verdictJson ?? null) as never,
      structuredJson: (opts.structuredJson ?? null) as never,
      generatedAt: new Date(),
      generatedBy: opts.generatedBy,
      inputHash: opts.inputHash,
      tokensIn: opts.tokensIn ?? null,
      tokensOut: opts.tokensOut ?? null,
      costUsd: opts.costUsd ?? null,
      errorMsg: null,
    },
  });
}

export { ALL_PROVIDERS };
