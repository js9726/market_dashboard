import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { liveQuoteThresholdsForNow } from "@/lib/freshness";
import { prisma } from "@/lib/prisma";
import {
  activeTradePriority,
  brokerKey,
  isOpenishTrade,
  materializeOpenPositionTradeRecords,
  OPEN_TRADE_STATES,
  plainTicker,
} from "@/lib/trades/position-trade-records";
import type { Prisma } from "@prisma/client";
import { getUsdMyrRate, moneyToUsd } from "@/lib/equity-currency";
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

function toNum(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function dateKey(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
function dateOnly(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}
function operatorFromSheetTab(sheetTab: string | null | undefined): string | null {
  const m = (sheetTab ?? "").match(/\[([A-Za-z0-9]{2,8})\]/);
  return m?.[1]?.toUpperCase() ?? null;
}
function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function gradeFromScore(score: number | null): "A" | "B" | "C" | null {
  if (score == null) return null;
  if (score >= 7) return "A";
  if (score >= 5) return "B";
  return "C";
}
function auditGrade(value: unknown): "A" | "B" | "C" | null {
  return value === "A" || value === "B" || value === "C" ? value : null;
}
function money(value: unknown): string {
  const n = toNum(value);
  return n == null ? "-" : `$${n.toFixed(2)}`;
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
  await materializeOpenPositionTradeRecords(userScopeId, { symbol });
  const liveQuoteStaleMs = liveQuoteThresholdsForNow().staleSec * 1000;
  const connection = await prisma.spreadsheetConnection.findUnique({
    where: { userId: userScopeId },
    select: { sheetTab: true },
  });
  const operatorLabel = operatorFromSheetTab(connection?.sheetTab);
  // Live USD/MYR rate (Frankfurter, cached) to convert non-broker MYR sheet
  // P&L to USD at display time — broker-true pnlUsd (set on the row) wins.
  const fxUsdMyr = await getUsdMyrRate();

  // ── Live broker positions: truth for currently-open holdings ──────────────
  const positions = await prisma.position.findMany({
    where: { brokerAccount: { userId: userScopeId } },
    select: {
      ticker: true, qty: true, avgCost: true, currentPrice: true,
      unrealizedPl: true, unrealizedPlPct: true, openedAt: true,
      brokerAccountId: true,
      brokerAccount: { select: { alias: true } },
    },
  });
  // Two match indexes: exact brokerAccountId (reconciled rows) first, then the
  // legacy alias/platform text key (sheet rows that predate broker linking).
  // Text-only matching let alias variants slip through and produced duplicate
  // synthetic rows (MDB, 2026-06-10).
  const posByKey = new Map<string, (typeof positions)[number]>();
  const posByAccount = new Map<string, (typeof positions)[number]>();
  for (const p of positions) {
    posByKey.set(`${plainTicker(p.ticker)}|${brokerKey(p.brokerAccount.alias)}`, p);
    posByAccount.set(`${plainTicker(p.ticker)}|${p.brokerAccountId}`, p);
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
  // also synthesize a broker-only row for them). Keyed both by accountId and
  // by alias text so either match form suppresses the synthetic row.
  const openSheet = await prisma.tradeRecord.findMany({
    where: { userId: userScopeId, OR: [{ state: { in: [...OPEN_TRADE_STATES] } }, { state: null, pnl: null }] },
    select: { ticker: true, platform: true, brokerAccountId: true },
  });
  const openSheetKeys = new Set<string>();
  for (const t of openSheet) {
    openSheetKeys.add(`${plainTicker(t.ticker)}|${brokerKey(t.platform)}`);
    if (t.brokerAccountId) openSheetKeys.add(`${plainTicker(t.ticker)}|acct:${t.brokerAccountId}`);
  }

  const where: Prisma.TradeRecordWhereInput = {
    userId: userScopeId,
    ...(symbol ? { ticker: { contains: symbol } } : {}),
    ...(side ? { side } : {}),
    ...(stateFilter ? { state: stateFilter } : {}),
    ...(result === "win"
      ? { pnl: { gt: 0 }, NOT: { state: { in: [...OPEN_TRADE_STATES] } } }
      : result === "loss"
      ? { pnl: { lte: 0 }, NOT: { state: { in: [...OPEN_TRADE_STATES] } } }
      : result === "open"
      ? { OR: [{ state: { in: [...OPEN_TRADE_STATES] } }, { state: null, pnl: null }] }
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
      currency: true, currencyCode: true, pnlUsd: true, pnlSource: true,
      platform: true, industry: true, strategy: true, brokerAccountId: true,
      state: true,
      verdict: true, verdictScore: true, verdictGeneratedAt: true,
    },
  });

  // Enrich: overlay live broker truth onto matching open sheet rows.
  // Exact brokerAccountId match wins; alias text match is the legacy fallback.
  const enriched = trades.map((t) => {
    const pos =
      (t.brokerAccountId
        ? posByAccount.get(`${plainTicker(t.ticker)}|${t.brokerAccountId}`)
        : undefined) ?? posByKey.get(`${plainTicker(t.ticker)}|${brokerKey(t.platform)}`);
    if (pos && isOpenishTrade(t.state, t.pnl)) {
      const live = liveFieldsForPosition(pos);
      return {
        ...t,
        quantity: pos.qty,        // broker = truth
        buyPrice: pos.avgCost,    // broker avg cost
        pnl: null,
        pnlUsd: null,             // open holding — realized USD is N/A; live unrealized below
        currencyCode: "USD",
        pnlSource: "broker",
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
    // Non-broker sheet row: if the P&L is in a non-USD sheet currency (MYR) and
    // no broker-true pnlUsd is stored, convert at the LIVE FX rate so the table
    // shows USD (original currency stays on the row for the RM-on-hover label).
    const cc = t.currencyCode ?? t.currency;
    if (t.pnlUsd == null && t.pnl != null && cc != null && cc.toUpperCase() !== "USD") {
      const usd = moneyToUsd(toNum(t.pnl), cc, fxUsdMyr);
      if (usd != null) {
        return { ...t, pnlUsd: usd, pnlSource: "live-fx", source: "SHEET" as const, broker: t.platform };
      }
    }
    return { ...t, source: "SHEET" as const, broker: t.platform };
  });

  // One LIVE row per held position. A materialized bridge row AND a sheet/import
  // row can both be open for the same holding (MDB, 2026-06-10) — they're the
  // same position, not two trades. Keep the richer row (verdict > plan > first).
  const liveRichness = (r: { verdict?: unknown; hasPlan?: boolean }) =>
    (r.verdict != null ? 2 : 0) + (r.hasPlan ? 1 : 0);
  const liveIndexByKey = new Map<string, number>();
  const enrichedDeduped: typeof enriched = [];
  for (const row of enriched) {
    if (row.source !== "LIVE") {
      enrichedDeduped.push(row);
      continue;
    }
    const key = `${plainTicker(row.ticker)}|${("broker" in row ? row.broker : null) ?? ""}`;
    const prevIdx = liveIndexByKey.get(key);
    if (prevIdx == null) {
      liveIndexByKey.set(key, enrichedDeduped.length);
      enrichedDeduped.push(row);
    } else if (liveRichness(row) > liveRichness(enrichedDeduped[prevIdx])) {
      enrichedDeduped[prevIdx] = row;
    }
  }

  function syntheticMatchesFilters(row: { ticker: string; side: string; state: string }) {
    if (symbol && !row.ticker.includes(symbol)) return false;
    if (side && row.side !== side) return false;
    if (stateFilter && row.state !== stateFilter) return false;
    if (result && result !== "open") return false;
    return true;
  }
  const brokerOnly = positions
    .filter(
      (p) =>
        !openSheetKeys.has(`${plainTicker(p.ticker)}|${brokerKey(p.brokerAccount.alias)}`) &&
        !openSheetKeys.has(`${plainTicker(p.ticker)}|acct:${p.brokerAccountId}`),
    )
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
        currencyCode: "USD",
        pnlUsd: null,
        pnlSource: "broker",
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

  const combined = [...brokerOnly, ...enrichedDeduped].sort((a, b) => {
    const priority = activeTradePriority(a) - activeTradePriority(b);
    if (priority !== 0) return priority;
    const at = a.tradeDate ? new Date(a.tradeDate).getTime() : 0;
    const bt = b.tradeDate ? new Date(b.tradeDate).getTime() : 0;
    return bt - at;
  });
  const total = combined.length;
  const start = (page - 1) * limit;
  const pageRows = combined.slice(start, start + limit);
  const wikiKeys = pageRows
    .map((row) => ({ ticker: plainTicker(row.ticker), date: dateKey(row.tradeDate) }))
    .filter((row): row is { ticker: string; date: string } => Boolean(row.date));
  const wikiVerdicts = operatorLabel && wikiKeys.length
    ? await prisma.wikiTradeVerdict.findMany({
        where: {
          operatorLabel,
          ticker: { in: Array.from(new Set(wikiKeys.map((row) => row.ticker))) },
          tradeDate: { in: Array.from(new Set(wikiKeys.map((row) => row.date))).map(dateOnly) },
        },
        select: {
          operatorLabel: true,
          intent: true,
          ticker: true,
          tradeDate: true,
          day0Json: true,
          day14Json: true,
          ingestedAt: true,
        },
      })
    : [];
  const wikiByKey = new Map(
    wikiVerdicts.map((row) => [`${dateKey(row.tradeDate)}_${plainTicker(row.ticker)}`, row]),
  );

  function reviewFromWiki(row: (typeof pageRows)[number], wiki: (typeof wikiVerdicts)[number]) {
    const d0 = (wiki.day0Json ?? {}) as Record<string, unknown>;
    const d14 = (wiki.day14Json ?? {}) as Record<string, unknown>;
    const score = toNum(d0.composite_technical_score);
    const qualityGrade = gradeFromScore(score);
    const day14Grade = auditGrade(d14.predicted_vs_actual_match_grade);
    const setup = stringOrNull(d0.setup_classification);
    const setupJustification = stringOrNull(d0.setup_justification);
    const predictedOutcome = stringOrNull(d0.predicted_outcome);
    const day14Notes = stringOrNull(d14.match_notes);
    const bestStyle = stringOrNull(d0.best_style_match);
    const weakestDimension = stringOrNull(d0.weakest_dimension);
    const traderScores = (d0.trader_scores ?? {}) as Record<string, Record<string, unknown>>;
    const traderReviews = Object.entries(traderScores).map(([handle, s]) => ({
      handle,
      entry_score: toNum(s.entry) ?? 0,
      risk_score: toNum(s.risk) ?? 0,
      setup_score: toNum(s.setup) ?? 0,
      total_score: toNum(s.total) ?? 0,
      verdict: stringOrNull(s.would_enter) ?? "Review",
      note: stringOrNull(s.why) ?? "",
    }));
    const date = dateKey(wiki.tradeDate)!;
    const op = encodeURIComponent(wiki.operatorLabel);
    const normalizedTicker = plainTicker(wiki.ticker);
    const day0Url = wiki.day0Json
      ? `/api/wiki/trades/${date}/${encodeURIComponent(normalizedTicker)}/day0?operator=${op}`
      : null;
    const day14Url = wiki.day14Json
      ? `/api/wiki/trades/${date}/${encodeURIComponent(normalizedTicker)}/day14?operator=${op}`
      : null;

    return {
      verdict: {
        ticker: row.ticker,
        sector: "",
        industry: row.industry ?? "",
        market_cap_tier: "",
        is_open: row.pnl == null,
        trader_reviews: traderReviews,
        best_match: bestStyle ?? "",
        weakest_dimension: weakestDimension ?? "",
        bull_case: setupJustification ? [setupJustification] : [],
        bear_case: day14Notes ? [day14Notes] : [],
        entry_plan: {
          ideal_entry: row.buyPrice ? money(row.buyPrice) : money(row.proposedEntry),
          stop_loss: money(d0.predicted_stop_price ?? row.proposedSL),
          target_1: money(d0.predicted_exit_price ?? row.proposedTP),
          target_2: "",
          position_size: row.positionPct ? `${row.positionPct.toString()}%` : "",
          batch_sells: [],
        },
        overall_score: score,
        overall_verdict: qualityGrade
          ? `${qualityGrade}-grade${setup ? ` ${setup}` : ""}`
          : "Wiki verdict",
        lesson: [predictedOutcome, day14Notes ? `Day-14 audit: ${day14Notes}` : null]
          .filter(Boolean)
          .join(" "),
      },
      verdictScore: score,
      verdictGeneratedAt: stringOrNull(d0.verdict_timestamp) ?? wiki.ingestedAt.toISOString(),
      wikiVerdict: {
        source: "WikiTradeVerdict",
        operatorLabel: wiki.operatorLabel,
        intent: wiki.intent,
        qualityGrade,
        auditGrade: day14Grade,
        setup,
        model: stringOrNull(d0.model),
        ingestedAt: wiki.ingestedAt.toISOString(),
        day0Url,
        day14Url,
      },
    };
  }

  const enrichedPageRows = pageRows.map((row) => {
    if ((row as { synthetic?: boolean }).synthetic || row.verdict) return row;
    const key = `${dateKey(row.tradeDate)}_${plainTicker(row.ticker)}`;
    const wiki = wikiByKey.get(key);
    if (!wiki?.day0Json) return row;
    return { ...row, ...reviewFromWiki(row, wiki) };
  });

  return NextResponse.json({
    trades: enrichedPageRows,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
}
