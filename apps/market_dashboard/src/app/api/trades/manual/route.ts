/**
 * POST /api/trades/manual - manual trade entry (Tier 2 / Tier 3 users).
 *
 * Body:
 * {
 *   brokerAccountId: string,   // UserBrokerAccount.id (must belong to authed user)
 *   ticker:          string,   // 'US.HUT', 'HK.00700', etc.
 *   side:            'BUY' | 'SELL',
 *   qty:             number,
 *   price:           number,
 *   executedAt:      string (ISO),
 *   notes?:          string,
 *   // Optional pre-trade plan
 *   proposedSL?:     number,
 *   proposedTP?:     number,
 * }
 *
 * Response:
 * {
 *   ok: true,
 *   tradeRecordId: string,
 *   tradeFillId:   string,
 *   positionId:    string,    // upserted position
 *   fees: { total, components }
 * }
 *
 * Side effects:
 *   - Creates a TradeFill row (immutable audit)
 *   - Creates OR updates a Position row (qty + avgCost recalculated for BUY,
 *     qty reduced for SELL; deletes Position when qty hits 0)
 *   - Creates a new TradeRecord (position lifecycle) when this is a new entry,
 *     or attaches to the most recent open TradeRecord for the same ticker+account
 *     when it's a trim/exit.
 *
 * Auth: session-based. Approved personal-book users only.
 */
import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { calculateFees, type FeeFormula, type FeeSide } from "@/lib/fees";
import { canonicalBrokerLabel } from "@/lib/broker-normalization";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Body = {
  brokerAccountId?: unknown;
  ticker?: unknown;
  side?: unknown;
  qty?: unknown;
  price?: unknown;
  executedAt?: unknown;
  notes?: unknown;
  proposedSL?: unknown;
  proposedTP?: unknown;
};

