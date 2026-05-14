"use client";

import { useEffect, useState } from "react";
import type { BreadthSnapshot } from "@/types/breadth";

const BASE = "/market-dashboard";

/**
 * Fetches the daily breadth snapshot from `public/market-dashboard/breadth.json`.
 * Refreshes once per page load (breadth is a daily metric — no polling needed).
 */
export function useBreadth() {
  const [data, setData] = useState<BreadthSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/breadth.json`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<BreadthSnapshot>;
      })
      .then((j) => {
        if (!cancelled) {
          setData(j);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError((e as Error).message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { data, error, loading };
}
