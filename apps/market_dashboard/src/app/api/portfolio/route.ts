/**
 * GET /api/portfolio — authed user's broker accounts + positions + live P&L.
 *
 * Returns:
 * {
 *   accounts: [
 *     {
 *       id, alias, presetName, currency, isLive,
 *       positions: [
 *         { id, ticker, qty, avgCost, currency,
 *           currentPrice, marketValue, unrealizedPl, unrealizedPlPct,
 *           openedAt, lastFillAt, priceObservedAt, priceSource, stale }
 *       ],
 *       totals: { cost, marketValue, unrealizedPl, unrealizedPlPct }
 *     }
 *   ],
 *   grandTotals: { cost, marketValue, unrealizedPl, unrealizedPlPct },
 *   asOf: ISO timestamp
 * }
 *
 * Live prices prefer LiveQuote rows pushed by the local dashboard bridge, then
 * fall back to MarketQuote rows refreshed by /api/cron/refresh-quotes.
 * If no quote row exists for a position's ticker, the position is returned with
 * currentPrice=null and stale=true so the UI can show a placeholder.
 *
 * Per-user data isolation: only returns accounts where userId = session user.
 */
import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const STALE_THRESHOLD_MS = 15 * 60 * 1000;  // 15 min — quote older than this is "stale"

function toNum(d: unknown): number {
  if (d == null) return 0;
  const n = Number(d);
  return Number.isFinite(n) ? n : 0;
}