function err(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return err("Unauthorized", 401);
  if (!canSeePersonalBook(session)) {
    return err("Forbidden - manual journal requires account approval", 403);
  }
  const userScopeId = scopeUserId(session)!;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return err("Invalid JSON body");
  }

  // Validate request payload.
  const brokerAccountId = typeof body.brokerAccountId === "string" ? body.brokerAccountId : null;
  const ticker = typeof body.ticker === "string" ? body.ticker.trim().toUpperCase() : null;
  const side = typeof body.side === "string" ? body.side.toUpperCase() : null;
  const qty = asNumber(body.qty);
  const price = asNumber(body.price);
  const executedAtStr = typeof body.executedAt === "string" ? body.executedAt : null;

  if (!brokerAccountId) return err("brokerAccountId required");
  if (!ticker) return err("ticker required");
  if (side !== "BUY" && side !== "SELL") return err("side must be 'BUY' or 'SELL'");
  if (qty == null || qty <= 0) return err("qty must be a positive number");
  if (price == null || price <= 0) return err("price must be a positive number");
  if (!executedAtStr) return err("executedAt (ISO string) required");
  const executedAt = new Date(executedAtStr);
  if (Number.isNaN(executedAt.getTime())) return err("executedAt is not a valid date");

  const notes = typeof body.notes === "string" ? body.notes : null;
  const proposedSL = asNumber(body.proposedSL);
  const proposedTP = asNumber(body.proposedTP);

  // Verify the broker account belongs to the scoped user.
  const brokerAccount = await prisma.userBrokerAccount.findFirst({
    where: { id: brokerAccountId, userId: userScopeId, isActive: true },
    include: { preset: true },
  });
  if (!brokerAccount) {
    return err("brokerAccountId not found or not owned by user", 403);
  }

  const feeFormula = brokerAccount.preset.feeFormula as FeeFormula | null;
  const fees = calculateFees(feeFormula, qty, price, side as FeeSide);

  const currency = brokerAccount.displayCurrency ?? brokerAccount.preset.currency;

  // Transaction.
  // 1. Find OR create the lifecycle TradeRecord (one per open position).
  // 2. Insert the TradeFill row.
  // 3. Upsert Position (delete if qty -> 0).
  // 4. If SELL closes the lifecycle, mark TradeRecord state=CLOSE + compute pnl.

  const result = await prisma.$transaction(async (tx) => {
    // Find open TradeRecord for this account+ticker (state OPEN/SEMI-OPEN/PLANNING/null)
    const OPEN_STATES = ["OPEN", "SEMI-OPEN", "PLANNING"];
    let tradeRecord = await tx.tradeRecord.findFirst({
      where: {
        userId: userScopeId,
        brokerAccountId,
        ticker,
        OR: [{ state: { in: OPEN_STATES } }, { state: null, pnl: null }],
      },
      orderBy: { executedAt: "desc" },
    });

    if (!tradeRecord) {
      // New position: create lifecycle row only if this is a BUY (Long entry).
      // SELL without an open position is treated as an orphan fill (still
      // recorded in TradeFill for audit) but the TradeRecord stays minimal.
      tradeRecord = await tx.tradeRecord.create({
        data: {
          userId: userScopeId,
          source: "MANUAL",
          brokerAccountId,
          ticker,
          tradeDate: executedAt,
          executedAt,
          side: side === "BUY" ? "Long" : "Short",
          buyPrice: side === "BUY" ? new Prisma.Decimal(price) : null,
          quantity: side === "BUY" ? new Prisma.Decimal(qty) : new Prisma.Decimal(-qty),
          fees: new Prisma.Decimal(fees.total),
          notes,
          state: side === "BUY" ? "OPEN" : "CLOSE",
          currency,
          platform: canonicalBrokerLabel(brokerAccount.alias),
          proposedSL: proposedSL != null ? new Prisma.Decimal(proposedSL) : null,
          proposedTP: proposedTP != null ? new Prisma.Decimal(proposedTP) : null,
          rawRow: {},
        },
      });
    } else if (side === "SELL") {
      // Trim or exit: update exitPrice + accumulated fees + state.
      const existingPosition = await tx.position.findUnique({
        where: { brokerAccountId_ticker: { brokerAccountId, ticker } },
      });
      const remainingQty = existingPosition
        ? Number(existingPosition.qty) - qty
        : 0;
      const closing = remainingQty <= 0.0001;  // float tolerance

      const currentFees = Number(tradeRecord.fees ?? 0);
      const newFees = currentFees + fees.total;

      let pnl: Prisma.Decimal | null = null;
      if (closing && tradeRecord.buyPrice != null) {
        // Realised P&L = (avgExit - avgBuy) * qty_closed - total fees
        const buyPx = Number(tradeRecord.buyPrice);
        const sellPx = price;
        const tradeQty = Number(tradeRecord.quantity ?? qty);
        pnl = new Prisma.Decimal((sellPx - buyPx) * Math.abs(tradeQty) - newFees);
      }

      tradeRecord = await tx.tradeRecord.update({
        where: { id: tradeRecord.id },
        data: {
          exitPrice: new Prisma.Decimal(price),
          fees: new Prisma.Decimal(newFees),
          state: closing ? "CLOSE" : "SEMI-OPEN",
          pnl,
        },
      });
    }

    // 2. Insert the TradeFill row (always)
    const tradeFill = await tx.tradeFill.create({
      data: {
        tradeRecordId: tradeRecord.id,
        brokerAccountId,
        brokerFillId: null,  // manual entries have no broker fill id
        ticker,
        side,
        qty: new Prisma.Decimal(qty),
        price: new Prisma.Decimal(price),
        executedAt,
        fees: new Prisma.Decimal(fees.total),
        currency,
        source: "MANUAL",
      },
    });

    // 3. Upsert Position
    const existingPosition = await tx.position.findUnique({
      where: { brokerAccountId_ticker: { brokerAccountId, ticker } },
    });

    let positionId: string;
    if (side === "BUY") {
      if (existingPosition) {
        // Recompute weighted average cost.
        const oldQty = Number(existingPosition.qty);
        const oldCost = Number(existingPosition.avgCost);
        const newQty = oldQty + qty;
        const newAvgCost = newQty > 0 ? (oldQty * oldCost + qty * price) / newQty : price;
        const updated = await tx.position.update({
          where: { id: existingPosition.id },
          data: {
            qty: new Prisma.Decimal(newQty),
            avgCost: new Prisma.Decimal(newAvgCost),
            lastFillAt: executedAt,
            asOf: new Date(),
          },
        });
        positionId = updated.id;
      } else {
        const created = await tx.position.create({
          data: {
            brokerAccountId,
            ticker,
            qty: new Prisma.Decimal(qty),
            avgCost: new Prisma.Decimal(price),
            currency,
            openedAt: executedAt,
            lastFillAt: executedAt,
          },
        });
        positionId = created.id;
      }
    } else {
      // SELL
      if (!existingPosition) {
        // Orphan sell (e.g., short or pre-existing position not tracked).
        // Create a "negative" position row so the audit is complete.
        const created = await tx.position.create({
          data: {
            brokerAccountId,
            ticker,
            qty: new Prisma.Decimal(-qty),
            avgCost: new Prisma.Decimal(price),
            currency,
            openedAt: executedAt,
            lastFillAt: executedAt,
          },
        });
        positionId = created.id;
      } else {
        const newQty = Number(existingPosition.qty) - qty;
        if (newQty <= 0.0001) {
          // Position closed: delete the row.
          await tx.position.delete({ where: { id: existingPosition.id } });
          positionId = existingPosition.id;  // returning id for response, even though deleted
        } else {
          const updated = await tx.position.update({
            where: { id: existingPosition.id },
            data: {
              qty: new Prisma.Decimal(newQty),
              lastFillAt: executedAt,
              asOf: new Date(),
            },
          });
          positionId = updated.id;
        }
      }
    }

    return { tradeRecordId: tradeRecord.id, tradeFillId: tradeFill.id, positionId };
  });

  return NextResponse.json({
    ok: true,
    ...result,
    fees: { total: fees.total, components: fees.components },
  });
}
