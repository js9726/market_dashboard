-- AlterTable
ALTER TABLE "TradeVerdictHistory" ADD COLUMN     "style" TEXT NOT NULL DEFAULT 'trader-debate';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "dailyScansLimit" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "dailyScansUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastQuotaResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "Watchlist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Watchlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanResult" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "signal" TEXT NOT NULL,
    "entry" DECIMAL(12,4),
    "stop" DECIMAL(12,4),
    "target" DECIMAL(12,4),
    "confidence" DOUBLE PRECISION,
    "agents" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScanResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Watchlist_userId_idx" ON "Watchlist"("userId");

-- CreateIndex
CREATE INDEX "Watchlist_ticker_idx" ON "Watchlist"("ticker");

-- CreateIndex
CREATE UNIQUE INDEX "Watchlist_userId_ticker_key" ON "Watchlist"("userId", "ticker");

-- CreateIndex
CREATE INDEX "ScanResult_userId_expiresAt_idx" ON "ScanResult"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "ScanResult_userId_ticker_idx" ON "ScanResult"("userId", "ticker");

-- CreateIndex
CREATE INDEX "ScanResult_ticker_idx" ON "ScanResult"("ticker");

-- AddForeignKey
ALTER TABLE "Watchlist" ADD CONSTRAINT "Watchlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanResult" ADD CONSTRAINT "ScanResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
