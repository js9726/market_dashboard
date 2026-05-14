-- Add structuredJson column to MorningBriefCache.
-- The UI now renders this directly as native dashboard cards (no HTML injection).
-- htmlBody stays for backwards compat but is empty for new rows.

ALTER TABLE "MorningBriefCache"
  ADD COLUMN "structuredJson" JSONB;
