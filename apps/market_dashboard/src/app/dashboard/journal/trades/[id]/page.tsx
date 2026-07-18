import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { features } from "@/lib/features";
import { prisma } from "@/lib/prisma";
import { reportedPnlUsd } from "@/lib/currency";
import {
  buildEpisodes,
  pickEpisodeForRecord,
  plainTicker,
  type FillLike,
} from "@/lib/trade-episodes";
import JournalEditorClient from "@/components/journal/JournalEditorClient";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

const tradeOrder = [
  { tradeDate: "desc" as const },
  { executedAt: "desc" as const },
  { id: "asc" as const },
];

function jsonStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function dec(value: { toString(): string } | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function tickerKey(value: string): string {
  return plainTicker(value).replace(/\.KL$/i, "");
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export default async function JournalEditorPage({ params }: Props) {
  if (!features.brokerJournal) {
    return (
      <section className="market-panel p-6">
        <h1 className="mb-2 text-[22px] font-extrabold text-[var(--fg-1)]">Journal entry</h1>
        <p className="text-sm text-[var(--fg-3)]">This feature is not yet enabled in this environment.</p>
      </section>
    );
  }
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!canSeePersonalBook(session)) {
    return (
      <section className="market-panel p-6">
        <p className="t-caption">Journal details are available after account approval.</p>
      </section>
    );
  }

  const { id } = await params;
  const userScopeId = scopeUserId(session)!;
  const trade = await prisma.tradeRecord.findFirst({
    where: { id, userId: userScopeId },
    select: {
      id: true,
      brokerAccountId: true,
      ticker: true,
      side: true,
      buyPrice: true,
      quantity: true,
      exitPrice: true,
      pnl: true,
      pnlUsd: true,
      fees: true,
      tradeDate: true,
      executedAt: true,
      industry: true,
      strategy: true,
      notes: true,
      thoughts: true,
      state: true,
      proposedEntry: true,
      proposedSL: true,
      proposedTP: true,
      rrr: true,
      riskPct: true,
      rewardPct: true,
      positionPct: true,
      currency: true,
      currencyCode: true,
      platform: true,
      tags: true,
      screenshots: true,
      mistakes: true,
      verdict: true,
      verdictScore: true,
      verdictGeneratedAt: true,
      syncedAt: true,
      fills: {
        orderBy: [{ executedAt: "asc" }, { id: "asc" }],
        take: 100,
        select: {
          id: true,
          ticker: true,
          side: true,
          qty: true,
          price: true,
          executedAt: true,
          fees: true,
          currency: true,
          source: true,
          tradeRecordId: true,
        },
      },
      verdictHistory: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          provider: true,
          model: true,
          kind: true,
          score: true,
          verdict: true,
          createdAt: true,
        },
      },
      journalLogs: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          kind: true,
          body: true,
          createdAt: true,
        },
      },
    },
  });
  if (!trade) {
    return (
      <section className="market-panel p-6">
        <h1 className="mb-2 text-[22px] font-extrabold text-[var(--loss-fg)]">Trade not found</h1>
        <p className="text-sm text-[var(--fg-3)]">This trade either does not exist or does not belong to you.</p>
      </section>
    );
  }

  const neighborSelect = { id: true, ticker: true } as const;
  const anchor = trade.executedAt ?? trade.tradeDate;
  const [newerRows, olderRows, nearbyFills] = await Promise.all([
    prisma.tradeRecord.findMany({
      where: {
        userId: userScopeId,
        AND: [
          { OR: [{ brokerOrderId: null }, { NOT: { brokerOrderId: { endsWith: ":dup" } } }] },
          { OR: [{ brokerAccountId: null }, { brokerAccount: { isLive: true } }] },
        ],
      },
      orderBy: tradeOrder,
      cursor: { id: trade.id },
      skip: 1,
      take: -1,
      select: neighborSelect,
    }),
    prisma.tradeRecord.findMany({
      where: {
        userId: userScopeId,
        AND: [
          { OR: [{ brokerOrderId: null }, { NOT: { brokerOrderId: { endsWith: ":dup" } } }] },
          { OR: [{ brokerAccountId: null }, { brokerAccount: { isLive: true } }] },
        ],
      },
      orderBy: tradeOrder,
      cursor: { id: trade.id },
      skip: 1,
      take: 1,
      select: neighborSelect,
    }),
    trade.brokerAccountId && anchor
      ? prisma.tradeFill.findMany({
          where: {
            brokerAccountId: trade.brokerAccountId,
            executedAt: { gte: addDays(anchor, -3), lte: addDays(new Date(), 1) },
          },
          orderBy: [{ executedAt: "asc" }, { id: "asc" }],
          take: 1000,
          select: {
            id: true,
            ticker: true,
            side: true,
            qty: true,
            price: true,
            executedAt: true,
            fees: true,
            currency: true,
            source: true,
            tradeRecordId: true,
          },
        })
      : Promise.resolve([]),
  ]);
  const newer = newerRows[0] ?? null;
  const older = olderRows[0] ?? null;

  let displayFills = trade.fills;
  if (nearbyFills.length) {
    const sameTickerFills = nearbyFills.filter((fill) => tickerKey(fill.ticker) === tickerKey(trade.ticker));
    const fillLikes: FillLike[] = sameTickerFills.map((fill) => ({
      id: fill.id,
      ticker: fill.ticker,
      side: fill.side,
      qty: Number(fill.qty),
      price: Number(fill.price),
      fees: fill.fees == null ? null : Number(fill.fees),
      currency: fill.currency,
      executedAt: fill.executedAt,
      tradeRecordId: fill.tradeRecordId,
    }));
    const episode = pickEpisodeForRecord(buildEpisodes(fillLikes), {
      ticker: trade.ticker,
      quantity: dec(trade.quantity),
      buyPrice: dec(trade.buyPrice),
      tradeDate: trade.tradeDate,
      executedAt: trade.executedAt,
      state: trade.state,
    });
    if (episode) {
      const episodeIds = new Set(episode.fillIds);
      const merged = new Map(trade.fills.map((fill) => [fill.id, fill]));
      for (const fill of sameTickerFills) {
        if (episodeIds.has(fill.id)) merged.set(fill.id, fill);
      }
      displayFills = Array.from(merged.values()).sort((left, right) =>
        left.executedAt.getTime() - right.executedAt.getTime() || left.id.localeCompare(right.id));
    }
  }

  const verdictHistory = trade.verdictHistory.map((item) => ({
    id: item.id,
    provider: item.provider,
    model: item.model,
    kind: item.kind,
    score: item.score,
    verdict: jsonObject(item.verdict) ?? {},
    createdAt: item.createdAt.toISOString(),
  }));
  const cachedVerdict = jsonObject(trade.verdict);
  if (!verdictHistory.length && cachedVerdict) {
    verdictHistory.push({
      id: `cached-${trade.id}`,
      provider: "cached",
      model: "latest",
      kind: "day-0",
      score: trade.verdictScore,
      verdict: cachedVerdict,
      createdAt: trade.verdictGeneratedAt?.toISOString() ?? trade.syncedAt.toISOString(),
    });
  }

  const reportedPnl = reportedPnlUsd({
    pnlUsd: dec(trade.pnlUsd),
    rawPnl: dec(trade.pnl),
    currencyCode: trade.currencyCode ?? trade.currency,
  });
  const tradeSerialized = {
    id: trade.id,
    ticker: trade.ticker,
    side: trade.side,
    buyPrice: dec(trade.buyPrice),
    quantity: dec(trade.quantity),
    exitPrice: dec(trade.exitPrice),
    pnl: reportedPnl.value,
    pnlCurrency: reportedPnl.currencyCode,
    pnlUnconverted: reportedPnl.unconverted,
    fees: dec(trade.fees),
    tradeDate: trade.tradeDate?.toISOString() ?? null,
    executedAt: trade.executedAt?.toISOString() ?? null,
    industry: trade.industry,
    strategy: trade.strategy,
    notes: trade.notes,
    thoughts: trade.thoughts,
    state: trade.state,
    proposedEntry: dec(trade.proposedEntry),
    proposedSL: dec(trade.proposedSL),
    proposedTP: dec(trade.proposedTP),
    rrr: dec(trade.rrr),
    riskPct: dec(trade.riskPct),
    rewardPct: dec(trade.rewardPct),
    positionPct: dec(trade.positionPct),
    currency: trade.currencyCode ?? trade.currency,
    platform: trade.platform,
    tags: jsonStringArray(trade.tags),
    screenshots: jsonStringArray(trade.screenshots),
    mistakes: jsonStringArray(trade.mistakes),
    fills: displayFills.map((fill) => ({
      id: fill.id,
      side: fill.side,
      qty: dec(fill.qty),
      price: dec(fill.price),
      executedAt: fill.executedAt.toISOString(),
      fees: dec(fill.fees),
      currency: fill.currency,
      source: fill.source,
    })),
    verdictHistory,
    journalLogs: trade.journalLogs.map((item) => ({
      id: item.id,
      kind: item.kind,
      body: item.body,
      createdAt: item.createdAt.toISOString(),
    })),
    newerTrade: newer ? { id: newer.id, ticker: newer.ticker } : null,
    olderTrade: older ? { id: older.id, ticker: older.ticker } : null,
  };

  return <JournalEditorClient key={trade.id} trade={tradeSerialized} />;
}
