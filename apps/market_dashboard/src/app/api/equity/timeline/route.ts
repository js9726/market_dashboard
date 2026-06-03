/**
 * GET /api/equity/timeline
 *
 * Currency-aware equity view. Two facts drive this:
 *   • Your sheet records realized P&L in MYR (verified: clean trades ≈ 4.7× the
 *     USD price move). So the `realized` curve is MYR, summed across ALL closed
 *     trades (the broker/market `currency` column is NOT the P&L currency).
 *   • Your live broker account (cash + US positions) is USD.
 * To put them on one curve, the UI toggles USD/MYR using a LIVE USD/MYR rate.
 *
 * Returns realized in MYR + the FX rate + USD net-value building blocks; the
 * client converts to the selected display currency. Broker net-value is still
 * gated by reconciliation (the wrong ~$103k total is never shown).
 *
 * Phase 2 (needs bridge): replace the sheet realized with MooMoo deal-history
 * realized (native USD) where available — see EQUITY tasks.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { liveQuoteThresholdsForNow } from "@/lib/freshness";
import { prisma } from "@/lib/prisma";
import { computeBrokerRealized } from "@/server/realized-pnl";

export const dynamic = "force-dynamic";

const RECONCILE_TOLERANCE = 0.5;

function plainTicker(ticker: string): string {
  return ticker.replace(/^[A-Za-z]{2}\./, "").toUpperCase();
}

// Live USD/MYR with a warm-instance cache + fail-closed (null when unknown —
// the UI then stays in MYR rather than guessing a rate).
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
    /* fall through to last-known / null */
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

  const accounts = await prisma.userBrokerAccount.findMany({
    where: { userId: userScopeId, isActive: true },
    include: { preset: true },
    orderBy: { createdAt: "asc" },
  });

  // ── Realized P&L: broker-true, net of fees, from MooMoo TradeFills (USD) ────
  // Symmetric matching + per-fill fees (backfill_deals.py pulls deal history +
  // order_fee_query). Computed over ALL fills up to `to` so the cumulative is
  // correct, then windowed to [from, to] for display.
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
  const fromKey = from.toISOString().slice(0, 10);
  const realized = brokerRealized.points.filter((p) => p.date >= fromKey);

  // ── Broker account value (USD) + reconciliation guard ──────────────────────
  const snapshots = await prisma.equitySnapshot.findMany({
    where: {
      userId: userScopeId,
      snapshotDate: { gte: from, lte: to },
      ...(accountId ? { brokerAccountId: accountId } : {}),
    },
    orderBy: { snapshotDate: "asc" },
  });
  const byDate = new Map<string, { totalAssets: number; cash: number }>();
  for (const s of snapshots) {
    const k = s.snapshotDate.toISOString().slice(0, 10);
    const cur = byDate.get(k) ?? { totalAssets: 0, cash: 0 };
    cur.totalAssets += Number(s.totalAssets);
    cur.cash += Number(s.cash);
    byDate.set(k, cur);
  }
  const accountValue = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, totalAssets: Number(v.totalAssets.toFixed(2)), cash: Number(v.cash.toFixed(2)) }));

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
  const accountValueReliable =
    brokerLatest != null && expectedNet != null && expectedNet > 0
      ? Math.abs(brokerLatest - expectedNet) / expectedNet <= RECONCILE_TOLERANCE
      : false;

  const fxUsdMyr = await getUsdMyr();

  return NextResponse.json({
    // realized is MYR (sheet); net building blocks are USD (broker). The client
    // converts to the chosen display currency with fxUsdMyr.
    realized,
    realizedCurrency: "USD",
    realizedGrossUsd: brokerRealized.grossUsd,
    realizedFeesUsd: brokerRealized.feesUsd,
    realizedNetUsd: brokerRealized.netUsd,
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
    accountValueReliable,
    reconciliation: expectedNet != null
      ? { expectedNet: Number(expectedNet.toFixed(2)), brokerLatest, positionsValue: Number(positionsValue.toFixed(2)), latestCash: latest?.cash ?? null }
      : null,
    accounts: accounts.map((a) => ({ id: a.id, alias: a.alias, currency: a.displayCurrency ?? a.preset.currency })),
  });
}
