"use client";

import { useState } from "react";

type DayData = { date: string; pnl: number; trades: number };

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

export default function CalendarView({ calendarData, currencySymbol = "$" }: { calendarData: DayData[]; currencySymbol?: string }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const dayMap: Record<string, DayData> = {};
  for (const d of calendarData) dayMap[d.date] = d;

  // Monthly stats
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
  const monthDays = calendarData.filter((d) => d.date.startsWith(monthKey));
  const monthPnl = monthDays.reduce((s, d) => s + d.pnl, 0);
  const monthTrades = monthDays.reduce((s, d) => s + d.trades, 0);
  const monthWins = monthDays.filter((d) => d.pnl > 0).length;
  const monthWr = monthDays.length ? Math.round((monthWins / monthDays.length) * 100) : 0;

  // Build calendar grid
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear((y) => y - 1); }
    else setMonth((m) => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear((y) => y + 1); }
    else setMonth((m) => m + 1);
  }

  const navBtn =
    "rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-raised)] px-3 py-1 text-sm text-[var(--fg-2)] transition hover:bg-[var(--bg-surface)]";

  return (
    <div className="space-y-4">
      {/* Month header */}
      <div className="flex items-center justify-between">
        <button onClick={prevMonth} className={navBtn} aria-label="Previous month">←</button>
        <h2 className="text-base font-semibold text-[var(--fg-1)]">{MONTHS[month]} {year}</h2>
        <button onClick={nextMonth} className={navBtn} aria-label="Next month">→</button>
      </div>

      {/* Monthly summary bar */}
      <div className="grid grid-cols-4 gap-2 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--bg-surface)] p-3 text-center text-sm shadow-[var(--shadow-card)]">
        <div>
          <p className="text-[11px] text-[var(--fg-3)]">Month P&L</p>
          <p className={`font-mono font-semibold tabular-nums ${monthPnl >= 0 ? "text-[var(--gain-fg)]" : "text-[var(--loss-fg)]"}`}>
            {monthPnl >= 0 ? "+" : ""}{currencySymbol}{monthPnl.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-[var(--fg-3)]">Trades</p>
          <p className="font-mono font-semibold text-[var(--fg-1)]">{monthTrades}</p>
        </div>
        <div>
          <p className="text-[11px] text-[var(--fg-3)]">Trading Days</p>
          <p className="font-mono font-semibold text-[var(--fg-1)]">{monthDays.length}</p>
        </div>
        <div>
          <p className="text-[11px] text-[var(--fg-3)]">Day Win Rate</p>
          <p className={`font-mono font-semibold ${monthWr >= 50 ? "text-[var(--gain-fg)]" : "text-[var(--loss-fg)]"}`}>{monthWr}%</p>
        </div>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-[var(--fg-3)]">
        {DAYS.map((d) => <div key={d}>{d}</div>)}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const data = dayMap[dateStr];
          const isToday = dateStr === new Date().toISOString().slice(0, 10);
          const cellBg = data
            ? data.pnl >= 0
              ? "border-[var(--gain-cell-bg)] bg-[var(--gain-cell-bg)]"
              : "border-[var(--loss-cell-bg)] bg-[var(--loss-cell-bg)]"
            : "border-[var(--line)] bg-[var(--bg-raised)]";

          return (
            <div
              key={i}
              className={`min-h-[56px] rounded-[var(--radius-sm)] border p-1.5 text-xs ${cellBg} ${isToday ? "ring-1 ring-[var(--accent)]" : ""}`}
            >
              <p className={`mb-0.5 font-medium ${isToday ? "text-[var(--accent)]" : "text-[var(--fg-2)]"}`}>{day}</p>
              {data && (
                <>
                  <p className={`font-mono font-semibold tabular-nums ${data.pnl >= 0 ? "text-[var(--gain-cell-fg)]" : "text-[var(--loss-cell-fg)]"}`}>
                    {data.pnl >= 0 ? "+" : ""}{currencySymbol}{Math.abs(data.pnl).toFixed(0)}
                  </p>
                  <p className="text-[var(--fg-3)]">{data.trades}t</p>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
