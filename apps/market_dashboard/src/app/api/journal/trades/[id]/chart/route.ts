import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { features } from "@/lib/features";
import { prisma } from "@/lib/prisma";
import { toYahooSymbol } from "@/lib/symbol-format";
import { plainTicker } from "@/lib/trade-episodes";
import { NextResponse } from "next/server";
import yahooFinance from "yahoo-finance2";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

type ChartBar = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function finite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function GET(_req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!features.brokerJournal) {
    return NextResponse.json({ error: "Journal feature unavailable" }, { status: 404 });
  }
  if (!canSeePersonalBook(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const userScopeId = scopeUserId(session)!;
  const trade = await prisma.tradeRecord.findFirst({
    where: { id, userId: userScopeId },
    select: {
      ticker: true,
      tradeDate: true,
      executedAt: true,
      pnl: true,
      state: true,
      fills: {
        where: { side: "SELL" },
        orderBy: { executedAt: "desc" },
        take: 1,
        select: { executedAt: true },
      },
    },
  });
  if (!trade) return NextResponse.json({ error: "Trade not found" }, { status: 404 });

  const entryAt = trade.executedAt ?? trade.tradeDate ?? new Date();
  const state = trade.state?.toUpperCase() ?? "";
  const isOpen = trade.pnl == null || state === "OPEN" || state === "SEMI-OPEN" || state === "PLANNING";
  const period1 = addDays(entryAt, -45);
  const desiredEnd = isOpen
    ? addDays(new Date(), 1)
    : addDays(trade.fills[0]?.executedAt ?? addDays(entryAt, 60), 5);
  const latestEnd = addDays(new Date(), 1);
  const period2 = desiredEnd.getTime() > latestEnd.getTime() ? latestEnd : desiredEnd;

  let bars: ChartBar[] = [];
  let source: "yahoo" | "broker" | "position-tracker" | null = null;
  try {
    const result = await yahooFinance.chart(toYahooSymbol(trade.ticker), {
      period1,
      period2,
      interval: "1d",
    });
    bars = result.quotes.flatMap((row) => {
      const open = finite(row.open);
      const high = finite(row.high);
      const low = finite(row.low);
      const close = finite(row.close);
      if (open == null || high == null || low == null || close == null) return [];
      return [{
        time: row.date.toISOString().slice(0, 10),
        open,
        high,
        low,
        close,
        volume: finite(row.volume),
      }];
    });
    if (bars.length) source = "yahoo";
  } catch (error) {
    console.warn(`[journal/chart] Yahoo history failed for ${trade.ticker}:`, error);
  }

  if (!bars.length) {
    const ticker = plainTicker(trade.ticker).replace(/\.KL$/i, "");
    const brokerRows = await prisma.brokerDailyBar.findMany({
      where: {
        ticker,
        date: { gte: period1, lte: period2 },
      },
      orderBy: { date: "asc" },
      take: 180,
    });
    bars = brokerRows.flatMap((row) => {
      const open = finite(row.open);
      const high = finite(row.high);
      const low = finite(row.low);
      const close = finite(row.close);
      if (open == null || high == null || low == null || close == null) return [];
      return [{
        time: row.date.toISOString().slice(0, 10),
        open,
        high,
        low,
        close,
        volume: finite(row.volume),
      }];
    });
    if (bars.length) source = "broker";

    if (!bars.length) {
      const trackedRows = await prisma.positionDailyTrack.findMany({
        where: {
          candidate: { userId: userScopeId, ticker },
          sessionDate: { gte: period1, lte: period2 },
        },
        orderBy: [{ sessionDate: "asc" }, { createdAt: "asc" }],
        take: 500,
        select: {
          sessionDate: true,
          open: true,
          high: true,
          low: true,
          close: true,
          volume: true,
        },
      });
      const trackedByDate = new Map<string, ChartBar>();
      for (const row of trackedRows) {
        const open = finite(row.open);
        const high = finite(row.high);
        const low = finite(row.low);
        const close = finite(row.close);
        if (open == null || high == null || low == null || close == null) continue;
        const time = row.sessionDate.toISOString().slice(0, 10);
        trackedByDate.set(time, {
          time,
          open,
          high,
          low,
          close,
          volume: finite(row.volume),
        });
      }
      bars = Array.from(trackedByDate.values()).sort((left, right) => left.time.localeCompare(right.time));
      if (bars.length) source = "position-tracker";
    }
  }

  const response = NextResponse.json({ bars: bars.slice(-180), source });
  response.headers.set("Cache-Control", "private, max-age=300");
  return response;
}
