import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { liveQuoteThresholdsForNow } from "@/lib/freshness";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

/**
 * GET /api/journal/trades
 *
 * Broker-primary trade list. For a currently-open holding, the live MooMoo /
 * IBKR `Position` is the source of truth (qty, avg cost, live P&L, state); the
 * matched Google-Sheet row supplies the *plan* (proposed entry/stop/target,
 * strategy, notes). They merge into ONE row — no duplicates. Sheet-only trades
 * (history, or brokers we don't connect to like "Affin Hwang") pass through.
 *
 * Match key: normalized ticker (TENB == US.TENB) + normalized broker
 * ("Moo Moo" / "moomoo Malaysia" -> moomoo; "IBKR" -> ibkr).
 */

/** Map any broker label to a canonical key. */
function brokerKey(s: string | null | undefined): string {
  const n = (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (n.includes("moomoo") || n.includes("futu")) return "moomoo";
  if (n.includes("ibkr") || n.includes("interactivebrokers")) return "ibkr";
  if (n.includes("tiger")) return "tiger";
  return n || "unknown";
}
/** Strip the "US." / "HK." market prefix from a broker ticker. */
function plainTicker(t: string): string {
  return t.replace(/^[A-Za-z]{2}\./, "").toUpperCase();
}
const OPEN_STATES = ["OPEN", "SEMI-OPEN", "PLANNING"];
function isOpenish(state: string | null, pnl: unknown): boolean {
  return (state != null && OPEN_STATES.includes(state.toUpperCase())) || (state == null && pnl == null);
}
function toNum(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canSeePersonalBook(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userScopeId = scopeUserId(session)!;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit = 50;
  const symbol = searchParams.get("symbol")?.trim().toUpperCase() ?? "";
  const side = searchParams.get("side") ?? "";
  const result = searchParams.get("result") ?? "";
  const stateFilter = searchParams.get("state") ?? "";
  const liveQuoteStaleMs = liveQuoteThresholdsForNow().staleSec * 1000;

  // ── Live broker positions: truth for currently-open holdings ──────────────
  const positions = await prisma.position.findMany({
    where: { brokerAccount: { userId: userScopeId } },
    select: {
      ticker: true, qty: true, avgCost: true, currentPrice: true,
      unrealizedPl: true, unrealizedPlPct: true, openedAt: true,
      brokerAccount: { select: { alias: true } },
    },
  });
  const posByKey = new Map<string, (typeof positions)[number]>();
  for (const p of positions) {
    posByKey.set(`${plainTicker(p.ticker)}|${brokerKey(p.brokerAccount.alias)}`, p);
  }
  const positionSymbols = Array.from(new Set(positions.map((p) => plainTicker(p.ticker))));
  const liveQuotes = positionSymbols.length
    ? await prisma.liveQuote.findMany({
        where: { symbol: { in: positionSymbols } },
        select: { symbol: true, price: true, observedAt: true, source: true },
      })
    : [];
  const liveQuoteBySymbol = new Map(liveQuotes.map((q) => [q.symbol, q]));

  function liveFieldsForPosition(p: (typeof positions)[number]) {
    const ticker = plainTicker(p.ticker);
    const quote = liveQuoteBySymbol.get(ticker);
    const qty = toNum(p.qty) ?? 0;
    const avgCost = toNum(p.avgCost) ?? 0;
    const fallbackPrice = toNum(p.currentPrice);
    const quotePrice = toNum(quote?.price);
    const currentPrice = quotePrice ?? fallbackPrice;
    const marketValue = currentPrice == null ? null : qty * currentPrice;
    const cost = qty * avgCost;
    const computedPl = marketValue == null ? null : marketValue - cost;
    const liveUnrealizedPl = computedPl ?? toNum(p.unrealizedPl);
    const liveUnrealizedPlPct =
      computedPl != null && cost !== 0
        ? (computedPl / Math.abs(cost)) * 100
        : toNum(p.unrealizedPlPct);
    const priceObservedAt = quote?.observedAt ?? null;
    const stale = !priceObservedAt || Date.now() - priceObservedAt.getTime() > liveQuoteStaleMs;
    return {
      currentPrice,
      marketValue,
      liveUnrealizedPl,
      liveUnrealizedPlPct,
      priceObservedAt,
      priceSource: quote?.source ?? null,
      stale,
    };
  }

  // Positions already represented by an OPEN sheet row anywhere (so we don't
  // also synthesize a broker-only row for them).
  const openSheet = await prisma.tradeRecord.findMany({
    where: { userId: userScopeId, OR: [{ state: { in: OPEN_STATES } }, { state: null, pnl: null }] },
    select: { ticker: true, platform: true },
  });
  const openSheetKeys = new Set(openSheet.map((t) => `${plainTicker(t.ticker)}|${brokerKey(t.platform)}`));

  const where: Prisma.TradeRecordWhereInput = {
    userId: userScopeId,
    ...(symbol ? { ticker: { contains: symbol } } : {}),
    ...(side ? { side } : {}),
    ...(stateFilter ? { state: stateFilter } : {}),
    ...(result === "win"
      ? { pnl: { gt: 0 }, NOT: { state: { in: OPEN_STATES } } }
      : result === "loss"
      ? { pnl: { lte: 0 }, NOT: { state: { in: OPEN_STATES } } }
      : result === "open"
      ? { OR: [{ state: { in: OPEN_STATES } }, { state: null, pnl: null }] }
      : {}),
  };

  const trades = await prisma.tradeRecord.findMany({
    where,
    orderBy: { tradeDate: "desc" },
    select: {
      id: true, ticker: true, tradeDate: true, buyPrice: true, quantity: true,
      exitPrice: true, side: true, fees: true, pnl: true, notes: true,
      proposedEntry: true, proposedSL: true, proposedTP: true,
      rrr: true, riskPct: true, rewardPct: true, positionPct: true,
      currency: true, platform: true, industry: true, strategy: true,
      state: true,
      verdict: true, verdictScore: true, verdictGeneratedAt: true,
    },
  });

  // Enrich: overlay live broker truth onto matching open sheet rows.
  const enriched = trades.map((t) => {
    const pos = posByKey.get(`${plainTicker(t.ticker)}|${brokerKey(t.platform)}`);
    if (pos && isOpenish(t.state, t.pnl)) {
      const live = liveFieldsForPosition(pos);
      return {
        ...t,
        quantity: pos.qty,        // broker = truth
        buyPrice: pos.avgCost,    // broker avg cost
        pnl: null,
        sheetPnl: t.pnl != null ? Number(t.pnl) : null,
        currentPrice: live.currentPrice,
        marketValue: live.marketValue,
        liveUnrealizedPl: live.liveUnrealizedPl,
        liveUnrealizedPlPct: live.liveUnrealizedPlPct,
        priceObservedAt: live.priceObservedAt,
        priceSource: live.priceSource,
        stale: live.stale,
        state: "OPEN",
        source: "LIVE" as const,
        broker: pos.brokerAccount.alias,
        hasPlan: t.proposedEntry != null || t.proposedSL != null || t.proposedTP != null,
      };
    }
    return { ...t, source: "SHEET" as const };
  });

  function syntheticMatchesFilters(row: { ticker: string; side: string; state: string }) {
    if (symbol && !row.ticker.includes(symbol)) return false;
    if (side && row.side !== side) return false;
    if (stateFilter && row.state !== stateFilter) return false;
    if (result && result !== "open") return false;
    return true;
  }
  const brokerOnly = positions
    .filter((p) => !openSheetKeys.has(`${plainTicker(p.ticker)}|${brokerKey(p.brokerAccount.alias)}`))
    .map((p) => {
      const ticker = plainTicker(p.ticker);
      const live = liveFieldsForPosition(p);
      return {
        id: `pos-${ticker}-${brokerKey(p.brokerAccount.alias)}`,
        ticker,
        tradeDate: p.openedAt,
        buyPrice: p.avgCost,
        quantity: p.qty,
        exitPrice: null,
        side: "Long",
        fees: null,
        pnl: null,
        notes: null,
        proposedEntry: null,
        proposedSL: null,
        proposedTP: null,
        rrr: null,
        riskPct: null,
        rewardPct: null,
        positionPct: null,
        currency: null,
        platform: p.brokerAccount.alias,
        industry: null,
        strategy: null,
        state: "OPEN",
        verdict: null,
        verdictScore: null,
        verdictGeneratedAt: null,
        currentPrice: live.currentPrice,
        marketValue: live.marketValue,
        liveUnrealizedPl: live.liveUnrealizedPl,
        liveUnrealizedPlPct: live.liveUnrealizedPlPct,
        priceObservedAt: live.priceObservedAt,
        priceSource: live.priceSource,
        stale: live.stale,
        source: "LIVE" as const,
        broker: p.brokerAccount.alias,
        hasPlan: false,
        synthetic: true,
      };
    })
    .filter(syntheticMatchesFilters);

  const combined = [...brokerOnly, ...enriched].sort((a, b) => {
    const at = a.tradeDate ? new Date(a.tradeDate).getTime() : 0;
    const bt = b.tradeDate ? new Date(b.tradeDate).getTime() : 0;
    return bt - at;
  });
  const total = combined.length;
  const start = (page - 1) * limit;
  const pageRows = combined.slice(start, start + limit);

  return NextResponse.json({
    trades: pageRows,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
}
