-- R3.1: store the Conviction breakdown on each A-list candidate.
-- Additive + nullable (back-compatible, no lock). Apply with `prisma migrate deploy`.
ALTER TABLE "AListCandidate" ADD COLUMN "setupScore" INTEGER;
ALTER TABLE "AListCandidate" ADD COLUMN "entryScore" INTEGER;
ALTER TABLE "AListCandidate" ADD COLUMN "themeScore" INTEGER;
ALTER TABLE "AListCandidate" ADD COLUMN "sentimentScore" INTEGER;
ALTER TABLE "AListCandidate" ADD COLUMN "championPersona" TEXT;
