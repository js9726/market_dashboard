-- Phase 0: Multi-broker / multi-tenant journal foundation.
--
-- Changes:
--   1. Rename Postgres table "JournalEntry" → "DailyReflection" (preserves data)
--      so the model name `JournalEntry` can be repurposed for per-trade analysis.
--   2. Add new multi-broker columns to "Trade" table (source, brokerAccountId,
--      brokerOrderId, executedAt). connectionId becomes NULLABLE.
--   3. Create new tables: BrokerPreset, UserBrokerAccount, BrokerBridgeToken,
--      Position, TradeFill, CsvImportMapping, MarketQuote.
--   4. Create new "JournalEntry" table (per-trade analysis).

-- ── Step 1: Rename JournalEntry table → DailyReflection ──────────────────────

ALTER TABLE "JournalEntry" RENAME TO "DailyReflection";

-- Rename unique constraint
ALTER INDEX "JournalEntry_userId_entryDate_key" RENAME TO "DailyReflection_userId_entryDate_key";

-- Rename index
ALTER INDEX "JournalEntry_userId_entryDate_idx" RENAME TO "DailyReflection_userId_entryDate_idx";

-- Rename primary key constraint
ALTER TABLE "DailyReflection" RENAME CONSTRAINT "JournalEntry_pkey" TO "DailyReflection_pkey";

-- Rename foreign key constraint
ALTER TABLE "DailyReflection" RENAME CONSTRAINT "JournalEntry_userId_fkey" TO "DailyReflection_userId_fkey";

-- ── Step 2: Extend Trade table with multi-broker fields ──────────────────────

-- Make connectionId nullable (existing sheet trades keep their connectionId,
-- new manual/bridge/CSV trades leave it NULL).
ALTER TABLE "Trade" ALTER COLUMN "connectionId" DROP NOT NULL;

