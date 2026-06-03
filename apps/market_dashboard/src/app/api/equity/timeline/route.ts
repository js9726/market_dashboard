/**
 * GET /api/equity/timeline
 *
 * Two-line equity view:
 *   1. `realized` — cumulative REALIZED P&L from the user's sheet closed trades.
 *      This is the reliable "real equity curve": it reflects actual booked
 *      trading performance and does NOT depend on the broker snapshot.
 *   2. `accountValue` — broker net account value (EquitySnapshot.totalAssets),
 *      shown ONLY when it reconciles with cash + live position value. The
 *      moomoo bridge has been observed reporting totals that are multiples of
 *      the real account (wrong acc_id / margin buying-power / aggregate view),
 *      so we fail-closed: if broker totals diverge >50% from (cash + positions)
 *      we mark `accountValueReliable=false` and the UI hides that line + warns
 *      rather than showing a fake number.
 *
 * Auth: NextAuth session, own data only.
 * Query: ?from=YYYY-MM-DD ?to=YYYY-MM-DD ?accountId=...
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const RECONCILE_TOLERANCE = 0.5; // broker total may differ from cash+positions by ≤50%

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canSeePersonalBook(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userScopeId = scopeUserId(session)!;

  const qp = new URL(req.url).searchParams;
  const today = new Date();
  const defaultFrom = new Date(today);
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 90);
  const from = qp.get("from") && /^\d{4}-\d{2}-\d{2}$/.test(qp.get("from")!)
    ? new Date(`${qp.get("from")}T00:00:00.000Z`)
    : new Date(defaultFrom.toISOString().slice(0, 10) + "T00:00:00.000Z");
  const to = qp.get("to") && /^\d{4}-\d{2}-\d{2}$/.test(qp.get("to")!)
    ? new Date(`${qp.get("to")}T00:00:00.000Z`)
    : new Date(today.toISOString().slice(0, 10) + "T00:00:00.000Z");
  const accountId = qp.get("accountId");

  const accounts = await prisma.userBrokerAccount.findMany({
    where: { userId: userScopeId, isActive: true },
    include: { preset: true },
    orderBy: { createdAt: "asc" },
  });

  // Single-currency equity: you CANNOT sum USD + MYR. Use the connected
  // account's currency (USD here; overridable via ?currency=) and EXCLUDE
  // trades booked in other currencies (e.g. the lone MYR Affin Hwang trade),
  // reporting the excluded set for transparency.
  const equityCurrency = (
    qp.get("currency") ?? accounts[0]?.displayCurrency ?? accounts[0]?.preset?.currency ?? "USD"
  ).toUpperCase();

  // ── Reliable line: cumulative realized P&L from the sheet (one currency) ────
  const closed = await prisma.tradeRecord.findMany({
    where: {
      userId: userScopeId,
      pnl: { not: null },
      currency: equityCurrency,
      tradeDate: { not: null, gte: from, lte: to },
      ...(accountId ? { brokerAccountId: accountId } : {}),
    },
    select: { tradeDate: true, pnl: true },
    orderBy: { tradeDate: "asc" },
  });
  // Closed trades in OTHER currencies, excluded from this curve (for a UI note).
  const otherCurrency = await prisma.tradeRecord.groupBy({
    by: ["currency"],
    where: {
      userId: userScopeId,
      pnl: { not: null },
      tradeDate: { not: null, gte: from, lte: to },
      NOT: { currency: equityCurrency },
      ...(accountId ? { brokerAccountId: accountId } : {}),
    },
    _count: true,
    _sum: { pnl: true },
  });
  const excludedCurrencies = otherCurrency.map((g) => ({
    currency: g.currency ?? "(none)",
    count: g._count,
    sumPnl: g._sum.pnl != null ? Number(g._sum.pnl) : null,
  }));
  let running = 0;
  const realizedByDate = new Map<string, number>();
  for (const c of closed) {
    running += Number(c.pnl);
    realizedByDate.set(c.tradeDate!.toISOString().slice(0, 10), running);
  }
  const realized = Array.from(realizedByDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value: Number(value.toFixed(2)) }));

  // ── Broker account-value line (raw, then reconciled) ───────────────────────
  const snapshots = await prisma.equitySnapshot.findMany({
    where: {
      userId: userScopeId,
      snapshotDate: { gte: from, lte: to },
      ...(accountId ? { brokerAccountId: accountId } : {}),
    },
    orderBy: { snapshotDate: "asc" },
  });
  const byDate = new Map<string, { totalAssets: number; cash: number; marketVal: number }>();
  for (const s of snapshots) {
    const k = s.snapshotDate.toISOString().slice(0, 10);
    const cur = byDate.get(k) ?? { totalAssets: 0, cash: 0, marketVal: 0 };
    cur.totalAssets += Number(s.totalAssets);
    cur.cash += Number(s.cash);
    cur.marketVal += Number(s.marketVal);
    byDate.set(k, cur);
  }
  const accountValue = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      totalAssets: Number(v.totalAssets.toFixed(2)),
      cash: Number(v.cash.toFixed(2)),
      marketVal: Number(v.marketVal.toFixed(2)),
    }));

  // ── Reconciliation guard ───────────────────────────────────────────────────
  // expected net = latest cash + current live position value (the values that
  // actually match the user's real holdings). If the broker's reported total is
  // wildly off, the account-value line is not trustworthy.
  const positions = await prisma.position.findMany({
    where: { brokerAccount: { userId: userScopeId } },
    select: { qty: true, avgCost: true, currentPrice: true },
  });
  const positionsValue = positions.reduce((sum, p) => {
    const px = p.currentPrice != null ? Number(p.currentPrice) : Number(p.avgCost);
    return sum + Number(p.qty) * px;
  }, 0);
  const latest = accountValue.length ? accountValue[accountValue.length - 1] : null;
  const expectedNet = latest ? latest.cash + positionsValue : null;
  const brokerLatest = latest?.totalAssets ?? null;
  const accountValueReliable =
    brokerLatest != null && expectedNet != null && expectedNet > 0
      ? Math.abs(brokerLatest - expectedNet) / expectedNet <= RECONCILE_TOLERANCE
      : false;

  return NextResponse.json({
    realized,
    currency: equityCurrency,
    excludedCurrencies,
    accountValue,
    accountValueReliable,
    // Reliable building blocks for a net-account-value line, independent of the
    // (possibly wrong) broker total: live positions value + last known cash.
    // The UI lets you override cash manually until the bridge acc_id is fixed.
    positionsValue: Number(positionsValue.toFixed(2)),
    latestCash: latest?.cash ?? null,
    reconciliation: expectedNet != null
      ? {
          expectedNet: Number(expectedNet.toFixed(2)),
          brokerLatest,
          positionsValue: Number(positionsValue.toFixed(2)),
          latestCash: latest?.cash ?? null,
        }
      : null,
    accounts: accounts.map((a) => ({
      id: a.id,
      alias: a.alias,
      currency: a.displayCurrency ?? a.preset.currency,
    })),
  });
}
