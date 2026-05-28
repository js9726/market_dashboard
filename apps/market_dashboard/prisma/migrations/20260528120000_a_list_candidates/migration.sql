-- Phase 1 of pre-open CI + journal revamp plan
-- (see apps/market_dashboard/docs/PLAN-pre-open-ci-and-journal-revamp.md).
--
-- A-list candidate: daily strict-quality picks from the pre-open brief that
-- meet ALL three filters:
--   1. score >= 80
--   2. verdict == "GO"
--   3. RVOL >= 1.5x
--
-- Tracked across 14 sessions with day-0 entry thesis + day-14 outcome
-- (MFE / MAE / outcome score). Surfaced on a dedicated /a-list dashboard page.

CREATE TABLE "AListCandidate" (
  "id"                  TEXT NOT NULL,
  "userId"              TEXT NOT NULL,
  "operatorLabel"       TEXT NOT NULL DEFAULT 'JS',
  "pickDate"            DATE NOT NULL,
  "ticker"              TEXT NOT NULL,
  "setupClassification" TEXT,
  "screenSource"        TEXT,
  "sector"              TEXT,
  "industry"            TEXT,
  "source"              TEXT NOT NULL DEFAULT 'AUTO',

  -- Day-0 entry proposal
  "entryZone"           DECIMAL(12, 4),
  "stop"                DECIMAL(12, 4),
  "target"              DECIMAL(12, 4),
  "rrr"                 DECIMAL(6, 2),
  "day0Score"           INTEGER,
  "day0Verdict"         TEXT,
  "day0Rvol"            DECIMAL(6, 2),
  "day0Thesis"          TEXT,
  "day0TraderLens"      TEXT,
  "day0BriefBucketAt"   TIMESTAMP(3),
  "day0BriefProvider"   TEXT,
  "day0Price"           DECIMAL(12, 4),

  -- Day-14 outcome
  "day14Mfe"            DECIMAL(12, 4),
  "day14Mae"            DECIMAL(12, 4),
  "day14MfeR"           DECIMAL(6, 2),
  "day14MaeR"           DECIMAL(6, 2),
  "day14Score"          DECIMAL(4, 2),
  "day14Verdict"        TEXT,
  "day14TraderScores"   JSONB,
  "day14Outcome"        TEXT,
  "day14ComputedAt"     TIMESTAMP(3),

  -- Status lifecycle
  "status"              TEXT NOT NULL DEFAULT 'ACTIVE',
  "convertedTradeId"    TEXT,

  -- Free-form
  "notes"               TEXT,
  "tags"                JSONB,

  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AListCandidate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AListCandidate_userId_pickDate_ticker_key"
  ON "AListCandidate" ("userId", "pickDate", "ticker");
CREATE INDEX "AListCandidate_userId_pickDate_idx"
  ON "AListCandidate" ("userId", "pickDate" DESC);
CREATE INDEX "AListCandidate_ticker_pickDate_idx"
  ON "AListCandidate" ("ticker", "pickDate" DESC);
CREATE INDEX "AListCandidate_status_pickDate_idx"
  ON "AListCandidate" ("status", "pickDate" DESC);
CREATE INDEX "AListCandidate_day14Outcome_pickDate_idx"
  ON "AListCandidate" ("day14Outcome", "pickDate" DESC);
CREATE INDEX "AListCandidate_sector_pickDate_idx"
  ON "AListCandidate" ("sector", "pickDate" DESC);

ALTER TABLE "AListCandidate"
  ADD CONSTRAINT "AListCandidate_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
