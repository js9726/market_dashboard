-- Phase 4 of pre-open CI + journal revamp plan
-- (see apps/market_dashboard/docs/PLAN-pre-open-ci-and-journal-revamp.md).
--
-- Daily equity snapshot captured by the dashboard-bridge daemon. Powers the
-- /equity timeline page (Phase 6) and lets post-close journal attribute
-- equity moves to specific trades.

CREATE TABLE "EquitySnapshot" (
  "id"              TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "brokerAccountId" TEXT NOT NULL,
  "snapshotDate"    DATE NOT NULL,
  "capturedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  "totalAssets"     DECIMAL(18, 4) NOT NULL,
  "cash"            DECIMAL(18, 4) NOT NULL,
  "marketVal"       DECIMAL(18, 4) NOT NULL,
  "unrealizedPl"    DECIMAL(18, 4),
  "realizedPlDay"   DECIMAL(18, 4),
  "equityPctChange" DECIMAL(8, 4),
  "currencyCode"    TEXT NOT NULL DEFAULT 'USD',

  "source"          TEXT NOT NULL DEFAULT 'moomoo',

  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EquitySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EquitySnapshot_userId_brokerAccountId_snapshotDate_key"
  ON "EquitySnapshot" ("userId", "brokerAccountId", "snapshotDate");
CREATE INDEX "EquitySnapshot_userId_snapshotDate_idx"
  ON "EquitySnapshot" ("userId", "snapshotDate" DESC);
CREATE INDEX "EquitySnapshot_brokerAccountId_snapshotDate_idx"
  ON "EquitySnapshot" ("brokerAccountId", "snapshotDate" DESC);

ALTER TABLE "EquitySnapshot"
  ADD CONSTRAINT "EquitySnapshot_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
