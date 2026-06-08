/**
 * alist-close.ts — auto-close held A-list candidates whose broker position is
 * gone (the operator exited / got stopped out). Pure DB logic so the
 * track-positions cron and any future manual-close endpoint share one path.
 *
 * Rule: a row that is `isHeld` + `status="ACTIVE"` but has NO matching open
 * Position (qty > 0) for the user has been exited → flip it to STOPPED_OUT
 * (loss) or CLOSED (flat/profit) with the realized R. Realized P&L is
 * broker-true from the linked TradeRecord when present; otherwise it falls back
 * to the last mark the track-positions cron already computed (realizedRLogged).
 *
 * Idempotent — only touches ACTIVE rows, so re-running after a close is a no-op.
 * This is what lets a manual broker exit (e.g. POWL) register on the A-List
 * without hand-entering it: the next sync removes the Position, and the next
 * tracker run reconciles the candidate.
 */
import { Prisma, type PrismaClient } from "@prisma/client";

/** Strip a broker prefix ("US.POWL" → "POWL"); bare tickers pass through. */
function plain(ticker: string): string {
  const i = ticker.lastIndexOf(".");
  return (i >= 0 ? ticker.slice(i + 1) : ticker).toUpperCase();
}

export interface ReconcileResult {
  checked: number;
  closed: { ticker: string; realizedR: number | null; outcome: string }[];
}

export async function reconcileClosedHeld(
  prisma: PrismaClient,
  userId: string,
): Promise<ReconcileResult> {
  const held = await prisma.aListCandidate.findMany({
    where: { userId, isHeld: true, status: "ACTIVE" },
  });
  if (held.length === 0) return { checked: 0, closed: [] };

  // Current OPEN broker positions for this user (qty > 0), across all accounts.
  const positions = await prisma.position.findMany({
    where: { brokerAccount: { userId }, qty: { gt: 0 } },
    select: { ticker: true },
  });
  const openTickers = new Set(positions.map((p) => plain(p.ticker)));

  const closed: ReconcileResult["closed"] = [];
  for (const c of held) {
    if (openTickers.has(plain(c.ticker))) continue; // still held — leave ACTIVE

    // Position is gone → exited. Prefer broker-true realized from the linked
    // trade record; else keep the last mark the tracker already wrote.
    let realizedR = c.realizedRLogged?.toNumber() ?? null;
    if (c.heldTradeRecordId) {
      const tr = await prisma.tradeRecord.findUnique({
        where: { id: c.heldTradeRecordId },
        select: { pnlUsd: true },
      });
      const pnl = tr?.pnlUsd?.toNumber() ?? null;
      const qty = c.heldQty?.toNumber() ?? null;
      const rUnit = c.rUnitLogged?.toNumber() ?? c.rUnitAtr?.toNumber() ?? null;
      if (pnl != null && qty != null && rUnit != null && rUnit > 0) {
        realizedR = Math.round((pnl / (rUnit * qty)) * 100) / 100;
      }
    }

    const isLoss = (realizedR ?? 0) < 0;
    const outcome = isLoss ? "STOPPED_OUT" : "DRIFT";
    const status = isLoss ? "STOPPED_OUT" : "CLOSED";

    await prisma.aListCandidate.update({
      where: { id: c.id },
      data: {
        status,
        day14Outcome: outcome,
        realizedRLogged:
          realizedR != null ? new Prisma.Decimal(realizedR) : c.realizedRLogged,
        hardStopHitAt: c.hardStopHitAt ?? new Date(),
        day14ComputedAt: new Date(),
      },
    });
    closed.push({ ticker: plain(c.ticker), realizedR, outcome });
  }
  return { checked: held.length, closed };
}
