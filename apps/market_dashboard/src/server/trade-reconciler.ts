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
  buildSellOnlyClosure,
  inWindow,
  isStopgap,
  pickAuthoredRecordForStopgap,
  pickCanonical,
  plainTicker,
  type CanonicalCandidate,
  type FillLike,
} from "@/lib/trade-episodes";
import { brokerKey } from "@/lib/broker-normalization";

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
    const livePositions = await prisma.position.findMany({
      where: { brokerAccountId: account.id },
      select: { ticker: true, qty: true },
    });
    const livePositionTickers = new Set(livePositions.map((position) => plainTicker(position.ticker)));
    const livePositionByTicker = new Map(livePositions.map((position) => [
      plainTicker(position.ticker),
      { ticker: position.ticker, qty: Number(position.qty) },
    ]));

    // A position snapshot may have materialized a BRIDGE row before its sheet
    // lifecycle was synced. Remove that twin while the position is live (also
    // after a partial sale) or after the broker has gone flat. No fills needed.
    const stopgapRows = await prisma.tradeRecord.findMany({
      where: {
        userId: account.userId,
        brokerAccountId: account.id,
        source: "BRIDGE",
        brokerOrderId: { startsWith: "position:" },
      },
      select: {
        id: true, ticker: true, state: true, source: true, notes: true,
        connectionId: true, brokerOrderId: true, quantity: true, buyPrice: true,
        tradeDate: true, executedAt: true, platform: true, verdict: true,
        brokerAccountId: true,
      },
    });
    for (const rawStopgap of stopgapRows) {
      const stopgap: CanonicalCandidate = {
        ...rawStopgap,
        quantity: rawStopgap.quantity == null ? null : Number(rawStopgap.quantity),
        buyPrice: rawStopgap.buyPrice == null ? null : Number(rawStopgap.buyPrice),
        hasVerdict: rawStopgap.verdict != null,
      };
      const authoredRows = await prisma.tradeRecord.findMany({
        where: {
          userId: account.userId,
          ticker: plainTicker(stopgap.ticker),
          source: { in: ["SHEET", "MANUAL"] },
        },
        select: {
          id: true, ticker: true, state: true, source: true, notes: true,
          connectionId: true, brokerOrderId: true, quantity: true, buyPrice: true,
          tradeDate: true, executedAt: true, platform: true, verdict: true,
          brokerAccountId: true,
        },
      });
      const candidates: CanonicalCandidate[] = authoredRows
        .filter((row) =>
          row.brokerAccountId === account.id ||
          (row.brokerAccountId == null && brokerKey(row.platform) === brokerKey(account.alias))
        )
        .map((row) => ({
          ...row,
          quantity: row.quantity == null ? null : Number(row.quantity),
          buyPrice: row.buyPrice == null ? null : Number(row.buyPrice),
          hasVerdict: row.verdict != null,
        }));
      const canonical = pickAuthoredRecordForStopgap(
        candidates,
        stopgap,
        livePositionByTicker.get(plainTicker(stopgap.ticker)) ?? null,
      );
      if (!canonical) continue;

      const [stopgapDetails, canonicalEntry] = await Promise.all([
        prisma.tradeRecord.findUnique({
          where: { id: stopgap.id },
          select: {
            verdict: true, verdictScore: true, verdictGeneratedAt: true,
            journalEntry: { select: { id: true } },
          },
        }),
        prisma.journalEntry.findUnique({ where: { tradeRecordId: canonical.id }, select: { id: true } }),
      ]);
      if (stopgapDetails?.journalEntry && canonicalEntry) {
        report.conflicts.push(`both ${stopgap.id} (stopgap) and ${canonical.id} have a JournalEntry; duplicate kept`);
        continue;
      }

      report.duplicatesDeleted++;
      report.actions.push(
        `${dryRun ? "[dry] " : ""}merge+delete ${livePositionByTicker.has(plainTicker(stopgap.ticker)) ? "live" : "stale"} ` +
        `stopgap ${stopgap.id} into ${canonical.id}`,
      );
      if (!dryRun) {
        const moved = await prisma.tradeVerdictHistory.updateMany({
          where: { tradeId: stopgap.id },
          data: { tradeId: canonical.id },
        });
        report.verdictsMoved += moved.count;
        if (stopgapDetails?.journalEntry && !canonicalEntry) {
          await prisma.journalEntry.update({
            where: { id: stopgapDetails.journalEntry.id },
            data: { tradeRecordId: canonical.id },
          });
        }
        await prisma.tradeRecord.update({
          where: { id: canonical.id },
          data: {
            brokerAccountId: account.id,
            ...(stopgapDetails?.verdict != null && !canonical.hasVerdict
              ? {
                  verdict: stopgapDetails.verdict as Prisma.InputJsonValue,
                  verdictScore: stopgapDetails.verdictScore,
                  verdictGeneratedAt: stopgapDetails.verdictGeneratedAt,
                }
              : {}),
          },
        });
        await prisma.tradeRecord.delete({ where: { id: stopgap.id } });
      }
    }
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
      const rawCandidates = await prisma.tradeRecord.findMany({
        where: { userId: account.userId, ticker },
        select: {
          id: true, ticker: true, state: true, source: true, notes: true,
          connectionId: true, brokerOrderId: true, quantity: true, buyPrice: true,
          tradeDate: true, executedAt: true, platform: true, verdict: true,
          brokerAccountId: true,
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
        buyPrice: r.buyPrice == null ? null : Number(r.buyPrice),
        tradeDate: r.tradeDate,
        executedAt: r.executedAt,
        platform: r.platform,
        brokerAccountId: r.brokerAccountId,
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
                // Free the (account, "position:<ticker>") unique slot: the
                // materializer upserts on it for every LIVE position, so a
                // re-entry would otherwise resurrect this closed row and wipe
                // its exit/P&L. Rename to the immutable episode key.
                ...(canonical.brokerOrderId?.startsWith("position:")
                  ? { brokerOrderId: `episode:${ticker}:${ep.fillIds[0]}` }
                  : {}),
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
              await prisma.tradeRecord.update({
                where: { id: dup.id },
                // Also vacate the position:* slot so the materializer can't
                // resurrect this kept duplicate on a future re-entry.
                data: { ...closeData, brokerOrderId: `episode:${ticker}:${ep.fillIds[0]}:dup` },
              });
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

      // IBKR's live socket can expose only the recent SELL executions for a
      // position opened before the session/history window. If those USD sells
      // exactly flatten a preserved journal quantity and no live position
      // remains, close the user-authored row using its cost basis. This keeps
      // broker truth durable after sheet re-syncs without inventing a BUY fill.
      if (!livePositionTickers.has(ticker) && !fills.some((fill) => fill.side.toUpperCase() === "BUY")) {
        const unlinkedSells = fills.filter(
          (fill) => fill.side.toUpperCase() === "SELL" && fill.tradeRecordId == null,
        );
        const totalSellQty = unlinkedSells.reduce((sum, fill) => sum + Math.abs(fill.qty), 0);
        const authoredMatches = candidates.filter((candidate) => {
          const openedAt = candidate.tradeDate ?? candidate.executedAt;
          return (
            (candidate.source === "SHEET" || candidate.source === "MANUAL") &&
            candidate.state?.toUpperCase() === "CLOSE" &&
            candidate.buyPrice != null &&
            candidate.quantity != null &&
            openedAt != null &&
            unlinkedSells.every((fill) => fill.executedAt >= openedAt) &&
            Math.abs(candidate.quantity - totalSellQty) <= Math.max(1e-6, totalSellQty * 0.001) &&
            (candidate.brokerAccountId === account.id ||
              (candidate.brokerAccountId == null && brokerKey(candidate.platform) === brokerKey(account.alias)))
          );
        });

        if (unlinkedSells.length > 0 && authoredMatches.length === 1) {
          const canonical = authoredMatches[0];
          const canonicalOpenedAt = canonical.tradeDate ?? canonical.executedAt!;
          const stopgaps = candidates.filter((candidate) =>
            candidate.brokerAccountId === account.id &&
            isStopgap(candidate) &&
            candidate.quantity != null &&
            Math.abs(candidate.quantity - totalSellQty) <= Math.max(1e-6, totalSellQty * 0.001)
          );
          const basisStopgap = stopgaps.find((candidate) => {
            const openedAt = candidate.tradeDate ?? candidate.executedAt;
            return openedAt != null && Math.abs(openedAt.getTime() - canonicalOpenedAt.getTime()) <= 3 * 86_400_000;
          });
          const basisOpenedAt = basisStopgap?.tradeDate ?? basisStopgap?.executedAt ?? canonicalOpenedAt;
          const closure = buildSellOnlyClosure(unlinkedSells, {
            ticker,
            openedAt: basisOpenedAt,
            buyQty: basisStopgap?.quantity ?? canonical.quantity!,
            avgBuy: basisStopgap?.buyPrice ?? canonical.buyPrice!,
          });

          if (closure?.closedAt && closure.realized != null) {
            report.recordsClosed++;
            report.actions.push(
              `${dryRun ? "[dry] " : ""}sell-only close ${ticker} → ${canonical.id} ` +
              `entry ${closure.avgBuy.toFixed(2)} exit ${closure.avgSell.toFixed(2)} pnl ${closure.realized.toFixed(2)} USD`,
            );
            if (!dryRun) {
              await prisma.tradeRecord.update({
                where: { id: canonical.id },
                data: {
                  state: "CLOSE",
                  buyPrice: new Prisma.Decimal(closure.avgBuy.toFixed(4)),
                  quantity: new Prisma.Decimal(closure.buyQty.toFixed(2)),
                  exitPrice: new Prisma.Decimal(closure.avgSell.toFixed(4)),
                  executedAt: closure.closedAt,
                  brokerAccountId: account.id,
                  pnlUsd: new Prisma.Decimal(closure.realized.toFixed(2)),
                  currencyCode: "USD",
                  fxRate: null,
                  pnlSource: "broker",
                },
              });
              const linked = await prisma.tradeFill.updateMany({
                where: { id: { in: closure.fillIds } },
                data: { tradeRecordId: canonical.id },
              });
              report.fillsLinked += linked.count;

              for (const stopgap of stopgaps) {
                const details = await prisma.tradeRecord.findUnique({
                  where: { id: stopgap.id },
                  select: {
                    verdict: true,
                    journalEntry: { select: { id: true } },
                    _count: { select: { verdictHistory: true } },
                  },
                });
                if (details?.verdict != null || details?.journalEntry != null || (details?._count.verdictHistory ?? 0) > 0) {
                  report.conflicts.push(`sell-only stopgap ${stopgap.id} has journal content and was not deleted`);
                  continue;
                }
                await prisma.tradeRecord.delete({ where: { id: stopgap.id } });
                report.duplicatesDeleted++;
              }
            } else {
              report.fillsLinked += closure.fillIds.length;
              report.duplicatesDeleted += stopgaps.length;
            }
          }
        } else if (unlinkedSells.length > 0 && authoredMatches.length > 1) {
          report.conflicts.push(`ambiguous sell-only closure ${ticker}: ${authoredMatches.length} authored matches`);
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
