"use client";

import { useEffect, useMemo, useState } from "react";
import { useTvScreeners } from "@/hooks/useTvScreeners";
import type { TvScreener, TvScreenerHit } from "@/types/tv-screener";
import FreshnessBadge from "./FreshnessBadge";
import { SNAPSHOT_THRESHOLDS } from "@/lib/freshness";

type ManualScore = {
  score: number | null;
  verdict: string | null;
  note: string | null;
};

/**
 * Reads screener scores that the Claude CLI morning-brief embeds in the
 * StructuredBrief under `screenerScores`. Fetched once on mount (browser
 * cache re-uses the same response the MorningBriefHero is already polling).
 * Scores are 0-100 as emitted by the CLI (already scaled).
 */
function useBriefScreenerScores(): Record<string, ManualScore> {
  const [scores, setScores] = useState<Record<string, ManualScore>>({});
  useEffect(() => {
    fetch("/api/morning-verdict")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: unknown) => {
        if (!data || typeof data !== "object") return;
        const providers = (data as Record<string, unknown>).providers;
        if (!providers || typeof providers !== "object") return;
        const claude = (providers as Record<string, unknown>).claude;
        if (!claude || typeof claude !== "object") return;
        const structured = (claude as Record<string, unknown>).structured;
        if (!structured || typeof structured !== "object") return;
        const raw = (structured as Record<string, unknown>).screenerScores;
        if (!raw || typeof raw !== "object") return;
        const out: Record<string, ManualScore> = {};
        for (const [ticker, val] of Object.entries(raw as Record<string, unknown>)) {
          if (!val || typeof val !== "object") continue;
          const v = val as Record<string, unknown>;
          const rawScore = v.score;
          const numeric =
            typeof rawScore === "number" ? rawScore :
            typeof rawScore === "string" ? parseFloat(rawScore) :
            null;
          // CLI emits scores on a 0-100 scale; if someone uses 1-10 by mistake, scale up.
          const score =
            numeric == null || isNaN(numeric) ? null :
            numeric <= 10 ? Math.round(numeric * 10) :
            Math.round(numeric);
          out[ticker] = {
            score,
            verdict: normalizeVerdict(typeof v.verdict === "string" ? v.verdict : null),
            note: typeof v.note === "string" ? v.note : null,
          };
        }
        setScores(out);
      })
      .catch(() => { /* silently ignore — brief scores are enhancement only */ });
  }, []);
  return scores;
}

function formatPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatNumber(value: number | null | undefined, decimals = 2): string {
  if (value == null || Number.isNaN(value)) return "-";
  return value.toFixed(decimals);
}

function formatMcap(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "-";
  if (Math.abs(value) >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(0)}M`;
  return `$${value.toFixed(0)}`;
}

function changeClass(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "text-[var(--fg-3)]";
  if (value > 0) return "gain";
  if (value < 0) return "loss";
  return "text-[var(--fg-2)]";
}

function tvSymbol(hit: TvScreenerHit): string {
  return hit.exchange ? `${hit.exchange}:${hit.ticker}` : hit.ticker;
}

function tvChartUrl(hit: TvScreenerHit): string {
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol(hit))}`;
}

function scoreTone(score: number | null | undefined): { background: string; color: string } {
  if (score == null) {
    return { background: "var(--bg-raised)", color: "var(--fg-3)" };
  }
  if (score >= 80) {
    return { background: "var(--gain-bg)", color: "var(--gain-fg)" };
  }
  if (score >= 50) {
    return { background: "var(--accent-soft-bg)", color: "var(--accent)" };
  }
  return { background: "var(--loss-bg)", color: "var(--loss-fg)" };
}

/**
 * Normalize any incoming verdict label to the canonical GO / WAIT / PASS
 * vocabulary regardless of which scoring path produced it:
 *   DeepSeek daily run  → already GO / WAIT / PASS
 *   Manual Score button → STRONG BUY / BUY / HOLD / AVOID / STRONG AVOID
 *   Morning brief       → BUY / HOLD / AVOID (or GO / WAIT / PASS)
 */
function normalizeVerdict(v: string | null | undefined): string | null {
  if (!v) return null;
  const u = v.toUpperCase().replace(/[-_]/g, " ");
  if (u === "GO" || u === "STRONG BUY" || u === "BUY")       return "GO";
  if (u === "WAIT" || u === "HOLD")                           return "WAIT";
  if (u === "PASS" || u === "AVOID" || u === "STRONG AVOID") return "PASS";
  return v; // return as-is if unknown (future-proof)
}

