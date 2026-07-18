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
import { plainTicker } from "@/lib/trade-episodes";
import { brokerKey } from "@/lib/trades/position-trade-records";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function journalTickerKey(value: string): string {
  return plainTicker(value).replace(/\.KL$/i, "");
}

// Staleness is source-aware: bridge LiveQuote streams near-realtime (15 min),
// while server MarketQuote rows refresh on a deliberately GENTLE cron —
// HOURLY during US market hours as separate once-a-day entries (Vercel Hobby
// rejects any single cron entry that runs more than once per day; this
// exact rule broke all deploys 2026-07-09→10). Hourly cadence gets a 75-min
// stale window so the flag doesn't flap between refreshes.
const STALE_LIVE_MS = 15 * 60 * 1000;
const STALE_MARKET_MS = 75 * 60 * 1000;

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
      if (live.observedAt >= market.observedAt) {
        return {
          ...live,
          symbol: ticker,
          changePct: live.changePct ?? market.changePct,
        };
      }
      return {
        ...market,
        symbol: ticker,
        price: market.price ?? live.price,
        changePct: market.changePct ?? live.changePct,
      };
    })
    .filter((q): q is NonNullable<typeof q> => q != null);

  // Find the latest TradeRecord per (brokerAccountId, ticker) so rows can deep-link
  // to the journal editor without a second round-trip from the UI.
  const accountIds = accounts.map((a) => a.id);
  const brokerKeyCounts = new Map<string, number>();
  for (const account of accounts) {
    const key = brokerKey(account.alias);
    brokerKeyCounts.set(key, (brokerKeyCounts.get(key) ?? 0) + 1);
  }
  const journalTickers = Array.from(new Set(tickerList.flatMap((ticker) => {
    const plain = journalTickerKey(ticker);
    return [ticker, plain, `${plain}.KL`];
  })));
  const tradeRecords =
    accountIds.length && tickers.size
      ? await prisma.tradeRecord.findMany({
          where: {
            // User scope is mandatory even for legacy rows without a linked
            // brokerAccountId. Without it, the lookup scans every user's
            // unlinked journal rows and can return another user's record id.
            userId: userScopeId,
            OR: [
              { brokerAccountId: { in: accountIds } },
              { brokerAccountId: null },
            ],
            ticker: { in: journalTickers },
          },
          select: {
            id: true,
            brokerAccountId: true,
            ticker: true,
            executedAt: true,
            tradeDate: true,
            state: true,
            pnl: true,
            platform: true,
          },
        })
      : [];
  // Open journal rows win for each normalized account/ticker, then newest.
  tradeRecords.sort((left, right) => {
    const leftOpen = left.pnl == null || ["OPEN", "SEMI-OPEN", "PLANNING"].includes(left.state?.toUpperCase() ?? "");
    const rightOpen = right.pnl == null || ["OPEN", "SEMI-OPEN", "PLANNING"].includes(right.state?.toUpperCase() ?? "");
    if (leftOpen !== rightOpen) return leftOpen ? -1 : 1;
    const leftAt = left.executedAt ?? left.tradeDate;
    const rightAt = right.executedAt ?? right.tradeDate;
    return (rightAt?.getTime() ?? 0) - (leftAt?.getTime() ?? 0);
  });
  const tradeIdMap = new Map<string, string>();
  const legacyTradeIdMap = new Map<string, string>();
  for (const t of tradeRecords) {
    const ticker = journalTickerKey(t.ticker);
    if (t.brokerAccountId) {
      const key = `${t.brokerAccountId}|${ticker}`;
      if (!tradeIdMap.has(key)) tradeIdMap.set(key, t.id);
    } else if (t.platform) {
      const key = `${brokerKey(t.platform)}|${ticker}`;
      if (!legacyTradeIdMap.has(key)) legacyTradeIdMap.set(key, t.id);
    }
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
      const brokerPrice = p.currentPrice != null ? toNum(p.currentPrice) : null;
      const currentPrice = quote ? toNum(quote.price) : brokerPrice;
      const marketValue =
        currentPrice != null
          ? qty * currentPrice
          : p.marketValue != null
            ? toNum(p.marketValue)
            : null;
      const unrealizedPl =
        marketValue != null
          ? marketValue - cost
          : p.unrealizedPl != null
            ? toNum(p.unrealizedPl)
            : null;
      const unrealizedPlPct =
        unrealizedPl != null && cost !== 0
          ? (unrealizedPl / Math.abs(cost)) * 100
          : p.unrealizedPlPct != null
            ? toNum(p.unrealizedPlPct)
            : null;

      const priceObservedAt = quote?.observedAt ?? (brokerPrice != null ? p.asOf : null);
      const staleAfterMs = quote?.source === "yahoo" ? STALE_MARKET_MS : STALE_LIVE_MS;
      const stale =
        priceObservedAt == null ||
        now - priceObservedAt.getTime() > staleAfterMs;

      acctCostAll += cost;
      if (marketValue != null) {
        acctCostPriced += cost;
        acctMV += marketValue;
        acctPriced++;
      } else {
        acctUnpriced++;
      }

      const latestTradeRecordId =
        tradeIdMap.get(`${acct.id}|${journalTickerKey(p.ticker)}`) ??
        (brokerKeyCounts.get(brokerKey(acct.alias)) === 1
          ? legacyTradeIdMap.get(`${brokerKey(acct.alias)}|${journalTickerKey(p.ticker)}`) ?? null
          : null);

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
        changePct: quote?.changePct != null ? toNum(quote.changePct) : null,
        openedAt: p.openedAt,
        lastFillAt: p.lastFillAt,
        priceObservedAt,
        priceSource: quote?.source ?? (brokerPrice != null ? "broker-cache" : null),
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

  const totalsFor = (selected: typeof enrichedAccounts) => {
    const cost = selected.reduce((sum, account) => sum + account.totals.cost, 0);
    const marketValue = selected.reduce(
      (sum, account) => sum + (account.totals.marketValue ?? 0),
      0,
    );
    const unrealizedPl = selected.reduce(
      (sum, account) => sum + (account.totals.unrealizedPl ?? 0),
      0,
    );
    const pricedCount = selected.reduce((sum, account) => sum + account.pricedCount, 0);
    const unpricedCount = selected.reduce((sum, account) => sum + account.unpricedCount, 0);
    const pricedCost = marketValue - unrealizedPl;
    return {
      cost,
      marketValue: pricedCount > 0 ? marketValue : null,
      unrealizedPl: pricedCount > 0 ? unrealizedPl : null,
      unrealizedPlPct:
        pricedCount > 0 && pricedCost !== 0
          ? (unrealizedPl / Math.abs(pricedCost)) * 100
          : null,
      pricedCount,
      unpricedCount,
    };
  };

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
    // The Portfolio landing page is a live-book surface. Keep all-account
    // totals for backwards compatibility, but provide explicit scopes so the
    // UI never mixes paper gains into live risk/P&L.
    liveTotals: totalsFor(enrichedAccounts.filter((account) => account.isLive)),
    paperTotals: totalsFor(enrichedAccounts.filter((account) => !account.isLive)),
    asOf: new Date().toISOString(),
  });
}
