-- Currency-truth migration (2026-06): report all P&L in USD.
-- Additive + back-compatible. Apply with `prisma migrate deploy`.

-- ── TradeRecord (maps to "Trade") — currency normalization fields ───────────
ALTER TABLE "Trade" ADD COLUMN "currencyCode" TEXT;
ALTER TABLE "Trade" ADD COLUMN "pnlUsd" DECIMAL(12,2);
ALTER TABLE "Trade" ADD COLUMN "fxRate" DECIMAL(12,6);
ALTER TABLE "Trade" ADD COLUMN "pnlSource" TEXT;

-- ── SpreadsheetConnection — single fixed sheet USD→base rate ────────────────
ALTER TABLE "SpreadsheetConnection" ADD COLUMN "fixedFxRate" DECIMAL(12,6);

-- ── JournalPref — daily-journal automation prefs (per-user singleton) ───────
CREATE TABLE "JournalPref" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dailyDocUrl" TEXT,
    "widgetPrefs" JSONB NOT NULL DEFAULT '{}',
    "defaultTemplate" TEXT,
    "autoWrite" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JournalPref_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JournalPref_userId_key" ON "JournalPref"("userId");

ALTER TABLE "JournalPref" ADD CONSTRAINT "JournalPref_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
