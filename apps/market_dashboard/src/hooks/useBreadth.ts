"use client";

import { useEffect, useState } from "react";
import type { BreadthSnapshot } from "@/types/breadth";

const BASE = "/market-dashboard";
const STATIC_FALLBACK_MAX_AGE_MS = 15 * 60 * 1000;

/**
 * Fetches the daily breadth snapshot.
 *
 * DB-first: reads /api/breadth (Postgres, push-updated by the TV-scanner
 * refresh endpoint — no git commit / Vercel rebuild lag). Falls back to the
 * static breadth.json file if the DB has no row yet (backwards compat / first
 * deploy). Polls every 5 min so an intraday breadth refresh shows up without
 * a page reload.
 *
 * The `_meta.ageMs` from the API powers the freshness badge on the panel.
 */
export function useBreadth() {
  const [data, setData] = useState<(BreadthSnapshot & { _meta?: BreadthMeta }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // 1. Try the DB-backed API first.
      try {
        const r = await fetch(`/api/breadth`, { cache: "no-store" });
        if (r.ok) {
          const j = (await r.json()) as BreadthSnapshot & { _meta?: BreadthMeta };
          if (!cancelled) {
            setData(j);
            setError(null);
            setLoading(false);
          }
          return;
        }
        if (r.status !== 404) {
          const j = (await r.json().catch(() => null)) as { error?: string } | null;
          throw new Error(j?.error ?? `breadth API HTTP ${r.status}`);
        }
      } catch {
        if (!cancelled) {
          setError("Live breadth refresh failed; stale fallback suppressed.");
          setLoading(false);
        }
        return;
      }

      // 2. Fallback: static breadth.json (legacy / pre-first-refresh).
      try {
        const r = await fetch(`${BASE}/breadth.json`, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as BreadthSnapshot;
        const ts = j.as_of ?? j.built_at ?? null;
        const t = ts ? new Date(ts).getTime() : NaN;
        if (!Number.isFinite(t) || Date.now() - t > STATIC_FALLBACK_MAX_AGE_MS) {
          throw new Error("static breadth fallback is stale");
        }
        if (!cancelled) {
          setData({ ...j, _meta: { source: "file-fallback", refreshedAt: ts } });
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setLoading(false);
        }
      }
    }

    load();
    // Poll every 5 min so intraday breadth refreshes appear without reload.
    const interval = setInterval(load, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return { data, error, loading };
}

export interface BreadthMeta {
  source: string;
  refreshedAt: string | null;
  ageMs?: number;
  durationMs?: number | null;
}
