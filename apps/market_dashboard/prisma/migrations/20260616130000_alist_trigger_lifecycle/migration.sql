-- R3.2: entry-trigger lifecycle on A-list candidates + volume/RVOL on the
-- daily track. Additive + nullable (back-compatible). `prisma migrate deploy`.
ALTER TABLE "AListCandidate" ADD COLUMN "triggerState" TEXT;
ALTER TABLE "AListCandidate" ADD COLUMN "triggerStateAt" TIMESTAMP(3);
ALTER TABLE "AListCandidate" ADD COLUMN "triggerReason" TEXT;

ALTER TABLE "PositionDailyTrack" ADD COLUMN "volume" BIGINT;
ALTER TABLE "PositionDailyTrack" ADD COLUMN "rvol" DECIMAL(6,2);
