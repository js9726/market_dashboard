-- AlterTable: add state column to Trade
ALTER TABLE "Trade" ADD COLUMN "state" TEXT;

-- CreateTable: TradeVerdictHistory
CREATE TABLE "TradeVerdictHistory" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "tradeDate" TIMESTAMP(3),
    "model" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "verdict" JSONB NOT NULL,
    "score" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TradeVerdictHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradeVerdictHistory_tradeId_idx" ON "TradeVerdictHistory"("tradeId");
CREATE INDEX "TradeVerdictHistory_ticker_tradeDate_idx" ON "TradeVerdictHistory"("ticker", "tradeDate");

-- AddForeignKey
ALTER TABLE "TradeVerdictHistory" ADD CONSTRAINT "TradeVerdictHistory_tradeId_fkey"
    FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;
