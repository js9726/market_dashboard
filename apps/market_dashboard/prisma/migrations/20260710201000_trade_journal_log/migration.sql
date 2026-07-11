CREATE TABLE "TradeJournalLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'THOUGHT',
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeJournalLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TradeJournalLog_tradeId_createdAt_idx" ON "TradeJournalLog"("tradeId", "createdAt" DESC);
CREATE INDEX "TradeJournalLog_userId_createdAt_idx" ON "TradeJournalLog"("userId", "createdAt" DESC);

ALTER TABLE "TradeJournalLog" ADD CONSTRAINT "TradeJournalLog_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TradeJournalLog" ADD CONSTRAINT "TradeJournalLog_tradeId_fkey"
FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;
