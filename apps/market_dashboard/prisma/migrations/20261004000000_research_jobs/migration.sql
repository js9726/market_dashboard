-- CreateTable
CREATE TABLE "ResearchThread" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "horizon" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "previousResultId" TEXT,
    "sessionId" TEXT,
    "sessionProvider" TEXT,
    "promptVersion" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "horizon" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "operatorLabel" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "contextJson" JSONB,
    "resultJson" JSONB,
    "verdictId" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResearchThread_userId_updatedAt_idx" ON "ResearchThread"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ResearchJob_userId_createdAt_idx" ON "ResearchJob"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchJob_status_leaseExpiresAt_createdAt_idx" ON "ResearchJob"("status", "leaseExpiresAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchJob_userId_requestKey_key" ON "ResearchJob"("userId", "requestKey");

-- AddForeignKey
ALTER TABLE "ResearchThread" ADD CONSTRAINT "ResearchThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchJob" ADD CONSTRAINT "ResearchJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchJob" ADD CONSTRAINT "ResearchJob_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ResearchThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
