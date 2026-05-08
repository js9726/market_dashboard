-- Add kind + outcomeMetrics to TradeVerdictHistory for day-14 rescore support.
-- See wiki/log.md 2026-05-07 architecture correction (Phase B).

-- AlterTable
ALTER TABLE "TradeVerdictHistory"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'day-0',
  ADD COLUMN "outcomeMetrics" JSONB;

-- CreateIndex: cron query "find day-0 verdicts 14+ days old"
CREATE INDEX "TradeVerdictHistory_kind_createdAt_idx" ON "TradeVerdictHistory"("kind", "createdAt");

-- CreateIndex: cron check "does a day-14-rescore already exist for this trade?"
CREATE INDEX "TradeVerdictHistory_tradeId_kind_idx" ON "TradeVerdictHistory"("tradeId", "kind");