function plainSymbol(internalSymbol: string): string {
  const [prefix, ticker] = internalSymbol.split(".", 2);
  return ticker && prefix ? ticker : internalSymbol;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canSeePersonalBook(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userScopeId = scopeUserId(session)!;

  // Fetch the user's active accounts with positions in one round-trip.
  const accounts = await prisma.userBrokerAccount.findMany({
    where: { userId: userScopeId, isActive: true },
    orderBy: { createdAt: "asc" },
    include: {
      preset: { select: { name: true, currency: true, region: true } },
      positions: { orderBy: { ticker: "asc" } },
    },
  });

  // Collect distinct tickers and fetch quotes in one query.
  const tickers = new Set<string>();
  for (const acct of accounts) {
    for (const p of acct.positions) tickers.add(p.ticker);
  }

  const tickerList = Array.from(tickers);
  const liveTickerList = Array.from(new Set(tickerList.map(plainSymbol)));

  const [marketQuotes, liveQuotes] = tickers.size
    ? await Promise.all([
        prisma.marketQuote.findMany({
          where: { symbol: { in: tickerList } },
          select: { symbol: true, price: true, changePct: true, observedAt: true, source: true },
        }),
        prisma.liveQuote.findMany({
          where: { symbol: { in: liveTickerList } },
          select: { symbol: true, price: true, changePct: true, observedAt: true, source: true },
        }),
      ])
    : [[], []];

  const liveQuoteMap = new Map(liveQuotes.map((q) => [q.symbol, q]));
  const marketQuoteMap = new Map(marketQuotes.map((q) => [q.symbol, q]));
  const quotes = tickerList
    .map((ticker) => {
      const live = liveQuoteMap.get(plainSymbol(ticker));
      const market = marketQuoteMap.get(ticker);
      if (!live) return market ? { ...market, symbol: ticker } : null;
      if (!market) return { ...live, symbol: ticker };
      return live.observedAt >= market.observedAt ? { ...live, symbol: ticker } : market;
    })
    .filter((q): q is NonNullable<typeof q> => q != null);

  // Find the latest TradeRecord per (brokerAccountId, ticker) so rows can deep-link
  // to the journal editor without a second round-trip from the UI.
  const accountIds = accounts.map((a) => a.id);
  const tradeRecords =
    accountIds.length && tickers.size
      ? await prisma.tradeRecord.findMany({
          where: {
            brokerAccountId: { in: accountIds },
            ticker: { in: tickerList },
          },
          select: { id: true, brokerAccountId: true, ticker: true, executedAt: true, tradeDate: true },
          orderBy: [{ executedAt: "desc" }, { tradeDate: "desc" }],
        })
      : [];
  // Index by (accountId|ticker) → first match wins (already sorted desc)
  const tradeIdMap = new Map<string, string>();
  for (const t of tradeRecords) {
    if (!t.brokerAccountId) continue;
    const key = `${t.brokerAccountId}|${t.ticker}`;
    if (!tradeIdMap.has(key)) tradeIdMap.set(key, t.id);
  }

  const quoteMap = new Map(quotes.map((q) => [q.symbol, q]));
  const now = Date.now();

  // Compute per-account and grand totals.
  //
  // P&L totals only include positions WITH a live quote. If a position has
  // no quote, we still surface its cost in `costAll` (the "Cost basis" tile),
  // but exclude it from the market value, P&L, and return calculations -- so
  // missing quotes don't manifest as a fake -100% loss.
  let grandCostAll = 0;       // sum of cost across ALL positions (display: "Cost basis")
  let grandCostPriced = 0;    // sum of cost across positions WITH quotes
  let grandMV = 0;
  let grandPriced = 0;
  let grandUnpriced = 0;

  const enrichedAccounts = accounts.map((acct) => {
    let acctCostAll = 0;
    let acctCostPriced = 0;
    let acctMV = 0;
    let acctPriced = 0;
    let acctUnpriced = 0;

    const positions = acct.positions.map((p) => {
      const qty = toNum(p.qty);
      const avgCost = toNum(p.avgCost);
      const cost = qty * avgCost;

      const quote = quoteMap.get(p.ticker);
      const currentPrice = quote ? toNum(quote.price) : null;
      const marketValue = currentPrice != null ? qty * currentPrice : null;
      const unrealizedPl = marketValue != null ? marketValue - cost : null;
      const unrealizedPlPct =
        unrealizedPl != null && cost !== 0 ? (unrealizedPl / Math.abs(cost)) * 100 : null;

      const priceObservedAt = quote?.observedAt ?? null;
      const stale =
        priceObservedAt == null ||
        now - priceObservedAt.getTime() > STALE_THRESHOLD_MS;

      acctCostAll += cost;
      if (marketValue != null) {
        acctCostPriced += cost;
        acctMV += marketValue;
        acctPriced++;
      } else {
        acctUnpriced++;
      }

      const latestTradeRecordId =
        tradeIdMap.get(`${acct.id}|${p.ticker}`) ?? null;

      return {
        id: p.id,
        ticker: p.ticker,
        qty,
        avgCost,
        currency: p.currency,
        currentPrice,
        marketValue,
        unrealizedPl,
        unrealizedPlPct,
        changePct: quote?.changePct ? toNum(quote.changePct) : null,
        openedAt: p.openedAt,
        lastFillAt: p.lastFillAt,
        priceObservedAt,
        priceSource: quote?.source ?? null,
        stale,
        latestTradeRecordId,
      };
    });

    grandCostAll += acctCostAll;
    grandCostPriced += acctCostPriced;
    grandMV += acctMV;
    grandPriced += acctPriced;
    grandUnpriced += acctUnpriced;

    // P&L only meaningful for priced positions. If no positions priced, null out
    // so the UI shows "—" instead of a fake 0 or -100%.
    const acctUnrealizedPl = acctPriced > 0 ? acctMV - acctCostPriced : null;
    const acctUnrealizedPlPct =
      acctUnrealizedPl != null && acctCostPriced > 0
        ? (acctUnrealizedPl / Math.abs(acctCostPriced)) * 100
        : null;

    return {
      id: acct.id,
      alias: acct.alias,
      presetName: acct.preset.name,
      currency: acct.displayCurrency ?? acct.preset.currency,
      region: acct.preset.region,
      isLive: acct.isLive,
      positions,
      pricedCount: acctPriced,
      unpricedCount: acctUnpriced,
      totals: {
        cost: acctCostAll,
        marketValue: acctPriced > 0 ? acctMV : null,
        unrealizedPl: acctUnrealizedPl,
        unrealizedPlPct: acctUnrealizedPlPct,
      },
    };
  });

  const grandUnrealizedPl = grandPriced > 0 ? grandMV - grandCostPriced : null;
  const grandUnrealizedPlPct =
    grandUnrealizedPl != null && grandCostPriced > 0
      ? (grandUnrealizedPl / Math.abs(grandCostPriced)) * 100
      : null;

  return NextResponse.json({
    accounts: enrichedAccounts,
    grandTotals: {
      cost: grandCostAll,
      marketValue: grandPriced > 0 ? grandMV : null,
      unrealizedPl: grandUnrealizedPl,
      unrealizedPlPct: grandUnrealizedPlPct,
      pricedCount: grandPriced,
      unpricedCount: grandUnpriced,
    },
    asOf: new Date().toISOString(),
  });
}
