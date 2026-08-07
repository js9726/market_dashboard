-- Canonical structured session journal and explicitly governed rule registry.
CREATE TABLE "TradingJournalSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionDate" DATE NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "ownerProvider" TEXT NOT NULL,
    "ownerVerdict" TEXT NOT NULL,
    "validatorProvider" TEXT,
    "validatorStatus" TEXT,
    "payload" JSONB NOT NULL,
    "renderedMarkdown" TEXT NOT NULL,
    "riskBlocked" BOOLEAN NOT NULL DEFAULT false,
    "docSyncStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "docSyncedAt" TIMESTAMP(3),
    "docSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TradingJournalSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TradingRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "sourceRefs" TEXT[],
    "approvedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TradingRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TradingJournalThought" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionDate" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "externalMessageId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TradingJournalThought_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TradingJournalSession_userId_sessionDate_key" ON "TradingJournalSession"("userId", "sessionDate");
CREATE INDEX "TradingJournalSession_userId_sessionDate_idx" ON "TradingJournalSession"("userId", "sessionDate" DESC);
CREATE INDEX "TradingJournalSession_docSyncStatus_updatedAt_idx" ON "TradingJournalSession"("docSyncStatus", "updatedAt" DESC);
CREATE UNIQUE INDEX "TradingRule_userId_ruleKey_key" ON "TradingRule"("userId", "ruleKey");
CREATE INDEX "TradingRule_userId_stage_status_idx" ON "TradingRule"("userId", "stage", "status");
CREATE UNIQUE INDEX "TradingJournalThought_externalMessageId_key" ON "TradingJournalThought"("externalMessageId");
CREATE INDEX "TradingJournalThought_userId_sessionDate_idx" ON "TradingJournalThought"("userId", "sessionDate" DESC);

ALTER TABLE "TradingJournalSession" ADD CONSTRAINT "TradingJournalSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TradingRule" ADD CONSTRAINT "TradingRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TradingJournalThought" ADD CONSTRAINT "TradingJournalThought_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
