-- Phase 5 of pre-open CI + journal revamp plan
-- (see apps/market_dashboard/docs/PLAN-pre-open-ci-and-journal-revamp.md).
--
-- BriefSnapshot: immutable frozen copy of a morning brief, referenced by
-- JournalEntry and AListCandidate as historical context. Distinct from
-- MorningBriefCache (which is the live overwritable cache).

CREATE TABLE "BriefSnapshot" (
  "id"             TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "bucketAt"       TIMESTAMP(3) NOT NULL,
  "provider"       TEXT NOT NULL,
  "structuredJson" JSONB NOT NULL,
  "generatedBy"    TEXT NOT NULL,
  "capturedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BriefSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BriefSnapshot_userId_bucketAt_provider_key"
  ON "BriefSnapshot" ("userId", "bucketAt", "provider");
CREATE INDEX "BriefSnapshot_userId_bucketAt_idx"
  ON "BriefSnapshot" ("userId", "bucketAt" DESC);
CREATE INDEX "BriefSnapshot_provider_bucketAt_idx"
  ON "BriefSnapshot" ("provider", "bucketAt" DESC);

ALTER TABLE "BriefSnapshot"
  ADD CONSTRAINT "BriefSnapshot_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
