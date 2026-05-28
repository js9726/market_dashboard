-- Fix for the silent migration edit issue: 20260528120000_a_list_candidates
-- was applied to prod with the original schema (operatorLabel-only). Phase 2
-- edited that migration file in place to add userId + source + FK, but
-- `prisma migrate deploy` doesn't re-apply already-applied migrations.
-- Prod has been throwing P2022 "AListCandidate.userId does not exist"
-- since the Phase 2 deploy.
--
-- This corrective migration brings prod up to current schema without losing
-- any data (table is empty in prod anyway — no successful pre-open since
-- Phase 1 landed).

-- Add userId column (nullable first, so existing rows survive if any)
ALTER TABLE "AListCandidate" ADD COLUMN IF NOT EXISTS "userId" TEXT;

-- Add source column (AUTO|MANUAL)
ALTER TABLE "AListCandidate" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'AUTO';

-- Backfill userId for any existing rows: assign to the earliest owner-role user.
-- This is safe because (a) AListCandidate is currently empty in prod, and
-- (b) even if non-empty, ownership flowed from operatorLabel='JS' which
-- corresponds to the only owner user.
UPDATE "AListCandidate" SET "userId" = (
  SELECT "id" FROM "User"
  WHERE "role" = 'owner'
  ORDER BY "createdAt" ASC
  LIMIT 1
) WHERE "userId" IS NULL;

-- Drop the old unique constraint + indexes that referenced operatorLabel
DROP INDEX IF EXISTS "AListCandidate_operatorLabel_pickDate_ticker_key";
DROP INDEX IF EXISTS "AListCandidate_operatorLabel_pickDate_idx";

-- Now make userId NOT NULL
ALTER TABLE "AListCandidate" ALTER COLUMN "userId" SET NOT NULL;

-- Add the new unique constraint + indexes keyed on userId
CREATE UNIQUE INDEX IF NOT EXISTS "AListCandidate_userId_pickDate_ticker_key"
  ON "AListCandidate" ("userId", "pickDate", "ticker");
CREATE INDEX IF NOT EXISTS "AListCandidate_userId_pickDate_idx"
  ON "AListCandidate" ("userId", "pickDate" DESC);

-- Add the FK to User
ALTER TABLE "AListCandidate"
  ADD CONSTRAINT "AListCandidate_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
