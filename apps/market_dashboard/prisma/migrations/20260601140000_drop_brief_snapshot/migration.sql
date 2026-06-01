-- DB cleanup: drop the unused BriefSnapshot table.
--
-- BriefSnapshot was scaffolded (Phase 5) as an immutable frozen-brief reference
-- for the journal/A-list, but was never wired (no `prisma.briefSnapshot` accessor
-- anywhere). The A-list instead keeps denormalised day0Brief* fields, and the
-- live brief lives in MorningBriefCache, so this table is redundant. Its only
-- relation was User.briefSnapshots.
--
-- Destructive: drops the table on `prisma migrate deploy`. Delete this migration
-- folder before deploying if you want to keep it.

DROP TABLE IF EXISTS "BriefSnapshot";