-- Drop the existing FK constraint and re-create it with onDelete: SetNull
-- (Cascade on a nullable FK is unsafe — if we delete a SpreadsheetConnection
-- we'd lose all its trades. SetNull preserves history.)
ALTER TABLE "Trade" DROP CONSTRAINT "Trade_connectionId_fkey";
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "SpreadsheetConnection"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- New multi-broker columns. Default existing rows to source='SHEET'.
ALTER TABLE "Trade" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'SHEET';
ALTER TABLE "Trade" ADD COLUMN "brokerAccountId" TEXT;
ALTER TABLE "Trade" ADD COLUMN "brokerOrderId" TEXT;
ALTER TABLE "Trade" ADD COLUMN "executedAt" TIMESTAMP(3);

-- Indexes for new columns
CREATE INDEX "Trade_brokerAccountId_executedAt_idx" ON "Trade"("brokerAccountId", "executedAt");
CREATE INDEX "Trade_source_idx" ON "Trade"("source");

-- ── Step 3: BrokerPreset table ───────────────────────────────────────────────

CREATE TABLE "BrokerPreset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "feeFormula" JSONB NOT NULL,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BrokerPreset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrokerPreset_userId_name_key" ON "BrokerPreset"("userId", "name");
CREATE INDEX "BrokerPreset_isBuiltIn_idx" ON "BrokerPreset"("isBuiltIn");

ALTER TABLE "BrokerPreset" ADD CONSTRAINT "BrokerPreset_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Step 4: UserBrokerAccount table ──────────────────────────────────────────

CREATE TABLE "UserBrokerAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "presetId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "brokerAccountId" TEXT,
    "displayCurrency" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isLive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserBrokerAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserBrokerAccount_userId_alias_key" ON "UserBrokerAccount"("userId", "alias");
CREATE INDEX "UserBrokerAccount_userId_idx" ON "UserBrokerAccount"("userId");

ALTER TABLE "UserBrokerAccount" ADD CONSTRAINT "UserBrokerAccount_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserBrokerAccount" ADD CONSTRAINT "UserBrokerAccount_presetId_fkey"
  FOREIGN KEY ("presetId") REFERENCES "BrokerPreset"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Trade.brokerAccountId FK can be added now that UserBrokerAccount exists
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_brokerAccountId_fkey"
  FOREIGN KEY ("brokerAccountId") REFERENCES "UserBrokerAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Compound unique on (brokerAccountId, brokerOrderId) for bridge dedup.
-- NULLs are allowed (manual trades have no brokerOrderId); Postgres treats
-- multiple NULLs as distinct so this won't conflict.
CREATE UNIQUE INDEX "Trade_brokerAccountId_brokerOrderId_key"
  ON "Trade"("brokerAccountId", "brokerOrderId");

-- ── Step 5: BrokerBridgeToken table ──────────────────────────────────────────

CREATE TABLE "BrokerBridgeToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHeartbeat" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "BrokerBridgeToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrokerBridgeToken_userId_key" ON "BrokerBridgeToken"("userId");
CREATE UNIQUE INDEX "BrokerBridgeToken_tokenHash_key" ON "BrokerBridgeToken"("tokenHash");
CREATE INDEX "BrokerBridgeToken_lastHeartbeat_idx" ON "BrokerBridgeToken"("lastHeartbeat");

ALTER TABLE "BrokerBridgeToken" ADD CONSTRAINT "BrokerBridgeToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Step 6: Position table ───────────────────────────────────────────────────

CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "brokerAccountId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "avgCost" DECIMAL(12,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "currentPrice" DECIMAL(12,4),
    "marketValue" DECIMAL(18,4),
    "unrealizedPl" DECIMAL(18,4),
    "unrealizedPlPct" DECIMAL(8,4),
    "openedAt" TIMESTAMP(3) NOT NULL,
    "lastFillAt" TIMESTAMP(3) NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Position_brokerAccountId_ticker_key" ON "Position"("brokerAccountId", "ticker");
CREATE INDEX "Position_brokerAccountId_idx" ON "Position"("brokerAccountId");
CREATE INDEX "Position_ticker_idx" ON "Position"("ticker");

ALTER TABLE "Position" ADD CONSTRAINT "Position_brokerAccountId_fkey"
  FOREIGN KEY ("brokerAccountId") REFERENCES "UserBrokerAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Step 7: TradeFill table ──────────────────────────────────────────────────

CREATE TABLE "TradeFill" (
    "id" TEXT NOT NULL,
    "tradeRecordId" TEXT,
    "brokerAccountId" TEXT NOT NULL,
    "brokerFillId" TEXT,
    "ticker" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "price" DECIMAL(12,4) NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL,
    "fees" DECIMAL(12,4),
    "currency" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TradeFill_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TradeFill_brokerAccountId_brokerFillId_key" ON "TradeFill"("brokerAccountId", "brokerFillId");
CREATE INDEX "TradeFill_brokerAccountId_executedAt_idx" ON "TradeFill"("brokerAccountId", "executedAt" DESC);
CREATE INDEX "TradeFill_tradeRecordId_idx" ON "TradeFill"("tradeRecordId");
CREATE INDEX "TradeFill_ticker_executedAt_idx" ON "TradeFill"("ticker", "executedAt" DESC);

ALTER TABLE "TradeFill" ADD CONSTRAINT "TradeFill_tradeRecordId_fkey"
  FOREIGN KEY ("tradeRecordId") REFERENCES "Trade"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TradeFill" ADD CONSTRAINT "TradeFill_brokerAccountId_fkey"
  FOREIGN KEY ("brokerAccountId") REFERENCES "UserBrokerAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Step 8: CsvImportMapping table ───────────────────────────────────────────

CREATE TABLE "CsvImportMapping" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "brokerName" TEXT NOT NULL,
    "columnMap" JSONB NOT NULL,
    "dateFormat" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CsvImportMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CsvImportMapping_userId_brokerName_key" ON "CsvImportMapping"("userId", "brokerName");

ALTER TABLE "CsvImportMapping" ADD CONSTRAINT "CsvImportMapping_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Step 9: MarketQuote table ────────────────────────────────────────────────

CREATE TABLE "MarketQuote" (
    "symbol" TEXT NOT NULL,
    "price" DECIMAL(12,4) NOT NULL,
    "changePct" DECIMAL(8,4),
    "prevClose" DECIMAL(12,4),
    "dayHigh" DECIMAL(12,4),
    "dayLow" DECIMAL(12,4),
    "volume" BIGINT,
    "source" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketQuote_pkey" PRIMARY KEY ("symbol")
);

CREATE INDEX "MarketQuote_source_observedAt_idx" ON "MarketQuote"("source", "observedAt" DESC);
CREATE INDEX "MarketQuote_observedAt_idx" ON "MarketQuote"("observedAt" DESC);

-- ── Step 10: NEW JournalEntry table (per-trade analysis) ────────────────────
--
-- Distinct from the renamed DailyReflection (soft daily journal) and from
-- TradeVerdictHistory (multi-version AI scoring audit). One row per
-- TradeRecord. trade-analyser writes here.

CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tradeRecordId" TEXT NOT NULL,
    "setupType" TEXT NOT NULL,
    "primingPattern" TEXT,
    "setupJustification" TEXT,
    "traderScores" JSONB NOT NULL,
    "fundamentalGrade" TEXT,
    "fundamentalData" JSONB,
    "compositeScore" DECIMAL(4,2) NOT NULL,
    "bestStyleMatch" TEXT,
    "weakestDimension" TEXT,
    "entryVerdict" TEXT NOT NULL,
    "evolutionNote" TEXT,
    "patternNote" TEXT,
    "wikiRefs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JournalEntry_tradeRecordId_key" ON "JournalEntry"("tradeRecordId");
CREATE INDEX "JournalEntry_userId_createdAt_idx" ON "JournalEntry"("userId", "createdAt" DESC);

ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_tradeRecordId_fkey"
  FOREIGN KEY ("tradeRecordId") REFERENCES "Trade"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
