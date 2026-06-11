/**
 * trade-reconciler.ts — fill→trade close reconciliation.
 *
 * TradeFill is the immutable broker audit log; TradeRecord is the journal
 * lifecycle row. Until 2026-06 nothing connected them: when a position was
 * sold, the Position row vanished (bridge replaces the snapshot) but the open
 * TradeRecord stayed OPEN forever (MCHP, 2026-06-05) and fills kept
 * tradeRecordId = null.
 *
 * For every CLOSED episode (flat → position → flat, per broker account and
 * ticker) this module:
 *   1. finds the canonical TradeRecord (user-authored sheet/manual row wins;
 *      bridge row second; creates one when none exists),
 *   2. closes it with broker-true figures (avg entry/exit, fees, realized
 *      USD P&L) and links the episode's fills to it,
 *   3. merges away auto-created bridge stopgap rows ("position:<ticker>")
 *      that duplicate the canonical row — re-pointing verdict history and the
 *      per-trade JournalEntry before deleting.
 *
 * Invoked from /api/bridge/sync after each fill batch and from
 * /api/cron/reconcile-trades (repair + nightly backstop, supports dry-run).
 * Pure episode/matching math lives in lib/trade-episodes.ts.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  buildEpisodes,
  inWindow,
  isStopgap,
  pickCanonical,
  plainTicker,
  type CanonicalCandidate,
  type FillLike,
} from "@/lib/trade-episodes";

export interface ReconcileReport {
  dryRun: boolean;
  accounts: number;
  episodesClosed: number;
  recordsClosed: number;
  recordsCreated: number;
  fillsLinked: number;
  duplicatesDeleted: number;
  verdictsMoved: number;
  conflicts: string[];
  actions: string[];
  staleOpenAfter: string[];
}

export async function reconcileBrokerTrades(opts: {
  userId?: string;
  brokerAccountId?: string;
  dryRun?: boolean;
}): Promise<ReconcileReport> {
  const dryRun = opts.dryRun ?? false;
  const report: ReconcileReport = {
    dryRun,
    accounts: 0,
    episodesClosed: 0,
    recordsClosed: 0,
    recordsCreated: 0,
    fillsLinked: 0,
    duplicatesDeleted: 0,
    verdictsMoved: 0,
    conflicts: [],
    actions: [],
    staleOpenAfter: [],
  };

  const accounts = await prisma.userBrokerAccount.findMany({
    where: {
      ...(opts.brokerAccountId ? { id: opts.brokerAccountId } : {}),
      ...(opts.userId ? { userId: opts.userId } : {}),
      isActive: true,
    },
    select: { id: true, userId: true, alias: true },
  });
  report.accounts = accounts.length;

  for (const account of accounts) {
    const rawFills = await prisma.tradeFill.findMany({
      where: { brokerAccountId: account.id },
      orderBy: { executedAt: "asc" },
      select: {
        id: true, ticker: true, side: true, qty: true, price: true,
        fees: true, currency: true, executedAt: true, tradeRecordId: true,
      },
    });

    const byTicker = new Map<string, FillLike[]>();
    for (const f of rawFills) {
      const fill: FillLike = {
        id: f.id,
        ticker: f.ticker,
        side: f.side,
        qty: Number(f.qty),
        price: Number(f.price),
        fees: f.fees == null ? null : Number(f.fees),
        currency: f.currency,
        executedAt: f.executedAt,
        tradeRecordId: f.tradeRecordId,
      };
      const key = plainTicker(f.ticker);
      const arr = byTicker.get(key) ?? [];
      arr.push(fill);
      byTicker.set(key, arr);
    }

    const usedRecordIds = new Set<string>();

    for (const [ticker, fills] of Array.from(byTicker.entries())) {
      const episodes = buildEpisodes(fills).filter((e) => e.closedAt != null);
      if (episodes.length === 0) continue;

      const rawCandidates = await prisma.tradeRecord.findMany({
        where: { userId: account.userId, ticker },
        select: {
          id: true, ticker: true, state: true, source: true, notes: true,
          connectionId: true, brokerOrderId: true, quantity: true,
          tradeDate: true, executedAt: true, platform: true, verdict: true,
        },
      });
      const candidates: CanonicalCandidate[] = rawCandidates.map((r) => ({
        id: r.id,
        ticker: r.ticker,
        state: r.state,
        source: r.source,
        notes: r.notes,
        connectionId: r.connectionId,
        brokerOrderId: r.brokerOrderId,
        quantity: r.quantity == null ? null : Number(r.quantity),
        tradeDate: r.tradeDate,
        executedAt: r.executedAt,
        platform: r.platform,
        hasVerdict: r.verdict != null,
      }));

      for (const ep of episodes) {
        report.episodesClosed++;

        const available = candidates.filter((r) => !usedRecordIds.has(r.id));
        const canonical = pickCanonical(available, ep);

        // Already fully reconciled in an earlier run?
        const epFills = fills.filter((f) => ep.fillIds.includes(f.id));
        if (
          canonical != null &&
          canonical.state === "CLOSE" &&
          epFills.every((f) => f.tradeRecordId === canonical.id)
        ) {
          usedRecordIds.add(canonical.id);
          continue;
        }

        let canonicalId = canonical?.id ?? null;

        const closeData = {
          state: "CLOSE",
          buyPrice: new Prisma.Decimal(ep.avgBuy.toFixed(4)),
          quantity: new Prisma.Decimal(ep.buyQty.toFixed(2)),
          exitPrice: new Prisma.Decimal(ep.avgSell.toFixed(4)),
          fees: new Prisma.Decimal(ep.fees.toFixed(2)),
          executedAt: ep.closedAt,
          brokerAccountId: account.id,
          ...(ep.usdSafe && ep.realized != null
            ? {
                pnlUsd: new Prisma.Decimal(ep.realized.toFixed(2)),
                currencyCode: "USD",
                pnlSource: "broker",
              }
            : {}),
        };

        if (canonical) {
          usedRecordIds.add(canonical.id);
          report.recordsClosed++;
          report.actions.push(
            `${dryRun ? "[dry] " : ""}close ${ticker} → ${canonical.id} (${canonical.source}) ` +
              `entry ${ep.avgBuy.toFixed(2)} exit ${ep.avgSell.toFixed(2)} pnl ` +
              `${ep.realized?.toFixed(2)}${ep.usdSafe ? " USD" : " (non-USD, pnlUsd skipped)"}`,
          );
          if (!dryRun) {
            await prisma.tradeRecord.update({
              where: { id: canonical.id },
              data: {
                ...closeData,
                tradeDate: canonical.tradeDate ?? ep.openedAt,
                platform: canonical.platform ?? account.alias,
                // Non-sheet rows have no MYR sheet P&L to preserve.
                ...(canonical.source !== "SHEET" && ep.usdSafe && ep.realized != null
                  ? { pnl: new Prisma.Decimal(ep.realized.toFixed(2)) }
                  : {}),
              },
            });
          }
        } else {
          report.recordsCreated++;
          report.actions.push(
            `${dryRun ? "[dry] " : ""}create CLOSE ${ticker} (no matching journal row) ` +
              `entry ${ep.avgBuy.toFixed(2)} exit ${ep.avgSell.toFixed(2)}`,
          );
          if (!dryRun) {
            const created = await prisma.tradeRecord.create({
              data: {
                userId: account.userId,
                source: "BRIDGE",
                brokerOrderId: `episode:${ticker}:${ep.fillIds[0]}`,
                ticker,
                side: "Long",
                tradeDate: ep.openedAt,
                platform: account.alias,
                rawRow: {},
                ...closeData,
                ...(ep.usdSafe && ep.realized != null
                  ? { pnl: new Prisma.Decimal(ep.realized.toFixed(2)) }
                  : {}),
              },
              select: { id: true },
            });
            canonicalId = created.id;
          }
        }

        if (!dryRun && canonicalId) {
          const linked = await prisma.tradeFill.updateMany({
            where: { id: { in: ep.fillIds } },
            data: { tradeRecordId: canonicalId },
          });
          report.fillsLinked += linked.count;
        } else {
          report.fillsLinked += ep.fillIds.length;
        }

        // ── Merge away auto-created stopgap duplicates ──────────────────────
        const stopgaps = available.filter(
          (r) => r.id !== canonicalId && isStopgap(r) && inWindow(r, ep),
        );
        for (const dup of stopgaps) {
          usedRecordIds.add(dup.id);
          const dupEntry = await prisma.journalEntry.findUnique({
            where: { tradeRecordId: dup.id },
            select: { id: true },
          });
          const canonicalHasEntry = canonicalId
            ? (await prisma.journalEntry.findUnique({
                where: { tradeRecordId: canonicalId },
                select: { id: true },
              })) != null
            : false;

          if (dupEntry && canonicalHasEntry) {
            report.conflicts.push(
              `both ${dup.id} (stopgap) and ${canonicalId} have a JournalEntry — stopgap kept, marked CLOSE`,
            );
            if (!dryRun) {
              await prisma.tradeRecord.update({ where: { id: dup.id }, data: closeData });
            }
            continue;
          }

          report.duplicatesDeleted++;
          report.actions.push(
            `${dryRun ? "[dry] " : ""}merge+delete stopgap ${dup.id} (${dup.brokerOrderId}) into ${canonicalId}`,
          );
          if (!dryRun && canonicalId) {
            const moved = await prisma.tradeVerdictHistory.updateMany({
              where: { tradeId: dup.id },
              data: { tradeId: canonicalId },
            });
            report.verdictsMoved += moved.count;
            if (dupEntry && !canonicalHasEntry) {
              await prisma.journalEntry.update({
                where: { id: dupEntry.id },
                data: { tradeRecordId: canonicalId },
              });
            }
            if (dup.hasVerdict && canonical && !canonical.hasVerdict) {
              const dupFull = await prisma.tradeRecord.findUnique({
                where: { id: dup.id },
                select: { verdict: true, verdictScore: true, verdictGeneratedAt: true },
              });
              if (dupFull?.verdict != null) {
                await prisma.tradeRecord.update({
                  where: { id: canonicalId },
                  data: {
                    verdict: dupFull.verdict as Prisma.InputJsonValue,
                    verdictScore: dupFull.verdictScore,
                    verdictGeneratedAt: dupFull.verdictGeneratedAt,
                  },
                });
              }
            }
            await prisma.tradeRecord.delete({ where: { id: dup.id } });
          }
        }
      }
    }
  }

  // ── Health check: open-ish broker-linked rows with no live position ──────
  const openish = await prisma.tradeRecord.findMany({
    where: {
      ...(opts.userId ? { userId: opts.userId } : {}),
      brokerAccountId: { not: null },
      OR: [{ state: { in: ["OPEN", "SEMI-OPEN"] } }, { state: null, pnl: null }],
    },
    select: { ticker: true, brokerAccountId: true },
  });
  const positions = await prisma.position.findMany({
    select: { ticker: true, brokerAccountId: true },
  });
  const posKeys = new Set(positions.map((p) => `${plainTicker(p.ticker)}|${p.brokerAccountId}`));
  report.staleOpenAfter = openish
    .filter((t) => !posKeys.has(`${plainTicker(t.ticker)}|${t.brokerAccountId}`))
    .map((t) => t.ticker);

  return report;
}
