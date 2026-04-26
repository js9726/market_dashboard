-- AlterTable: add pre-trade plan columns and AI verdict cache to Trade
ALTER TABLE "Trade"
  ADD COLUMN "proposedEntry"       DECIMAL(12,4),
  ADD COLUMN "proposedSL"          DECIMAL(12,4),
  ADD COLUMN "proposedTP"          DECIMAL(12,4),
  ADD COLUMN "rrr"                 DECIMAL(6,2),
  ADD COLUMN "riskPct"             DECIMAL(6,2),
  ADD COLUMN "rewardPct"           DECIMAL(6,2),
  ADD COLUMN "positionPct"         DECIMAL(6,2),
  ADD COLUMN "currency"            TEXT,
  ADD COLUMN "platform"            TEXT,
  ADD COLUMN "industry"            TEXT,
  ADD COLUMN "strategy"            TEXT,
  ADD COLUMN "verdict"             JSONB,
  ADD COLUMN "verdictScore"        DOUBLE PRECISION,
  ADD COLUMN "verdictGeneratedAt"  TIMESTAMP(3);
