"use client";

import { useState } from "react";

type DayData = { date: string; pnl: number; trades: number };

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

export default function CalendarView({ calendarData }: { calendarData: DayData[] }) {
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

  return (
    <div className="space-y-4">
      {/* Month header */}
      <div className="flex items-center justify-between">
        <button onClick={prevMonth} className="rounded bg-slate-700 hover:bg-slate-600 px-3 py-1 text-sm">←</button>
        <h2 className="text-base font-semibold">{MONTHS[month]} {year}</h2>
        <button onClick={nextMonth} className="rounded bg-slate-700 hover:bg-slate-600 px-3 py-1 text-sm">→</button>
      </div>

      {/* Monthly summary bar */}
      <div className="grid grid-cols-4 gap-2 text-center text-sm rounded-lg p-3" style={{ background: "#111b27", border: "1px solid #1e2d3d" }}>
        <div>
          <p className="text-xs text-slate-400">Month P&L</p>
          <p className={`font-semibold ${monthPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
            {monthPnl >= 0 ? "+" : ""}${monthPnl.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-400">Trades</p>
          <p className="font-semibold">{monthTrades}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">Trading Days</p>
          <p className="font-semibold">{monthDays.length}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">Day Win Rate</p>
          <p className={`font-semibold ${monthWr >= 50 ? "text-green-400" : "text-red-400"}`}>{monthWr}%</p>
        </div>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-1 text-xs text-slate-500 text-center">
        {DAYS.map((d) => <div key={d}>{d}</div>)}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const data = dayMap[dateStr];
          const isToday = dateStr === new Date().toISOString().slice(0, 10);

          return (
            <div
              key={i}
              className={`rounded p-1.5 min-h-[56px] text-xs ${data ? (data.pnl >= 0 ? "bg-green-900/30 border border-green-800/40" : "bg-red-900/30 border border-red-800/40") : "bg-slate-800/30 border border-slate-700/30"} ${isToday ? "ring-1 ring-blue-500" : ""}`}
            >
              <p className={`font-medium mb-0.5 ${isToday ? "text-blue-400" : "text-slate-400"}`}>{day}</p>
              {data && (
                <>
                  <p className={`font-semibold ${data.pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {data.pnl >= 0 ? "+" : ""}${Math.abs(data.pnl).toFixed(0)}
                  </p>
                  <p className="text-slate-500">{data.trades}t</p>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
