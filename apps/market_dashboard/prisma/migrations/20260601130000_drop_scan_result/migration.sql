-- DB cleanup: drop the unused ScanResult table.
--
-- ScanResult was scaffolded for the multi-agent scanner UI (ROADMAP Feature 4),
-- which was never wired. No code references it (no `prisma.scanResult` accessor
-- anywhere in src), and it carried an `expiresAt` — it was an ephemeral per-user
-- signal cache, so no durable data is lost. Its only relation was User.scanResults.
--
-- Destructive: this drops the table on `prisma migrate deploy`. If you want to
-- keep it, delete this migration folder before deploying.

DROP TABLE IF EXISTS "ScanResult";
