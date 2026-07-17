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
import { convertEquitySnapshotToUsd, getUsdMyrRate, normalizeCurrencyCode } from "@/lib/equity-currency";
import { liveQuoteThresholdsForNow } from "@/lib/freshness";
import { prisma } from "@/lib/prisma";
import { computeBrokerRealized } from "@/server/realized-pnl";

export const dynamic = "force-dynamic";

function plainTicker(ticker: string): string {
  return ticker.replace(/^[A-Za-z]{2}\./, "").toUpperCase();
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
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const fxUsdMyr = await getUsdMyrRate();

  const fills = await prisma.tradeFill.findMany({
    where: {
      // Default (all-accounts) view aggregates LIVE accounts only — paper/
      // simulated accounts (isLive=false) are viewable by selecting their
      // accountId explicitly, but must never pollute the real equity curve
      // (2026-07-16, moomoo SIMULATE forward-validation account).
      brokerAccount: accountId ? { userId: userScopeId } : { userId: userScopeId, isLive: true },
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
  const latestByAccount = new Map<string, AccountSnapshotUsd>();
  let repairedSnapshots = 0;
  let skippedSnapshots = 0;
  for (const s of snapshots) {
    // Same isLive rule as the fills query above: without an explicit accountId,
    // paper/simulated account snapshots stay out of the aggregate curve.
    if (!accountId && accountById.get(s.brokerAccountId)?.isLive === false) {
      continue;
    }
    const converted = snapshotToUsd(s, accountById.get(s.brokerAccountId), fxUsdMyr);
    if (!converted) {
      skippedSnapshots += 1;
      continue;
    }
    if (converted.repaired) repairedSnapshots += 1;
    const k = s.snapshotDate.toISOString().slice(0, 10);
    const cur = byDate.get(k) ?? { totalAssets: 0, cash: 0, marketVal: 0 };
    cur.totalAssets += converted.totalAssetsUsd;
    cur.cash += converted.cashUsd;
    cur.marketVal += converted.marketValUsd;
    byDate.set(k, cur);
    const prior = latestByAccount.get(s.brokerAccountId);
    if (!prior || s.snapshotDate > prior.snapshotDate || s.capturedAt > prior.capturedAt) {
      latestByAccount.set(s.brokerAccountId, { ...converted, snapshotDate: s.snapshotDate, capturedAt: s.capturedAt });
    }
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

  return NextResponse.json({
    realized,
    realizedCurrency: "USD",
    realizedGrossUsd: brokerRealized.grossUsd,
    realizedFeesUsd: brokerRealized.feesUsd,
    realizedNetUsd: brokerRealized.netUsd,
    accountValue,
    accountValueCurrency: "USD",
    accountValueSource: accountValue.length > 0 ? "broker-total-assets" : "fallback-cash-plus-positions",
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
    snapshotQuality: {
      repairedSnapshots,
      skippedSnapshots,
    },
    latestAccountBreakdown: Array.from(latestByAccount.entries()).map(([id, row]) => {
      const account = accountById.get(id);
      return {
        id,
        alias: account?.alias ?? "Broker account",
        currency: row.nativeCurrency,
        totalAssets: row.nativeTotalAssets,
        totalAssetsUsd: row.totalAssetsUsd,
        cash: row.nativeCash,
        cashUsd: row.cashUsd,
        marketVal: row.nativeMarketVal,
        marketValUsd: row.marketValUsd,
        repaired: row.repaired,
      };
    }),
    accounts: accounts.map((a) => ({ id: a.id, alias: a.alias, currency: a.displayCurrency ?? a.preset.currency, isLive: a.isLive })),
  });
}

type BrokerAccountForSnapshot = {
  alias: string;
  preset?: { name: string; currency: string } | null;
};

type AccountSnapshotUsd = {
  totalAssetsUsd: number;
  cashUsd: number;
  marketValUsd: number;
  nativeCurrency: string;
  nativeTotalAssets: number;
  nativeCash: number;
  nativeMarketVal: number;
  repaired: boolean;
  snapshotDate: Date;
  capturedAt: Date;
};

function isMoomooMalaysia(account: BrokerAccountForSnapshot | undefined, source: string): boolean {
  const haystack = `${account?.alias ?? ""} ${account?.preset?.name ?? ""} ${source}`.toLowerCase();
  return haystack.includes("moomoo") && (haystack.includes("malaysia") || haystack.includes("futumy"));
}

function snapshotToUsd(
  s: {
    totalAssets: unknown;
    cash: unknown;
    marketVal: unknown;
    currencyCode: string | null;
    source: string;
  },
  account: BrokerAccountForSnapshot | undefined,
  fxUsdMyr: number | null,
): Omit<AccountSnapshotUsd, "snapshotDate" | "capturedAt"> | null {
  const rawTotal = Number(s.totalAssets);
  const rawCash = Number(s.cash);
  const rawMarket = Number(s.marketVal);
  const storedCurrency = normalizeCurrencyCode(s.currencyCode);
  if (![rawTotal, rawCash, rawMarket].every(Number.isFinite)) return null;

  const expected = rawCash + rawMarket;
  const badMoomooTotal =
    isMoomooMalaysia(account, s.source) &&
    storedCurrency === "USD" &&
    expected > 0 &&
    Math.abs(rawTotal - expected) / expected > 0.5;

  if (badMoomooTotal) {
    const converted = convertEquitySnapshotToUsd(
      { totalAssets: expected, cash: rawCash, marketVal: rawMarket, currencyCode: "MYR" },
      fxUsdMyr,
    );
    if (!converted) return null;
    return {
      ...converted,
      nativeCurrency: "MYR",
      nativeTotalAssets: round2(expected),
      nativeCash: round2(rawCash),
      nativeMarketVal: round2(rawMarket),
      repaired: true,
    };
  }

  const converted = convertEquitySnapshotToUsd(
    { totalAssets: rawTotal, cash: rawCash, marketVal: rawMarket, currencyCode: storedCurrency },
    fxUsdMyr,
  );
  if (!converted) return null;
  return {
    ...converted,
    nativeCurrency: storedCurrency,
    nativeTotalAssets: round2(rawTotal),
    nativeCash: round2(rawCash),
    nativeMarketVal: round2(rawMarket),
    repaired: false,
  };
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}
