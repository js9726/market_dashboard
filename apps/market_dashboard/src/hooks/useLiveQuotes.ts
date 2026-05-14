"use client";

import { useEffect, useRef, useState } from "react";

export interface LiveQuoteRow {
  symbol: string;
  price: number;
  changePct: number | null;
  volume: number | null;
  source: string;
  observedAt: string;
  stale: boolean;
}

export interface LiveQuotesResponse {
  activeSource: string | null;
  activeSourceAt: string | null;
  quotes: LiveQuoteRow[];
}

/**
 * Polls /api/live-quotes every 30 s. Returns a Map<symbol, row> for O(1)
 * lookup in the various dashboard cards. Pauses polling when document is
 * hidden (saves Vercel function invocations + Postgres reads while the user
 * has the tab in the background).
 */
export function useLiveQuotes(intervalMs = 30_000) {
  const [data, setData] = useState<LiveQuotesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const r = await fetch("/api/live-quotes", { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as LiveQuotesResponse;
        if (!cancelled) {
          setData(j);
          setError(null);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setLoading(false);
        }
      } finally {
        if (!cancelled && !document.hidden) {
          timer.current = setTimeout(tick, intervalMs);
        }
      }
    }

    function onVisibility() {
      if (document.hidden) {
        if (timer.current) clearTimeout(timer.current);
      } else {
        tick();
      }
    }

    tick();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);

  const bySymbol = new Map<string, LiveQuoteRow>();
  if (data) for (const q of data.quotes) bySymbol.set(q.symbol, q);

  return {
    data,
    bySymbol,
    activeSource: data?.activeSource ?? null,
    activeSourceAt: data?.activeSourceAt ?? null,
    loading,
    error,
  };
}
