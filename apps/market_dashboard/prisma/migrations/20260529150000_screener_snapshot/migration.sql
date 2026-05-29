-- DB-backed TV screener (replaces fragile GitHub-Actions-cron + file-commit path).
-- Refreshed via /api/screeners/refresh (TradingView scanner from Vercel).

CREATE TABLE "ScreenerSnapshot" (
  "id"          TEXT NOT NULL,
  "bucketDate"  DATE NOT NULL,
  "snapshot"    JSONB NOT NULL,
  "source"      TEXT NOT NULL DEFAULT 'tv-scanner',
  "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "durationMs"  INTEGER,

  CONSTRAINT "ScreenerSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScreenerSnapshot_bucketDate_key" ON "ScreenerSnapshot" ("bucketDate");
CREATE INDEX "ScreenerSnapshot_refreshedAt_idx" ON "ScreenerSnapshot" ("refreshedAt" DESC);
