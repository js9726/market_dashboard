-- Add operatorLabel to WikiAudit and WikiTradeVerdict for shared-with-operator-chip view.
-- Existing rows backfill to 'JS' so the current single-operator data keeps working.

ALTER TABLE "WikiAudit" ADD COLUMN "operatorLabel" TEXT NOT NULL DEFAULT 'JS';
ALTER TABLE "WikiAudit" DROP CONSTRAINT "WikiAudit_pkey";
ALTER TABLE "WikiAudit" ADD CONSTRAINT "WikiAudit_pkey" PRIMARY KEY ("operatorLabel", "period");
CREATE INDEX "WikiAudit_period_idx" ON "WikiAudit" ("period" DESC);

ALTER TABLE "WikiTradeVerdict" ADD COLUMN "operatorLabel" TEXT NOT NULL DEFAULT 'JS';
DROP INDEX IF EXISTS "WikiTradeVerdict_tradeDate_ticker_key";
CREATE UNIQUE INDEX "WikiTradeVerdict_operatorLabel_tradeDate_ticker_key"
  ON "WikiTradeVerdict" ("operatorLabel", "tradeDate", "ticker");
