export type JournalCalendarTrade = {
  id: string;
  ticker: string;
  state: string | null;
  occurredAt: Date | null;
  closed: boolean;
  usdPnl: number | null;
};

export type JournalCalendarItem = {
  id: string;
  ticker: string;
  state: string | null;
  closed: boolean;
  occurredAt: string;
  pnl: number | null;
};

export type JournalCalendarDay = {
  date: string;
  pnl: number;
  trades: number;
  openTrades: number;
  realizedTrades: number;
  items: JournalCalendarItem[];
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function buildJournalCalendarData(trades: JournalCalendarTrade[]): JournalCalendarDay[] {
  const days = new Map<string, JournalCalendarDay>();

  for (const trade of trades) {
    if (!trade.occurredAt || Number.isNaN(trade.occurredAt.getTime())) continue;
    const date = trade.occurredAt.toISOString().slice(0, 10);
    const day = days.get(date) ?? {
      date,
      pnl: 0,
      trades: 0,
      openTrades: 0,
      realizedTrades: 0,
      items: [],
    };
    const realizedPnl = trade.closed && trade.usdPnl != null && Number.isFinite(trade.usdPnl)
      ? trade.usdPnl
      : null;

    day.trades += 1;
    if (trade.closed) {
      if (realizedPnl != null) {
        day.pnl += realizedPnl;
        day.realizedTrades += 1;
      }
    } else {
      day.openTrades += 1;
    }
    day.items.push({
      id: trade.id,
      ticker: trade.ticker,
      state: trade.state,
      closed: trade.closed,
      occurredAt: trade.occurredAt.toISOString(),
      pnl: realizedPnl,
    });
    days.set(date, day);
  }

  return Array.from(days.values())
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((day) => ({
      ...day,
      pnl: round2(day.pnl),
      items: day.items.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)),
    }));
}
