"use client";

import { useEffect, useState } from "react";
import type { TvScreenersFile } from "@/types/tv-screener";

const BASE = "/market-dashboard";

export function useTvScreeners() {
  const [data, setData] = useState<TvScreenersFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // DB-first: /api/screeners (push-updated by the TV-scanner refresh, no
      // git-commit/Vercel-rebuild lag). Falls back to the static file.
      try {
        const r = await fetch(`/api/screeners`, { cache: "no-store" });
        if (r.ok) {
          const j = (await r.json()) as TvScreenersFile;
          if (!cancelled) { setData(j); setError(null); setLoading(false); }
          return;
        }
      } catch { /* fall through */ }
      try {
        const r = await fetch(`${BASE}/tv_screeners.json`, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as TvScreenersFile;
        if (!cancelled) { setData(j); setLoading(false); }
      } catch (e) {
        if (!cancelled) { setError((e as Error).message); setLoading(false); }
      }
    }

    load();
    // Poll every 5 min so an intraday screener refresh appears without reload.
    const interval = setInterval(load, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return { data, error, loading };
}
