"use client";

/**
 * JournalCalendarClient — dedicated Calendar page for the Journal surface
 * (TradesViz-platform P1-🄺). Fetches the caller's own journal stats and renders
 * the (Codex-upgraded, day-drilldown) CalendarView on its own route instead of
 * being buried inside the Equity page.
 */
import { useEffect, useState } from "react";
import CalendarView from "@/components/journal/CalendarView";
import type { JournalCalendarDay } from "@/lib/journal/calendar-data";

export default function JournalCalendarClient() {
  const [days, setDays] = useState<JournalCalendarDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    fetch("/api/journal/stats", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => {
        if (!off) setDays(Array.isArray(j?.calendarData) ? j.calendarData : []);
      })
      .catch((e) => !off && setError((e as Error).message));
    return () => {
      off = true;
    };
  }, []);

  if (error) return <p className="p-5 t-caption text-[var(--loss-fg)]">Failed to load calendar: {error}</p>;
  if (days == null) return <p className="p-5 t-caption text-[var(--fg-3)]">Loading calendar…</p>;
  return (
    <div className="p-1">
      <CalendarView calendarData={days} currencySymbol="$" />
    </div>
  );
}
