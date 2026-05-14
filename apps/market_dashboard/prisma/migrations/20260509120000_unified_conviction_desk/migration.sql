-- Phase 5: Unified Conviction Desk — brief cache + live quotes
--
-- MorningBriefCache: one row per (15-min bucket, provider). Drives the
-- /api/morning-verdict route's TTL cache. Pre-market run writes 4 providers,
-- intraday lazy-regen writes 2 (deepseek+gemini), owner re-run upserts any.
--
-- LiveQuote: single row per symbol, upserted by moomoo daemon or Yahoo
-- fallback workflow. Stale-flag is computed at read time from observedAt.

CREATE TABLE "MorningBriefCache" (
  "id"          TEXT       NOT NULL,
  "bucketAt"    TIMESTAMP(3) NOT NULL,
  "provider"    TEXT       NOT NULL,
  "htmlBody"    TEXT       NOT NULL,
  "verdictJson" JSONB,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "generatedBy" TEXT       NOT NULL,
  "inputHash"   TEXT       NOT NULL,
  "tokensIn"    INTEGER,
  "tokensOut"   INTEGER,
  "costUsd"     DECIMAL(10, 6),
  "errorMsg"    TEXT,

  CONSTRAINT "MorningBriefCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MorningBriefCache_bucketAt_provider_key"
  ON "MorningBriefCache" ("bucketAt", "provider");

CREATE INDEX "MorningBriefCache_provider_bucketAt_idx"
  ON "MorningBriefCache" ("provider", "bucketAt" DESC);

CREATE INDEX "MorningBriefCache_generatedAt_idx"
  ON "MorningBriefCache" ("generatedAt" DESC);

CREATE TABLE "LiveQuote" (
  "symbol"     TEXT NOT NULL,
  "price"      DECIMAL(12, 4) NOT NULL,
  "changePct"  DECIMAL(8, 4),
  "volume"     BIGINT,
  "source"     TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LiveQuote_pkey" PRIMARY KEY ("symbol")
);

CREATE INDEX "LiveQuote_source_observedAt_idx"
  ON "LiveQuote" ("source", "observedAt" DESC);
