-- Add intent classifier to WikiTradeVerdict so chat-analysis verdicts can be
-- stored in the same table without polluting the monthly audit rollup.
-- Existing rows backfill to 'journal' (the current single-purpose use).

ALTER TABLE "WikiTradeVerdict" ADD COLUMN "intent" TEXT NOT NULL DEFAULT 'journal';
CREATE INDEX "WikiTradeVerdict_intent_tradeDate_idx" ON "WikiTradeVerdict" ("intent", "tradeDate" DESC);

-- Daily screener snapshots. Lightweight: one row per (operator, date, ticker, source).
-- No LLM verdict per row; the row is just "this screener flagged this ticker on
-- this date." Used to compute conversion rate (screener → journaled trade)
-- without bloating WikiTradeVerdict.

CREATE TABLE "WikiScreenerPick" (
  "id"                  TEXT NOT NULL,
  "operatorLabel"       TEXT NOT NULL DEFAULT 'JS',
  "pickDate"            DATE NOT NULL,
  "ticker"              TEXT NOT NULL,
  "setupClassification" TEXT,
  "screenSource"        TEXT NOT NULL,
  "notes"               TEXT,
  "sourceUrl"           TEXT,
  "convertedTradeId"    TEXT,
  "ingestedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WikiScreenerPick_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WikiScreenerPick_operatorLabel_pickDate_ticker_screenSource_key"
  ON "WikiScreenerPick" ("operatorLabel", "pickDate", "ticker", "screenSource");
CREATE INDEX "WikiScreenerPick_operatorLabel_pickDate_idx"
  ON "WikiScreenerPick" ("operatorLabel", "pickDate" DESC);
CREATE INDEX "WikiScreenerPick_ticker_pickDate_idx"
  ON "WikiScreenerPick" ("ticker", "pickDate" DESC);
CREATE INDEX "WikiScreenerPick_screenSource_pickDate_idx"
  ON "WikiScreenerPick" ("screenSource", "pickDate" DESC);
