"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type BriefProviderName = "deepseek" | "gemini" | "openai" | "claude";

export interface ProviderEntry {
  html: string;
  structured: unknown;     // StructuredBrief shape — primary
  verdict: unknown;        // legacy mirror of structured
  generatedAt: string;
  generatedBy: string;
  tokensIn: number | null;
  tokensOut: number | null;
  error: string | null;
  stale: boolean;
}

export interface MorningVerdictResponse {
  bucketAt: string;
  intraday: boolean;
  providers: Record<BriefProviderName, ProviderEntry | null>;
}

/**
 * Polls /api/morning-verdict every 60 s. Owner re-run buttons call
 * `rerunProvider(name)` — that fires POST /api/morning-verdict/rerun and
 * triggers a refetch on success.
 */
export function useMorningVerdict(intervalMs = 60_000) {
  const [data, setData] = useState<MorningVerdictResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rerunning, setRerunning] = useState<BriefProviderName | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchOnce = useCallback(async () => {
    try {
      const r = await fetch("/api/morning-verdict", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as MorningVerdictResponse;
      setData(j);
      setError(null);
      setLoading(false);
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      if (cancelled) return;
      await fetchOnce();
      if (!cancelled && !document.hidden) {
        timer.current = setTimeout(tick, intervalMs);
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
  }, [intervalMs, fetchOnce]);

  const rerunProvider = useCallback(
    async (provider: BriefProviderName): Promise<{ ok: boolean; error?: string; retryInSec?: number }> => {
      setRerunning(provider);
      try {
        const r = await fetch(`/api/morning-verdict/rerun?provider=${provider}`, { method: "POST" });
        if (r.status === 429) {
          const j = (await r.json()) as { retryInSec?: number };
          return { ok: false, error: "Rate limited", retryInSec: j.retryInSec };
        }
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          return { ok: false, error: j.error ?? `HTTP ${r.status}` };
        }
        await fetchOnce();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      } finally {
        setRerunning(null);
      }
    },
    [fetchOnce],
  );

  return { data, error, loading, rerunning, rerunProvider, refetch: fetchOnce };
}
