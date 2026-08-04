-- Evidence-backed final daily-screener runs. These are distinct from the
-- automated A-list pre-filter and are the only source for Telegram GO pushes.
CREATE TABLE "DailyScreenerRun" (
    "id" TEXT NOT NULL,
    "runDate" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "generatedBy" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "reportMarkdown" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "goListHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyScreenerRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DailyScreenerChunk" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "chunkKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ticker" TEXT,
    "grade" TEXT,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "data" JSONB,
    "ordinal" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyScreenerChunk_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TelegramDelivery" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "telegramMessageId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyScreenerRun_runDate_source_key"
ON "DailyScreenerRun"("runDate", "source");

CREATE INDEX "DailyScreenerRun_runDate_idx"
ON "DailyScreenerRun"("runDate" DESC);

CREATE INDEX "DailyScreenerRun_updatedAt_idx"
ON "DailyScreenerRun"("updatedAt" DESC);

CREATE UNIQUE INDEX "DailyScreenerChunk_runId_chunkKey_key"
ON "DailyScreenerChunk"("runId", "chunkKey");

CREATE INDEX "DailyScreenerChunk_ticker_idx"
ON "DailyScreenerChunk"("ticker");

CREATE INDEX "DailyScreenerChunk_runId_ordinal_idx"
ON "DailyScreenerChunk"("runId", "ordinal");

CREATE UNIQUE INDEX "TelegramDelivery_dedupeKey_key"
ON "TelegramDelivery"("dedupeKey");

CREATE INDEX "TelegramDelivery_kind_createdAt_idx"
ON "TelegramDelivery"("kind", "createdAt" DESC);

CREATE INDEX "TelegramDelivery_status_updatedAt_idx"
ON "TelegramDelivery"("status", "updatedAt" DESC);

ALTER TABLE "DailyScreenerChunk"
ADD CONSTRAINT "DailyScreenerChunk_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "DailyScreenerRun"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
