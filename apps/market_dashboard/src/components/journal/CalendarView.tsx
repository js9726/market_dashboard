"use client";

import Link from "next/link";
import { useState } from "react";
import Icon from "@/components/market-desk/Icon";
import type { JournalCalendarDay } from "@/lib/journal/calendar-data";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function signedMoney(value: number, symbol: string): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${symbol}${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function compactMoney(value: number, symbol: string): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  if (absolute >= 1000) return `${sign}${symbol}${(absolute / 1000).toFixed(absolute >= 10_000 ? 0 : 1)}k`;
  return `${sign}${symbol}${absolute.toFixed(0)}`;
}

function displayDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function localDateKey(value: Date): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

export default function CalendarView({
  calendarData,
  currencySymbol = "$",
}: {
  calendarData: JournalCalendarDay[];
  currencySymbol?: string;
}) {
  const now = new Date();
  const today = localDateKey(now);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const dayMap: Record<string, JournalCalendarDay> = {};
  for (const day of calendarData) dayMap[day.date] = day;

  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
  const monthDays = calendarData.filter((day) => day.date.startsWith(monthKey));
  const realizedDays = monthDays.filter((day) => day.realizedTrades > 0);
  const monthPnl = monthDays.reduce((sum, day) => sum + day.pnl, 0);
  const monthTrades = monthDays.reduce((sum, day) => sum + day.trades, 0);
  const monthWins = realizedDays.filter((day) => day.pnl > 0).length;
  const monthWinRate = realizedDays.length ? Math.round((monthWins / realizedDays.length) * 100) : 0;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  function changeMonth(direction: -1 | 1) {
    setSelectedDate(null);
    if (direction === -1) {
      if (month === 0) {
        setMonth(11);
        setYear((value) => value - 1);
      } else {
        setMonth((value) => value - 1);
      }
    } else if (month === 11) {
      setMonth(0);
      setYear((value) => value + 1);
    } else {
      setMonth((value) => value + 1);
    }
  }

  const selectedDay = selectedDate ? dayMap[selectedDate] ?? null : null;
  const navButton = "mds-button mds-button--icon h-9 w-9";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button aria-label="Previous month" className={navButton} onClick={() => changeMonth(-1)} type="button">
          <Icon className="h-4 w-4" name="chevron-left" />
        </button>
        <h2 className="text-base font-semibold text-[var(--fg-1)]">{MONTHS[month]} {year}</h2>
        <button aria-label="Next month" className={navButton} onClick={() => changeMonth(1)} type="button">
          <Icon className="h-4 w-4" name="chevron-right" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 border-y border-[var(--line)] py-3 text-center text-sm sm:grid-cols-4">
        <div>
          <p className="text-[11px] text-[var(--fg-3)]">Month P&amp;L</p>
          <p className={`font-mono font-semibold tabular-nums ${monthPnl >= 0 ? "text-[var(--gain-fg)]" : "text-[var(--loss-fg)]"}`}>
            {signedMoney(monthPnl, currencySymbol)}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-[var(--fg-3)]">Trades</p>
          <p className="font-mono font-semibold text-[var(--fg-1)]">{monthTrades}</p>
        </div>
        <div>
          <p className="text-[11px] text-[var(--fg-3)]">Trading days</p>
          <p className="font-mono font-semibold text-[var(--fg-1)]">{monthDays.length}</p>
        </div>
        <div>
          <p className="text-[11px] text-[var(--fg-3)]">Realized day win rate</p>
          <p className={`font-mono font-semibold ${monthWinRate >= 50 ? "text-[var(--gain-fg)]" : "text-[var(--loss-fg)]"}`}>
            {monthWinRate}%
          </p>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase text-[var(--fg-3)] sm:text-xs">
        {DAYS.map((day) => <div key={day}>{day}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, index) => {
          if (!day) return <div aria-hidden="true" key={`empty-${index}`} />;
          const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const data = dayMap[date];
          const isToday = date === today;
          const isSelected = selectedDate === date;
          const tone = data?.realizedTrades
            ? data.pnl >= 0
              ? "border-[var(--gain-cell-bg)] bg-[var(--gain-cell-bg)]"
              : "border-[var(--loss-cell-bg)] bg-[var(--loss-cell-bg)]"
            : data
              ? "border-[var(--accent)] bg-[var(--accent-soft-bg)]"
              : "border-[var(--line)] bg-[var(--bg-raised)]";

          if (!data) {
            return (
              <div className={`min-h-[58px] rounded-[var(--radius-sm)] border p-1.5 sm:min-h-[72px] ${tone} ${isToday ? "ring-1 ring-[var(--accent)]" : ""}`} key={date}>
                <p className={`text-[11px] font-semibold ${isToday ? "text-[var(--accent)]" : "text-[var(--fg-2)]"}`}>{day}</p>
              </div>
            );
          }

          const label = `${displayDate(date)}: ${data.trades} trades, ${data.openTrades} open${data.realizedTrades ? `, realized P&L ${signedMoney(data.pnl, currencySymbol)}` : ""}`;
          return (
            <button
              aria-label={label}
              aria-pressed={isSelected}
              className={`min-h-[58px] min-w-0 rounded-[var(--radius-sm)] border p-1.5 text-left transition hover:border-[var(--accent)] sm:min-h-[72px] ${tone} ${isToday || isSelected ? "ring-1 ring-[var(--accent)]" : ""}`}
              key={date}
              onClick={() => setSelectedDate((current) => current === date ? null : date)}
              type="button"
            >
              <span className={`block text-[11px] font-semibold ${isToday ? "text-[var(--accent)]" : "text-[var(--fg-2)]"}`}>{day}</span>
              {data.realizedTrades > 0 ? (
                <span className={`block truncate font-mono text-[9px] font-semibold sm:text-[11px] ${data.pnl >= 0 ? "text-[var(--gain-cell-fg)]" : "text-[var(--loss-cell-fg)]"}`}>
                  {compactMoney(data.pnl, currencySymbol)}
                </span>
              ) : null}
              <span className="block truncate text-[9px] text-[var(--fg-3)] sm:text-[10px]">
                {data.trades}t{data.openTrades ? ` · ${data.openTrades} open` : ""}
              </span>
            </button>
          );
        })}
      </div>

      {selectedDay ? (
        <section className="border-t border-[var(--line)] pt-4" aria-live="polite">
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="text-sm font-extrabold text-[var(--fg-1)]">{displayDate(selectedDay.date)}</h3>
              <p className="t-caption">{selectedDay.trades} trade{selectedDay.trades === 1 ? "" : "s"} · {selectedDay.openTrades} open</p>
            </div>
            {selectedDay.realizedTrades > 0 ? (
              <span className={`font-mono text-sm font-extrabold ${selectedDay.pnl >= 0 ? "text-[var(--gain-fg)]" : "text-[var(--loss-fg)]"}`}>
                {signedMoney(selectedDay.pnl, currencySymbol)}
              </span>
            ) : null}
          </div>
          <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
            {selectedDay.items.map((item) => (
              <Link
                className="flex min-h-11 items-center gap-3 px-2 py-2 transition hover:bg-[var(--bg-raised)]"
                href={`/dashboard/journal/trades/${item.id}`}
                key={item.id}
              >
                <span className="t-ticker min-w-0 flex-1 text-[var(--accent)]">{item.ticker}</span>
                <span className="font-mono text-[10px] uppercase text-[var(--fg-3)]">{item.state ?? (item.closed ? "CLOSE" : "OPEN")}</span>
                <span className={`min-w-[72px] text-right font-mono text-[11px] font-bold ${item.pnl == null ? "text-[var(--fg-3)]" : item.pnl >= 0 ? "text-[var(--gain-fg)]" : "text-[var(--loss-fg)]"}`}>
                  {item.pnl == null ? (item.closed ? "No P&L" : "Open") : signedMoney(item.pnl, currencySymbol)}
                </span>
                <Icon className="h-4 w-4 shrink-0 text-[var(--fg-3)]" name="chevron-right" />
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
