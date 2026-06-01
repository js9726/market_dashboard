-- Phase 2-3: HELD-lane (bought-position) tracking on the merged A-List.
-- (see apps/market_dashboard/docs/PLAN-pre-open-ci-and-journal-revamp.md +
--  the 2026-05-30 conviction-redesign decisions)
--
-- Additive only: every new AListCandidate column is nullable or defaulted, so
-- this is safe to apply to the populated table with no backfill required.
--
-- A row can be REC-only (brief pick), HELD-only (off-book buy), or REC+HELD
-- (on-book). The score>=80 / GO / RVOL>=1.5 bar only gates the REC badge;
-- HELD membership is "a real fill landed in the account" — ungated.

-- ── HELD linkage ────────────────────────────────────────────────────────────
ALTER TABLE "AListCandidate" ADD COLUMN "isHeld"            BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AListCandidate" ADD COLUMN "heldPositionId"    TEXT;
ALTER TABLE "AListCandidate" ADD COLUMN "heldTradeRecordId" TEXT;
ALTER TABLE "AListCandidate" ADD COLUMN "entryFillAt"       TIMESTAMP(3);
ALTER TABLE "AListCandidate" ADD COLUMN "entryAvgCost"      DECIMAL(12, 4);
ALTER TABLE "AListCandidate" ADD COLUMN "heldQty"           DECIMAL(18, 4);
ALTER TABLE "AListCandidate" ADD COLUMN "onBook"            BOOLEAN;
ALTER TABLE "AListCandidate" ADD COLUMN "entryGrade"        TEXT;
ALTER TABLE "AListCandidate" ADD COLUMN "entryGradeJson"    JSONB;

-- ── 1R bases (both: logged stop + wiki ATR-floor) ────────────────────────────
ALTER TABLE "AListCandidate" ADD COLUMN "rUnitLogged"  DECIMAL(12, 4);
ALTER TABLE "AListCandidate" ADD COLUMN "rUnitAtr"     DECIMAL(12, 4);
ALTER TABLE "AListCandidate" ADD COLUMN "atrFloorStop" DECIMAL(12, 4);

-- ── Savings metrics ──────────────────────────────────────────────────────────
ALTER TABLE "AListCandidate" ADD COLUMN "realizedRLogged"   DECIMAL(6, 2);
ALTER TABLE "AListCandidate" ADD COLUMN "realizedRAtr"      DECIMAL(6, 2);
ALTER TABLE "AListCandidate" ADD COLUMN "saveRealizedUsd"   DECIMAL(12, 2);
ALTER TABLE "AListCandidate" ADD COLUMN "saveRealizedR"     DECIMAL(6, 2);
ALTER TABLE "AListCandidate" ADD COLUMN "soft8emaExit"      DECIMAL(12, 4);
ALTER TABLE "AListCandidate" ADD COLUMN "soft21emaExit"     DECIMAL(12, 4);
ALTER TABLE "AListCandidate" ADD COLUMN "saveSoftVsHardUsd" DECIMAL(12, 2);
ALTER TABLE "AListCandidate" ADD COLUMN "saveSoftVsHardR"   DECIMAL(6, 2);
ALTER TABLE "AListCandidate" ADD COLUMN "hardStopHitAt"     TIMESTAMP(3);
ALTER TABLE "AListCandidate" ADD COLUMN "hardStopHitBasis"  TEXT;

CREATE INDEX "AListCandidate_isHeld_pickDate_idx"   ON "AListCandidate" ("isHeld", "pickDate" DESC);
CREATE INDEX "AListCandidate_heldPositionId_idx"    ON "AListCandidate" ("heldPositionId");

-- ── PositionDailyTrack — per-session price path for the day-0->14 window ──────
CREATE TABLE "PositionDailyTrack" (
  "id"                TEXT NOT NULL,
  "candidateId"       TEXT NOT NULL,
  "dayIndex"          INTEGER NOT NULL,
  "sessionDate"       DATE NOT NULL,
  "open"              DECIMAL(12, 4),
  "high"              DECIMAL(12, 4),
  "low"               DECIMAL(12, 4),
  "close"             DECIMAL(12, 4),
  "ema8"              DECIMAL(12, 4),
  "ema21"             DECIMAL(12, 4),
  "atr14"             DECIMAL(12, 4),
  "closeBelow8ema"    BOOLEAN NOT NULL DEFAULT false,
  "closeBelow21ema"   BOOLEAN NOT NULL DEFAULT false,
  "hardStopHitLogged" BOOLEAN NOT NULL DEFAULT false,
  "hardStopHitAtr"    BOOLEAN NOT NULL DEFAULT false,
  "runMfeR"           DECIMAL(6, 2),
  "runMaeR"           DECIMAL(6, 2),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PositionDailyTrack_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PositionDailyTrack_candidateId_sessionDate_key"
  ON "PositionDailyTrack" ("candidateId", "sessionDate");
CREATE INDEX "PositionDailyTrack_candidateId_dayIndex_idx"
  ON "PositionDailyTrack" ("candidateId", "dayIndex");

ALTER TABLE "PositionDailyTrack"
  ADD CONSTRAINT "PositionDailyTrack_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "AListCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
