CREATE TABLE "WikiAudit" (
  "period" TEXT NOT NULL,
  "markdown" TEXT NOT NULL,
  "parsedJson" JSONB NOT NULL,
  "sourcePath" TEXT,
  "sizeBytes" INTEGER,
  "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WikiAudit_pkey" PRIMARY KEY ("period")
);

CREATE TABLE "WikiTradeVerdict" (
  "id" TEXT NOT NULL,
  "tradeDate" DATE NOT NULL,
  "ticker" TEXT NOT NULL,
  "year" TEXT NOT NULL,
  "day0Json" JSONB,
  "day14Json" JSONB,
  "day0SourcePath" TEXT,
  "day14SourcePath" TEXT,
  "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WikiTradeVerdict_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WikiAudit_updatedAt_idx" ON "WikiAudit" ("updatedAt" DESC);
CREATE UNIQUE INDEX "WikiTradeVerdict_tradeDate_ticker_key" ON "WikiTradeVerdict" ("tradeDate", "ticker");
CREATE INDEX "WikiTradeVerdict_ticker_tradeDate_idx" ON "WikiTradeVerdict" ("ticker", "tradeDate" DESC);
CREATE INDEX "WikiTradeVerdict_tradeDate_idx" ON "WikiTradeVerdict" ("tradeDate" DESC);