function extractManualScore(payload: Record<string, unknown>): ManualScore {
  // LLMs sometimes return numbers as strings (e.g. "7.5" instead of 7.5).
  // composite_score is on a 1–10 scale; multiply ×10 to match the 0–100 display scale.
  const raw = payload.composite_score;
  const composite =
    typeof raw === "number" ? raw :
    typeof raw === "string" ? parseFloat(raw) :
    null;
  const score = composite == null || isNaN(composite) ? null : Math.round(composite * 10);
  const verdict = normalizeVerdict(typeof payload.composite_verdict === "string" ? payload.composite_verdict : null);
  const note = typeof payload.composite_note === "string" ? payload.composite_note : null;
  return { score, verdict, note };
}

export default function TvScreenerHits() {
  const { data, loading, error } = useTvScreeners();
  const briefScores = useBriefScreenerScores();
  const screeners = useMemo(() => data?.screeners ?? [], [data?.screeners]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [manualScores, setManualScores] = useState<Record<string, ManualScore>>({});
  const [scoringKey, setScoringKey] = useState<string | null>(null);
  const [scoreError, setScoreError] = useState<string | null>(null);

  const activeScreener = useMemo(() => {
    if (!screeners.length) return null;
    return screeners.find((screener) => screener.id === activeId) ?? screeners[0];
  }, [activeId, screeners]);

  async function copyScreenerHits(screener: TvScreener) {
    const tickers = screener.hits.map(tvSymbol).join(",");
    try {
      await navigator.clipboard.writeText(tickers);
      setCopyMessage(`Copied ${screener.hits.length} symbols from ${screener.name}.`);
    } catch {
      setCopyMessage("Clipboard is unavailable in this browser.");
    }
    setTimeout(() => setCopyMessage(null), 3500);
  }

  async function scoreTicker(hit: TvScreenerHit, screenerId: string) {
    const key = `${screenerId}:${hit.ticker}`;
    setScoringKey(key);
    setScoreError(null);
    try {
      // Pass screener hit data so the API can fall back to it if Yahoo Finance
      // is unavailable for this ticker (e.g. HALO, DOCS, etc.)
      const hitData = {
        close: hit.close,
        change: hit.change,
        relative_volume_10d_calc: hit.relative_volume_10d_calc,
        "Perf.W": hit["Perf.W"],
        "Perf.1M": hit["Perf.1M"],
        market_cap_basic: hit.market_cap_basic,
        sector: hit.sector,
        industry: hit.industry,
      };
      const response = await fetch("/api/analysis/stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: hit.ticker, provider: "deepseek", hitData }),
      });
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok || payload.error) {
        throw new Error(typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`);
      }
      setManualScores((current) => ({ ...current, [key]: extractManualScore(payload) }));
    } catch (err) {
      setScoreError(err instanceof Error ? err.message : "Scoring failed.");
    } finally {
      setScoringKey(null);
    }
  }

  return (
    <section className="market-panel p-5">
      <div className="market-section-head">
        <div>
          <p className="t-overline">TV Screener Hits</p>
          <p className="t-caption">
            DeepSeek auto-scores the top 5 rows in the daily run; score the rest on demand.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="t-caption t-mono">
            {loading ? "Loading..." : error ? `Unavailable: ${error}` : data?.scored ? `Top ${data.score_top ?? 10} scored` : "Unscored"}
          </p>
          {!loading && !error ? (
            <FreshnessBadge timestamp={data?.fetched_at} thresholds={SNAPSHOT_THRESHOLDS} />
          ) : null}
        </div>
      </div>

      {copyMessage ? <p className="mb-3 t-caption text-[var(--accent)]">{copyMessage}</p> : null}
      {scoreError ? <p className="mb-3 t-caption text-[var(--loss-fg)]">Score error: {scoreError}</p> : null}

      {activeScreener ? (
        <>
          <div className="mb-4 flex gap-1 overflow-x-auto rounded-md bg-[var(--bg-raised)] p-1">
            {screeners.map((screener) => {
              const active = activeScreener.id === screener.id;
              return (
                <button
                  key={screener.id}
                  type="button"
                  onClick={() => setActiveId(screener.id)}
                  className={`shrink-0 rounded px-3 py-1.5 text-[11px] font-bold transition ${
                    active
                      ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                      : "text-[var(--fg-2)] hover:text-[var(--fg-1)]"
                  }`}
                >
                  {screener.name}
                  <span className="ml-1 opacity-70">{screener.hits.length}</span>
                </button>
              );
            })}
          </div>

          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-[var(--fg-1)]">{activeScreener.name}</h3>
              <p className="t-caption t-mono">
                {data?.fetched_at ? `Fetched ${new Date(data.fetched_at).toLocaleTimeString()}` : "Daily snapshot"}
              </p>
            </div>
            <div className="flex gap-2">
              {activeScreener.tv_url ? (
                <a className="mds-button h-8 text-[12px]" href={activeScreener.tv_url} target="_blank" rel="noreferrer">
                  Open Screener
                </a>
              ) : null}
              <button
                className="mds-button h-8 text-[12px]"
                type="button"
                onClick={() => copyScreenerHits(activeScreener)}
                disabled={!activeScreener.hits.length}
              >
                Copy To TV
              </button>
            </div>
          </div>

          <ScreenerTable
            screener={activeScreener}
            manualScores={manualScores}
            briefScores={briefScores}
            scoringKey={scoringKey}
            onScore={scoreTicker}
          />
        </>
      ) : (
        <p className="t-body-small text-[var(--fg-3)]">
          TradingView screener rows will appear after tv_screeners.json is generated.
        </p>
      )}
    </section>
  );
}

function ScreenerTable({
  screener,
  manualScores,
  briefScores,
  scoringKey,
  onScore,
}: {
  screener: TvScreener;
  manualScores: Record<string, ManualScore>;
  briefScores: Record<string, ManualScore>;
  scoringKey: string | null;
  onScore: (hit: TvScreenerHit, screenerId: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[920px] text-left text-[12px]">
        <thead className="text-[10px] uppercase tracking-[0.12em] text-[var(--fg-3)]">
          <tr className="border-b border-[var(--line)]">
            <th className="py-2 pr-3 font-bold">Ticker</th>
            <th className="px-3 py-2 text-right font-bold">Price</th>
            <th className="px-3 py-2 text-right font-bold">Chg</th>
            <th className="px-3 py-2 text-right font-bold">RVOL</th>
            <th className="px-3 py-2 text-right font-bold">1W</th>
            <th className="px-3 py-2 text-right font-bold">1M</th>
            <th className="px-3 py-2 text-right font-bold">MCap</th>
            <th className="px-3 py-2 font-bold">Industry</th>
            <th className="px-3 py-2 text-right font-bold">Score</th>
            <th className="py-2 pl-3 text-right font-bold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {screener.hits.length ? (
            screener.hits.map((hit) => {
              const key = `${screener.id}:${hit.ticker}`;
              const manual = manualScores[key];
              const brief = briefScores[hit.ticker];
              // Priority: auto-score (Python daily run) → CLI morning-brief score → manual button click
              const score = hit.score ?? brief?.score ?? manual?.score ?? null;
              // Normalize all verdicts to GO / WAIT / PASS regardless of source vocabulary
              const verdict = normalizeVerdict(hit.verdict ?? brief?.verdict ?? manual?.verdict ?? null);
              const scoreStyle = scoreTone(score);
              return (
                <tr key={key} className="border-b border-[var(--line)] last:border-0">
                  <td className="py-2 pr-3">
                    <div className="flex flex-col">
                      <span className="t-ticker">{hit.ticker}</span>
                      <span className="t-caption">{hit.exchange ?? "-"}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{formatNumber(hit.close)}</td>
                  <td className={`px-3 py-2 text-right font-mono ${changeClass(hit.change)}`}>
                    {formatPct(hit.change)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {formatNumber(hit.relative_volume_10d_calc, 2)}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono ${changeClass(hit["Perf.W"])}`}>
                    {formatPct(hit["Perf.W"])}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono ${changeClass(hit["Perf.1M"])}`}>
                    {formatPct(hit["Perf.1M"])}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{formatMcap(hit.market_cap_basic)}</td>
                  <td className="max-w-[180px] px-3 py-2">
                    <div className="truncate text-[var(--fg-1)]" title={hit.industry ?? hit.sector ?? ""}>
                      {hit.industry ?? "-"}
                    </div>
                    <div className="truncate t-caption">{hit.sector ?? "-"}</div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {score != null ? (
                      <span
                        className="inline-flex rounded px-2 py-1 font-mono text-[11px] font-bold"
                        style={scoreStyle}
                        title={hit.thesis ?? brief?.note ?? manual?.note ?? undefined}
                      >
                        {verdict ? `${verdict} ` : ""}
                        {score}
                      </span>
                    ) : (
                      <span className="font-mono text-[var(--fg-3)]">-</span>
                    )}
                  </td>
                  <td className="py-2 pl-3">
                    <div className="flex justify-end gap-2">
                      <a
                        className="mds-button h-7 px-2 text-[11px]"
                        href={tvChartUrl(hit)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open TV
                      </a>
                      <button
                        className="mds-button h-7 px-2 text-[11px]"
                        type="button"
                        disabled={score != null || scoringKey === key}
                        onClick={() => onScore(hit, screener.id)}
                      >
                        {scoringKey === key ? "..." : score != null ? "Scored" : "Score"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td className="py-3 text-[var(--fg-3)]" colSpan={10}>
                No hits returned for this screener.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
