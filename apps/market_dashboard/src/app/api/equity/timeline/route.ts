/**
 * GET /api/equity/timeline
 *
 * Currency-aware equity view.
 *
 * Source-of-truth rule:
 * - If the MooMoo bridge has account snapshots, EquitySnapshot.totalAssets is
 *   the primary account-equity curve.
 * - Cash + live-position value is a diagnostic cross-check and fallback only.
 * - Realized P&L comes from broker TradeFill rows, net of fees, in USD.
 *
 * The client converts USD to MYR with a live USD/MYR rate when available.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { liveQuoteThresholdsForNow } from "@/lib/freshness";
import { prisma } from "@/lib/prisma";
import { computeBrokerRealized } from "@/server/realized-pnl";

export const dynamic = "force-dynamic";

function plainTicker(ticker: string): string {
  return ticker.replace(/^[A-Za-z]{2}\./, "").toUpperCase();
}

let _fx: { rate: number; at: number } | null = null;
async function getUsdMyr(): Promise<number | null> {
  if (_fx && Date.now() - _fx.at < 3_600_000) return _fx.rate;
  try {
    const r = await fetch("https://api.frankfurter.app/latest?from=USD&to=MYR", {
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const j = await r.json();
      const rate = Number(j?.rates?.MYR);
      if (Number.isFinite(rate) && rate > 0) {
        _fx = { rate, at: Date.now() };
        return rate;
      }
    }
  } catch {
    // Fail closed: return the last warm-instance value, or null if unavailable.
  }
  return _fx?.rate ?? null;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canSeePersonalBook(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
  const fromKey = from.toISOString().slice(0, 10);
  const toKey = to.toISOString().slice(0, 10);

  const accounts = await prisma.userBrokerAccount.findMany({
    where: { userId: userScopeId, isActive: true },
    include: { preset: true },
    orderBy: { createdAt: "asc" },
  });

  const fills = await prisma.tradeFill.findMany({
    where: {
      brokerAccount: { userId: userScopeId },
      currency: "USD",
      executedAt: { lte: to },
      ...(accountId ? { brokerAccountId: accountId } : {}),
    },
    orderBy: { executedAt: "asc" },
    select: { ticker: true, side: true, qty: true, price: true, fees: true, executedAt: true },
  });
  const brokerRealized = computeBrokerRealized(fills);
  const beforeWindow = [...brokerRealized.points].reverse().find((p) => p.date < fromKey);
  const inWindow = brokerRealized.points.filter((p) => p.date >= fromKey);
  const realized = [
    ...(beforeWindow ? [{ date: fromKey, value: beforeWindow.value }] : []),
    ...inWindow,
  ];
  if (realized.length === 1 && realized[0].date !== toKey) {
    realized.push({ date: toKey, value: realized[0].value });
  }

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

  const positions = await prisma.position.findMany({
    where: { brokerAccount: { userId: userScopeId } },
    select: { ticker: true, qty: true, avgCost: true, currentPrice: true, currency: true, asOf: true },
  });
  const usdPositions = positions.filter((p) => p.currency === "USD");
  const positionSymbols = Array.from(new Set(usdPositions.map((p) => plainTicker(p.ticker))));
  const liveQuotes = positionSymbols.length
    ? await prisma.liveQuote.findMany({
        where: { symbol: { in: positionSymbols } },
        select: { symbol: true, price: true, observedAt: true, source: true },
      })
    : [];
  const quoteBySymbol = new Map(liveQuotes.map((q) => [q.symbol, q]));
  const staleMs = liveQuoteThresholdsForNow().staleSec * 1000;
  let staleQuotes = 0;
  let usedPositionCache = 0;
  let usedAvgCost = 0;
  let latestQuoteAtMs: number | null = null;

  const positionsValue = usdPositions.reduce((sum, p) => {
    const quote = quoteBySymbol.get(plainTicker(p.ticker));
    const quoteFresh = quote ? Date.now() - quote.observedAt.getTime() <= staleMs : false;
    if (quote?.observedAt && (latestQuoteAtMs == null || quote.observedAt.getTime() > latestQuoteAtMs)) {
      latestQuoteAtMs = quote.observedAt.getTime();
    }
    if (quote && !quoteFresh) staleQuotes += 1;

    let px: number;
    if (quote && quoteFresh) {
      px = Number(quote.price);
    } else if (p.currentPrice != null) {
      px = Number(p.currentPrice);
      usedPositionCache += 1;
    } else {
      px = Number(p.avgCost);
      usedAvgCost += 1;
    }
    return sum + Number(p.qty) * px;
  }, 0);
  const excludedPositionCurrencies = positions
    .filter((p) => p.currency !== "USD")
    .reduce<Record<string, number>>((acc, p) => {
      acc[p.currency] = (acc[p.currency] ?? 0) + 1;
      return acc;
    }, {});
  const latest = accountValue.length ? accountValue[accountValue.length - 1] : null;
  const expectedNet = latest ? latest.cash + positionsValue : null;
  const brokerLatest = latest?.totalAssets ?? null;
  const discrepancy =
    brokerLatest != null && expectedNet != null
      ? brokerLatest - expectedNet
      : null;
  const discrepancyPct =
    discrepancy != null && expectedNet != null && expectedNet !== 0
      ? (discrepancy / expectedNet) * 100
      : null;

  const fxUsdMyr = await getUsdMyr();

  return NextResponse.json({
    realized,
    realizedCurrency: "USD",
    realizedGrossUsd: brokerRealized.grossUsd,
    realizedFeesUsd: brokerRealized.feesUsd,
    realizedNetUsd: brokerRealized.netUsd,
    accountValue,
    accountValueSource: accountValue.length > 0 ? "moomoo-total-assets" : "fallback-cash-plus-positions",
    fxUsdMyr,
    positionsValue: Number(positionsValue.toFixed(2)),
    positionsPricing: {
      source: usedAvgCost > 0 ? "mixed" : (usedPositionCache > 0 ? "position-cache" : "live-quote"),
      latestQuoteAt: latestQuoteAtMs == null ? null : new Date(latestQuoteAtMs).toISOString(),
      liveQuoteCount: liveQuotes.length,
      staleQuotes,
      usedPositionCache,
      usedAvgCost,
      excludedPositionCurrencies,
    },
    latestCash: latest?.cash ?? null,
    reconciliation: expectedNet != null
      ? {
          expectedNet: Number(expectedNet.toFixed(2)),
          brokerLatest,
          discrepancy: discrepancy == null ? null : Number(discrepancy.toFixed(2)),
          discrepancyPct: discrepancyPct == null ? null : Number(discrepancyPct.toFixed(2)),
          positionsValue: Number(positionsValue.toFixed(2)),
          latestCash: latest?.cash ?? null,
          latestMarketVal: latest?.marketVal ?? null,
        }
      : null,
    accounts: accounts.map((a) => ({ id: a.id, alias: a.alias, currency: a.displayCurrency ?? a.preset.currency })),
  });
}
