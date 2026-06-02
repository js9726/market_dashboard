"use client";

import { useEffect, useState } from "react";
import { fetchMarketSnapshot } from "@/lib/market-snapshot-client";
import type { MarketSnapshot } from "@/types/market-dashboard";

/**
 * Fetches the live-overlaid market snapshot once per page mount. The API path
 * uses TradingView scanner values first, then falls back to the static JSON.
 */
export function useMarketSnapshot() {
  const [data, setData] = useState<MarketSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchMarketSnapshot()
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
