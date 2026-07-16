-- TradesViz-platform P3: persisted AI-coach insights over the user's journal.
CREATE TABLE "CoachInsight" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'performance',
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "evidence" JSONB,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CoachInsight_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CoachInsight_userId_createdAt_idx" ON "CoachInsight"("userId", "createdAt" DESC);
ALTER TABLE "CoachInsight" ADD CONSTRAINT "CoachInsight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
