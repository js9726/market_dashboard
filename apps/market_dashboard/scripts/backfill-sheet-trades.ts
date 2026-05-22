/**
 * One-shot backfill: bring legacy sheet-synced Trade rows into the new
 * multi-broker shape.
 *
 * Run with:
 *   npx tsx scripts/backfill-sheet-trades.ts
 *
 * What it does:
 *   - For every TradeRecord with source != 'SHEET' yet connectionId IS NOT NULL
 *     (i.e. came from Google Sheet sync before the multi-broker migration):
 *     explicitly set source='SHEET' so the new APIs/UI count it correctly.
 *   - Backfill executedAt from tradeDate (set to 09:30 ET if no time recorded).
 *   - Leave brokerAccountId NULL — sheet trades don't know which broker, and
 *     the owner can manually associate them later via /api/broker-accounts.
 *
 * Idempotent: only updates rows that need updating.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const candidates = await prisma.tradeRecord.findMany({
    where: {
      // Find sheet-linked rows that haven't been explicitly tagged + need executedAt
      connectionId: { not: null },
      OR: [
        { source: { not: "SHEET" } },
        { executedAt: null },
      ],
    },
    select: { id: true, source: true, tradeDate: true, executedAt: true },
  });

  console.log(`Found ${candidates.length} candidate rows`);

  let updated = 0;
  for (const t of candidates) {
    // Default executedAt: tradeDate at 09:30 ET (= 13:30 UTC roughly; we use 13:30 UTC
    // as a stable placeholder since we don't have actual fill timestamps from the sheet).
    let executedAt = t.executedAt;
    if (executedAt == null && t.tradeDate) {
      const d = new Date(t.tradeDate);
      d.setUTCHours(13, 30, 0, 0);
      executedAt = d;
    }

    await prisma.tradeRecord.update({
      where: { id: t.id },
      data: {
        source: "SHEET",
        executedAt: executedAt ?? undefined,
      },
    });
    updated++;
  }

  console.log(`Updated ${updated} rows.`);
}

main()
  .catch((e) => {
    console.error("[backfill-sheet-trades] failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
