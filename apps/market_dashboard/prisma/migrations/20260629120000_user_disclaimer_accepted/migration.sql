-- Client-beta Phase 0.3: record disclaimer acceptance per user.
ALTER TABLE "User" ADD COLUMN "disclaimerAcceptedAt" TIMESTAMP(3);
