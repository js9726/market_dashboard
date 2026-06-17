-- R4: multi-agent Conviction verdict on triggered A-list picks.
-- Additive + nullable (back-compatible). `prisma migrate deploy`.
ALTER TABLE "AListCandidate" ADD COLUMN "agentConviction" JSONB;
ALTER TABLE "AListCandidate" ADD COLUMN "agentVerdict" TEXT;
ALTER TABLE "AListCandidate" ADD COLUMN "agentConvictionAt" TIMESTAMP(3);
