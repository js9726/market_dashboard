/**
 * alist-held-sync.ts — seed/refresh HELD rows on the merged A-List from the
 * owner's live positions. UNGATED: every real position becomes a tracked row
 * (the score>=80/GO/RVOL>=1.5 bar only gates the REC badge). A position that
 * matches a REC pick within 7 days is linked in-place (on-book); otherwise a new
 * off-book HELD row is created. Market-data fields (ATR 1R, path, savings) are
 * filled later by /api/cron/track-positions.
 *
 * See the 2026-05-30 conviction-redesign decisions.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toYahooSymbol } from "@/lib/symbol-format";
import { gradeEntryVsBar } from "@/server/alist-metrics";

const MATCH_WINDOW_DAYS = 7;

export interface HeldSyncResult {
  created: number;
  linked: number;
  skipped: number;
  tickers: string[];
}

function utcDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function syncHeldPositions(userId: string): Promise<HeldSyncResult> {
  const positions = await prisma.position.findMany({
    where: { brokerAccount: { userId } },
    orderBy: { openedAt: "asc" },
  });

  let created = 0;
  let linked = 0;
  let skipped = 0;
  const tickers: string[] = [];

  for (const p of positions) {
    const ticker = toYahooSymbol(p.ticker).toUpperCase();
    const qty = Number(p.qty);
    const avgCost = Number(p.avgCost);
    if (!ticker || !(qty > 0) || !(avgCost > 0)) {
      skipped++;
      continue;
    }

    const entryAt = p.openedAt ?? p.lastFillAt ?? new Date();
    const entryDate = utcDateOnly(entryAt);

    // Match a REC pick within the window → on-book. REC = not-yet-held candidate.
    const windowStart = new Date(entryDate);
    windowStart.setUTCDate(windowStart.getUTCDate() - MATCH_WINDOW_DAYS);
    const rec = await prisma.aListCandidate.findFirst({
      where: { userId, ticker, isHeld: false, pickDate: { gte: windowStart, lte: entryDate } },
      orderBy: { pickDate: "desc" },
    });

    const grade = gradeEntryVsBar({
      score: rec?.day0Score ?? null,
      verdict: rec?.day0Verdict ?? null,
      rvol: rec?.day0Rvol != null ? Number(rec.day0Rvol) : null,
    });
    const entryGradeJson: Prisma.InputJsonValue = {
      score: rec?.day0Score ?? null,
      rvol: rec?.day0Rvol != null ? Number(rec.day0Rvol) : null,
      verdict: rec?.day0Verdict ?? null,
      setup: rec?.setupClassification ?? null,
      passedBar: grade.passedBar,
      reasons: grade.reasons,
      source: rec ? "REC" : "PENDING",
    };

    const heldData = {
      isHeld: true,
      heldPositionId: p.id,
      entryFillAt: entryAt,
      entryAvgCost: new Prisma.Decimal(avgCost),
      heldQty: new Prisma.Decimal(qty),
      onBook: Boolean(rec),
      entryGrade: grade.grade,
      entryGradeJson,
    };

    // Already linked to this exact position?
    const existingHeld = await prisma.aListCandidate.findFirst({
      where: { userId, heldPositionId: p.id },
      select: { id: true },
    });

    if (existingHeld) {
      await prisma.aListCandidate.update({ where: { id: existingHeld.id }, data: heldData });
      linked++;
    } else if (rec) {
      // On-book: enrich the REC row in place so it's ONE merged row (REC+HELD).
      await prisma.aListCandidate.update({ where: { id: rec.id }, data: heldData });
      linked++;
    } else {
      // Off-book: new HELD row keyed by entry date.
      await prisma.aListCandidate.upsert({
        where: { userId_pickDate_ticker: { userId, pickDate: entryDate, ticker } },
        create: {
          userId,
          operatorLabel: "JS",
          pickDate: entryDate,
          ticker,
          source: "HELD",
          status: "ACTIVE",
          ...heldData,
        },
        update: heldData,
      });
      created++;
    }
    tickers.push(ticker);
  }

  return { created, linked, skipped, tickers };
}
