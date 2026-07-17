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
import { buildEpisodes, type FillLike } from "@/lib/trade-episodes";
import { gradeEntryVsBar } from "@/server/alist-metrics";

const MATCH_WINDOW_DAYS = 7;

export interface HeldSyncResult {
  created: number;
  linked: number;
  skipped: number;
  duplicatesRemoved: number;
  tickers: string[];
}

function utcDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function sameUtcDay(a: Date | null, b: Date): boolean {
  return a != null && utcDateOnly(a).getTime() === utcDateOnly(b).getTime();
}

function closeEnough(a: Prisma.Decimal | null, b: number, tolerance: number): boolean {
  return a != null && Math.abs(Number(a) - b) <= tolerance;
}

export async function syncHeldPositions(userId: string): Promise<HeldSyncResult> {
  const positions = await prisma.position.findMany({
    // isLive: the HELD lane mirrors the REAL book only (2026-05-30 locked
    // decision: A-list = bought positions). Paper/simulated accounts (e.g. the
    // moomoo SIMULATE forward-validation account, 2026-07-16) must never mint
    // HELD rows or the validation experiment contaminates the real ledger.
    where: { brokerAccount: { userId, isLive: true } },
    orderBy: { openedAt: "asc" },
  });
  const accountIds = Array.from(new Set(positions.map((position) => position.brokerAccountId)));
  const positionTickers = Array.from(new Set(positions.map((position) => position.ticker)));
  const fills = positions.length
    ? await prisma.tradeFill.findMany({
        where: {
          brokerAccountId: { in: accountIds },
          ticker: { in: positionTickers },
        },
        select: {
          id: true,
          brokerAccountId: true,
          ticker: true,
          side: true,
          qty: true,
          price: true,
          fees: true,
          currency: true,
          executedAt: true,
          tradeRecordId: true,
        },
        orderBy: { executedAt: "asc" },
      })
    : [];
  const fillsByPosition = new Map<string, FillLike[]>();
  for (const fill of fills) {
    const key = `${fill.brokerAccountId}|${fill.ticker}`;
    const bucket = fillsByPosition.get(key) ?? [];
    bucket.push({
      id: fill.id,
      ticker: fill.ticker,
      side: fill.side,
      qty: Number(fill.qty),
      price: Number(fill.price),
      fees: fill.fees == null ? null : Number(fill.fees),
      currency: fill.currency,
      executedAt: fill.executedAt,
      tradeRecordId: fill.tradeRecordId,
    });
    fillsByPosition.set(key, bucket);
  }

  let created = 0;
  let linked = 0;
  let skipped = 0;
  let duplicatesRemoved = 0;
  const tickers: string[] = [];

  for (const p of positions) {
    const ticker = toYahooSymbol(p.ticker).toUpperCase();
    const qty = Number(p.qty);
    const avgCost = Number(p.avgCost);
    if (!ticker || !(qty > 0) || !(avgCost > 0)) {
      skipped++;
      continue;
    }

    const positionFills = fillsByPosition.get(`${p.brokerAccountId}|${p.ticker}`) ?? [];
    const episodes = buildEpisodes(positionFills);
    const trailingEpisode = episodes[episodes.length - 1];
    const openEpisode = trailingEpisode && trailingEpisode.closedAt == null ? trailingEpisode : null;
    const episodeQty = openEpisode ? openEpisode.buyQty - openEpisode.sellQty : null;
    const episodeMatchesPosition =
      openEpisode != null &&
      episodeQty != null &&
      Math.abs(episodeQty - qty) <= Math.max(0.0001, qty * 0.001);
    // Position snapshots can be deleted/recreated by the bridge, which resets
    // openedAt. The immutable fill episode is the stable entry identity.
    const entryAt = episodeMatchesPosition ? openEpisode.openedAt : p.openedAt;
    const entryDate = utcDateOnly(entryAt);

    const activeHeld = await prisma.aListCandidate.findMany({
      where: { userId, ticker, isHeld: true, status: "ACTIVE" },
      orderBy: { pickDate: "asc" },
    });
    const existingHeld =
      activeHeld.find((row) => sameUtcDay(row.entryFillAt ?? row.pickDate, entryAt)) ??
      activeHeld.find((row) => row.heldPositionId === p.id) ??
      null;

    // Match a REC pick within the window → on-book. REC = not-yet-held candidate.
    const windowStart = new Date(entryDate);
    windowStart.setUTCDate(windowStart.getUTCDate() - MATCH_WINDOW_DAYS);
    const rec = existingHeld
      ? null
      : await prisma.aListCandidate.findFirst({
          where: { userId, ticker, isHeld: false, pickDate: { gte: windowStart, lte: entryDate } },
          orderBy: { pickDate: "desc" },
        });
    const entryContext = rec ?? existingHeld;

    const grade = gradeEntryVsBar({
      score: entryContext?.day0Score ?? null,
      verdict: entryContext?.day0Verdict ?? null,
      rvol: entryContext?.day0Rvol != null ? Number(entryContext.day0Rvol) : null,
      setup: entryContext?.setupClassification ?? null,
    });
    const onBook = Boolean(rec) || existingHeld?.onBook === true;
    const entryGradeJson: Prisma.InputJsonValue = {
      score: entryContext?.day0Score ?? null,
      rvol: entryContext?.day0Rvol != null ? Number(entryContext.day0Rvol) : null,
      verdict: entryContext?.day0Verdict ?? null,
      setup: entryContext?.setupClassification ?? null,
      passedBar: grade.passedBar,
      reasons: grade.reasons,
      source: onBook ? "REC" : "OFF-BOOK",
    };

    const heldData = {
      isHeld: true,
      heldPositionId: p.id,
      entryFillAt: entryAt,
      entryAvgCost: new Prisma.Decimal(avgCost),
      heldQty: new Prisma.Decimal(qty),
      onBook,
      entryGrade: grade.grade,
      entryGradeJson,
    };

    let canonicalId: string;
    if (existingHeld) {
      await prisma.aListCandidate.update({ where: { id: existingHeld.id }, data: heldData });
      canonicalId = existingHeld.id;
      linked++;
    } else if (rec) {
      // On-book: enrich the REC row in place so it's ONE merged row (REC+HELD).
      await prisma.aListCandidate.update({ where: { id: rec.id }, data: heldData });
      canonicalId = rec.id;
      linked++;
    } else {
      // Off-book: new HELD row keyed by entry date.
      const row = await prisma.aListCandidate.upsert({
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
      canonicalId = row.id;
      created++;
    }

    // A recreated Position used to mint another HELD row with a later fake
    // entry date. Remove only generated off-book duplicates that describe the
    // same still-open quantity/cost after the fill-proven episode start.
    for (const duplicate of activeHeld) {
      if (duplicate.id === canonicalId) continue;
      const duplicateEntry = duplicate.entryFillAt ?? duplicate.pickDate;
      const safeGeneratedDuplicate =
        duplicate.source === "HELD" &&
        duplicate.onBook !== true &&
        duplicate.day14ComputedAt == null &&
        duplicate.convertedTradeId == null &&
        duplicateEntry.getTime() > entryAt.getTime() &&
        closeEnough(duplicate.entryAvgCost, avgCost, 0.01) &&
        closeEnough(duplicate.heldQty, qty, Math.max(0.0001, qty * 0.001));
      if (!safeGeneratedDuplicate) continue;
      await prisma.aListCandidate.delete({ where: { id: duplicate.id } });
      duplicatesRemoved++;
    }
    tickers.push(ticker);
  }

  return { created, linked, skipped, duplicatesRemoved, tickers };
}
