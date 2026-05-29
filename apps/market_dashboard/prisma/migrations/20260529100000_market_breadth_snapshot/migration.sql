-- DB-backed market breadth (replaces fragile file + git-commit path).
-- Powered by the TradingView scanner aggregate-count endpoint; refreshed via
-- /api/breadth/refresh which any scheduler can trigger.

CREATE TABLE "MarketBreadthSnapshot" (
  "id"          TEXT NOT NULL,
  "bucketDate"  DATE NOT NULL,
  "snapshot"    JSONB NOT NULL,
  "source"      TEXT NOT NULL DEFAULT 'tv-scanner',
  "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "durationMs"  INTEGER,

  CONSTRAINT "MarketBreadthSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketBreadthSnapshot_bucketDate_key"
  ON "MarketBreadthSnapshot" ("bucketDate");
CREATE INDEX "MarketBreadthSnapshot_refreshedAt_idx"
  ON "MarketBreadthSnapshot" ("refreshedAt" DESC);
