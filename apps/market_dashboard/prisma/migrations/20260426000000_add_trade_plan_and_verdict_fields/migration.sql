-- AlterTable: add pre-trade plan columns and AI verdict cache to Trade
-- IF NOT EXISTS guards against columns already present from a prior db push
ALTER TABLE "Trade"
  ADD COLUMN IF NOT EXISTS "proposedEntry"       DECIMAL(12,4),
  ADD COLUMN IF NOT EXISTS "proposedSL"          DECIMAL(12,4),
  ADD COLUMN IF NOT EXISTS "proposedTP"          DECIMAL(12,4),
  ADD COLUMN IF NOT EXISTS "rrr"                 DECIMAL(6,2),
  ADD COLUMN IF NOT EXISTS "riskPct"             DECIMAL(6,2),
  ADD COLUMN IF NOT EXISTS "rewardPct"           DECIMAL(6,2),
  ADD COLUMN IF NOT EXISTS "positionPct"         DECIMAL(6,2),
  ADD COLUMN IF NOT EXISTS "currency"            TEXT,
  ADD COLUMN IF NOT EXISTS "platform"            TEXT,
  ADD COLUMN IF NOT EXISTS "industry"            TEXT,
  ADD COLUMN IF NOT EXISTS "strategy"            TEXT,
  ADD COLUMN IF NOT EXISTS "verdict"             JSONB,
  ADD COLUMN IF NOT EXISTS "verdictScore"        DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "verdictGeneratedAt"  TIMESTAMP(3);
