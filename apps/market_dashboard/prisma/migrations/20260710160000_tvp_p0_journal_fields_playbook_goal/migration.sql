-- TradesViz-platform P0: journal enrichment fields + Playbook/Goal shells.
-- NOTE: TradeRecord maps to the legacy "Trade" table (@@map).
ALTER TABLE "Trade" ADD COLUMN "tags" JSONB;
ALTER TABLE "Trade" ADD COLUMN "screenshots" JSONB;
ALTER TABLE "Trade" ADD COLUMN "mistakes" JSONB;

CREATE TABLE "Playbook" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "setupClass" TEXT,
    "rules" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Playbook_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Playbook_userId_archived_idx" ON "Playbook"("userId", "archived");
ALTER TABLE "Playbook" ADD CONSTRAINT "Playbook_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "target" DECIMAL(14,2),
    "unit" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Goal_userId_active_idx" ON "Goal"("userId", "active");
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
