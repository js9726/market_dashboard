-- Authoritative daily OHLCV bars pushed from the local OpenD/IBKR bridge (P2).
-- The tracker prefers these over the cloud Yahoo/Stooq fallback when fresh.
CREATE TABLE "BrokerDailyBar" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "open" DECIMAL(14,4),
    "high" DECIMAL(14,4),
    "low" DECIMAL(14,4),
    "close" DECIMAL(14,4),
    "volume" BIGINT,
    "source" TEXT NOT NULL DEFAULT 'opend',
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BrokerDailyBar_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BrokerDailyBar_ticker_date_key" ON "BrokerDailyBar"("ticker", "date");
CREATE INDEX "BrokerDailyBar_ticker_date_idx" ON "BrokerDailyBar"("ticker", "date" DESC);
