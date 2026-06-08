"use client";

import { useEffect, useState } from "react";
import { Decimal } from "@prisma/client/runtime/library";

type Trade = {
  id: string;
  ticker: string;
  tradeDate: string | null;
  buyPrice: Decimal | null;
  quantity: Decimal | null;
  exitPrice: Decimal | null;
  side: string | null;
  fees: Decimal | null;
  pnl: Decimal | null;
  notes: string | null;
  proposedEntry: Decimal | null;
  proposedSL: Decimal | null;
  proposedTP: Decimal | null;
  rrr: Decimal | null;
  riskPct: Decimal | null;
  rewardPct: Decimal | null;
  positionPct: Decimal | null;
  currency: string | null;
  currencyCode?: string | null;
  pnlUsd?: number | null;
  pnlSource?: string | null;
  platform: string | null;
  industry: string | null;
  strategy: string | null;
  state: string | null;
  verdict: Record<string, unknown> | null;
  verdictScore: number | null;
  verdictGeneratedAt: string | null;
  // Broker-merge fields (from /api/journal/trades): live overlay + plan flags.
  source?: "LIVE" | "SHEET";
  sheetPnl?: number | null;
  liveUnrealizedPl?: number | null;
  liveUnrealizedPlPct?: number | null;
  currentPrice?: Decimal | number | null;
  priceObservedAt?: string | null;
  priceSource?: string | null;
  stale?: boolean;
  broker?: string | null;
  hasPlan?: boolean;
  synthetic?: boolean;
  wikiVerdict?: {
    source: "WikiTradeVerdict";
    operatorLabel: string;
    intent: string;
    qualityGrade: "A" | "B" | "C" | null;
    auditGrade: "A" | "B" | "C" | null;
    setup: string | null;
    model: string | null;
    ingestedAt: string;
    day0Url: string | null;
    day14Url: string | null;
  };
};

type VerdictHistoryItem = {
  id: string;
  model: string;
  provider: string;
  verdict: Record<string, unknown>;
  score: number | null;
  createdAt: string;
};

type Providers = { deepseek: boolean; gemini: boolean; openai: boolean; anthropic: boolean };
const PROVIDER_LABELS: Record<string, string> = {
  deepseek: "DeepSeek",
  gemini: "Gemini 2.5 Pro",
  openai: "GPT-4o",
  anthropic: "Claude Sonnet",
};

// ─── Shared helpers ────────────────────────────────────────────────────────────

function verdictColor(v: string): string {
  const s = v?.toUpperCase() ?? "";
  if (s.includes("STRONG BUY") || s.includes("GREAT")) return "bg-[var(--gain-bg)] text-[var(--gain-fg)] border-[var(--gain-fg)]";
  if (s.includes("BUY") || s.includes("GOOD")) return "bg-[var(--gain-bg)] text-[var(--gain-fg)] border-[var(--gain-fg)]";
  if (s.includes("ACCEPTABLE") || s.includes("HOLD") || s.includes("AVERAGE")) return "bg-[var(--bg-raised)] text-[var(--warn-500)] border-[var(--warn-500)]";
  if (s.includes("STRONG AVOID") || s.includes("MISTAKE")) return "bg-[var(--loss-bg)] text-[var(--loss-fg)] border-[var(--loss-fg)]";
  if (s.includes("AVOID") || s.includes("POOR")) return "bg-[var(--loss-bg)] text-[var(--loss-fg)] border-[var(--loss-fg)]";
  return "bg-[var(--bg-raised)] text-[var(--fg-2)] border-[var(--line)]";
}

function scoreColor(score: number): string {
  if (score >= 7) return "text-[var(--gain-fg)]";
  if (score >= 5) return "text-[var(--warn-500)]";
  return "text-[var(--loss-fg)]";
}

function scoreBadgeBg(score: number): string {
  if (score >= 7) return "border-[var(--gain-fg)] bg-[var(--gain-bg)] text-[var(--gain-fg)]";
  if (score >= 5) return "border-[var(--warn-500)] text-[var(--warn-500)]";
  return "border-[var(--loss-fg)] bg-[var(--loss-bg)] text-[var(--loss-fg)]";
}

function gradeFromScore(score: number | null | undefined): "A" | "B" | "C" | null {
  if (score == null) return null;
  if (score >= 7) return "A";
  if (score >= 5) return "B";
  return "C";
}

function ProviderBar({
  providers,
  selected,
  onSelect,
  onRun,
  loading,
  hasResult,
}: {
  providers: Providers | null;
  selected: string;
  onSelect: (p: string) => void;
  onRun: () => void;
  loading: boolean;
  hasResult: boolean;
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-xs text-[var(--fg-2)] whitespace-nowrap">Analysis via</span>
      {providers === null ? (
        <div className="h-7 w-48 animate-pulse rounded bg-[var(--bg-raised)]" />
      ) : (
        <div className="flex gap-2">
          {(["deepseek", "gemini", "openai", "anthropic"] as const).map((p) => {
            const available = providers[p];
            const active = selected === p;
            return (
              <button
                key={p}
                disabled={!available}
                onClick={() => available && onSelect(p)}
                className={`rounded px-3 py-1 text-xs font-medium border transition-colors
                  ${!available ? "opacity-35 cursor-not-allowed border-[var(--line)] text-[var(--fg-3)]" :
                    active ? "border-[var(--accent)] bg-[var(--accent-soft-bg)] text-[var(--accent)]" :
                    "border-[var(--line)] text-[var(--fg-2)] hover:border-[var(--line-strong)]"}`}
                title={!available ? `${PROVIDER_LABELS[p]} — API key not set` : PROVIDER_LABELS[p]}
              >
                {PROVIDER_LABELS[p]}
              </button>
            );
          })}
        </div>
      )}
      <button
        onClick={onRun}
        disabled={!selected || loading || providers === null}
        className="ml-auto rounded bg-[var(--accent)] hover:bg-[var(--accent)] disabled:opacity-40 disabled:cursor-not-allowed px-4 py-1.5 text-xs font-medium text-[var(--fg-1)] transition-colors"
      >
        {loading ? "Analysing…" : hasResult ? "Re-run" : "Analyse"}
      </button>
    </div>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-[var(--fg-2)]">
      <svg className="h-8 w-8 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
      </svg>
      <span className="text-sm">{label}</span>
    </div>
  );
}

// ─── Stock Analysis Modal ───────────────────────────────────────────────────────

type TraderAnalysis = {
  handle: string;
  score: number;
  verdict: string;
  note: string;
};

type StockEntryPlan = {
  zone: string;
  stop: string;
  target: string;
  risk_reward: number;
  batches: string;
};

type StockAnalysisResult = {
  name: string;
  sector: string;
  industry: string;
  exchange: string;
  price: number | null;
  price_change_pct: number | null;
  week52_low: number | null;
  week52_high: number | null;
  analyst_pt: number | null;
  earnings_date: string;
  earnings_days: number | null;
  market_cap: string;
  revenue_ttm: string;
  gross_margin_pct: number | null;
  trailing_eps: number | null;
  forward_eps: number | null;
  dividend_yield_pct: number | null;
  trader_analysis: TraderAnalysis[];
  entry_plan: StockEntryPlan;
  bulls: string[];
  bears: string[];
  composite_score: number;
  composite_verdict: string;
  composite_note: string;
  best_match_trader: string;
};

function StockAnalysisModal({ ticker, onClose }: { ticker: string; onClose: () => void }) {
  const [providers, setProviders] = useState<Providers | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StockAnalysisResult | null>(null);

  useEffect(() => {
    fetch("/api/analysis/providers")
      .then((r) => r.json())
      .then((data: Providers) => {
        setProviders(data);
        const first = (["deepseek", "gemini", "openai", "anthropic"] as const).find((p) => data[p]);
        if (first) setSelectedProvider(first);
      })
      .catch(() => setProviders({ deepseek: false, gemini: false, openai: false, anthropic: false }));
  }, []);

  function runAnalysis() {
    setLoading(true);
    setError(null);
    setResult(null);
    fetch("/api/analysis/stock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker, provider: selectedProvider }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setResult(data as StockAnalysisResult);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  const fmt2 = (v: number | null) => (v == null ? "—" : v.toFixed(2));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative z-10 w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--bg-surface)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--line)] bg-[var(--bg-surface)] px-5 py-3 backdrop-blur">
          <div>
            <span className="text-lg font-semibold text-[var(--fg-1)]">{ticker}</span>
            {result && <span className="ml-2 text-xs text-[var(--fg-2)]">{result.name} · {result.exchange}</span>}
            {!result && <span className="ml-2 text-xs text-[var(--fg-2)]">AI Stock Analysis</span>}
          </div>
          <button onClick={onClose} className="rounded p-1 text-[var(--fg-2)] hover:text-[var(--fg-1)] hover:bg-[var(--bg-raised)]">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-5">
          <ProviderBar providers={providers} selected={selectedProvider} onSelect={setSelectedProvider} onRun={runAnalysis} loading={loading} hasResult={!!result} />

          {loading && <Spinner label={`Analysing ${ticker} with ${PROVIDER_LABELS[selectedProvider] ?? "AI"}…`} />}
          {error && <div className="rounded-lg bg-[var(--loss-bg)] border border-[var(--loss-fg)] px-4 py-3 text-sm text-[var(--loss-fg)]">{error}</div>}

          {result && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Price", value: result.price ? `$${fmt2(result.price)}` : "—" },
                  { label: "Change", value: result.price_change_pct != null ? (result.price_change_pct >= 0 ? "+" : "") + fmt2(result.price_change_pct) + "%" : "—", color: result.price_change_pct != null ? result.price_change_pct >= 0 ? "text-[var(--gain-fg)]" : "text-[var(--loss-fg)]" : "" },
                  { label: "52W Range", value: `$${fmt2(result.week52_low)} – $${fmt2(result.week52_high)}` },
                  { label: "Analyst PT", value: result.analyst_pt ? `$${fmt2(result.analyst_pt)}` : "—" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="rounded-lg bg-[var(--bg-raised)] border border-[var(--line)] px-3 py-2">
                    <div className="text-xs text-[var(--fg-3)] mb-0.5">{label}</div>
                    <div className={`text-sm font-semibold ${color ?? "text-[var(--fg-1)]"}`}>{value}</div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
                {[
                  { label: "Mkt Cap", value: result.market_cap },
                  { label: "Revenue", value: result.revenue_ttm },
                  { label: "Gross Margin", value: result.gross_margin_pct != null ? fmt2(result.gross_margin_pct) + "%" : "—" },
                  { label: "Fwd EPS", value: result.forward_eps != null ? "$" + fmt2(result.forward_eps) : "—" },
                  { label: "Div Yield", value: result.dividend_yield_pct != null ? fmt2(result.dividend_yield_pct) + "%" : "None" },
                  { label: "Earnings", value: result.earnings_date ? result.earnings_days != null && result.earnings_days >= 0 ? `${result.earnings_days}d` : result.earnings_date : "—" },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded bg-[var(--bg-raised)] px-2 py-1.5">
                    <div className="text-[10px] text-[var(--fg-3)]">{label}</div>
                    <div className="text-xs font-medium text-[var(--fg-1)]">{value}</div>
                  </div>
                ))}
              </div>

              <div>
                <div className="text-xs font-medium text-[var(--fg-2)] uppercase tracking-wide mb-2">Trader Analysis</div>
                <div className="space-y-2">
                  {(result.trader_analysis ?? []).map((t) => (
                    <div key={t.handle} className="rounded-lg border border-[var(--line)] bg-[var(--bg-raised)] px-4 py-3">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-xs font-semibold text-[var(--fg-2)] w-36 shrink-0">{t.handle}</span>
                        <span className={`text-lg font-bold ${scoreColor(t.score)}`}>{t.score}<span className="text-xs text-[var(--fg-3)]">/10</span></span>
                        <span className={`ml-1 rounded border px-2 py-0.5 text-[10px] font-semibold uppercase ${verdictColor(t.verdict)}`}>{t.verdict}</span>
                      </div>
                      <p className="text-xs text-[var(--fg-2)] leading-relaxed">{t.note}</p>
                    </div>
                  ))}
                </div>
              </div>

              {result.entry_plan && (
                <div>
                  <div className="text-xs font-medium text-[var(--fg-2)] uppercase tracking-wide mb-2">Suggested Entry Plan</div>
                  <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-raised)] px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: "Entry Zone", value: result.entry_plan.zone },
                      { label: "Stop Loss", value: result.entry_plan.stop },
                      { label: "Target", value: result.entry_plan.target },
                      { label: "R:R", value: result.entry_plan.risk_reward ? `${result.entry_plan.risk_reward}:1` : "—" },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <div className="text-[10px] text-[var(--fg-3)] mb-0.5">{label}</div>
                        <div className="text-sm font-semibold text-[var(--fg-1)]">{value}</div>
                      </div>
                    ))}
                    <div className="col-span-2 sm:col-span-4">
                      <div className="text-[10px] text-[var(--fg-3)] mb-0.5">Batching</div>
                      <div className="text-xs text-[var(--fg-2)]">{result.entry_plan.batches}</div>
                    </div>
                  </div>
                </div>
              )}

              {(result.bulls?.length > 0 || result.bears?.length > 0) && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs font-medium text-[var(--gain-fg)] uppercase tracking-wide mb-2">Bulls</div>
                    <ul className="space-y-1">{(result.bulls ?? []).map((b, i) => <li key={i} className="flex gap-2 text-xs text-[var(--fg-2)]"><span className="text-[var(--gain-fg)] mt-0.5">▲</span>{b}</li>)}</ul>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-[var(--loss-fg)] uppercase tracking-wide mb-2">Bears</div>
                    <ul className="space-y-1">{(result.bears ?? []).map((b, i) => <li key={i} className="flex gap-2 text-xs text-[var(--fg-2)]"><span className="text-[var(--loss-fg)] mt-0.5">▼</span>{b}</li>)}</ul>
                  </div>
                </div>
              )}

              <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-raised)] px-4 py-3 flex items-center gap-4">
                <div>
                  <div className="text-[10px] text-[var(--fg-3)] uppercase tracking-wide">Composite Score</div>
                  <span className={`text-3xl font-bold ${scoreColor(result.composite_score)}`}>{result.composite_score}<span className="text-sm text-[var(--fg-3)]">/10</span></span>
                </div>
                <div className="flex-1">
                  <span className={`rounded border px-2 py-0.5 text-xs font-semibold uppercase ${verdictColor(result.composite_verdict)}`}>{result.composite_verdict}</span>
                  <p className="mt-1 text-xs text-[var(--fg-2)]">{result.composite_note}</p>
                  {result.best_match_trader && <p className="mt-1 text-[10px] text-[var(--fg-3)]">Best match: <span className="text-[var(--fg-2)]">{result.best_match_trader}</span></p>}
                </div>
              </div>
            </>
          )}

          {!loading && !error && !result && (
            <div className="py-8 text-center text-sm text-[var(--fg-3)]">Select a provider and click Analyse to get AI insights on {ticker}.</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Trade Review Modal ─────────────────────────────────────────────────────────

type TraderReview = {
  handle: string;
  entry_score: number;
  risk_score: number;
  setup_score: number;
  total_score: number;
  verdict: string;
  note: string;
};

type BatchSell = {
  tranche: string;
  at: string;
};

type TradeEntryPlan = {
  ideal_entry: string;
  stop_loss: string;
  target_1: string;
  target_2: string;
  position_size: string;
  batch_sells: BatchSell[];
};

type TradeReviewResult = {
  ticker: string;
  sector: string;
  industry: string;
  market_cap_tier: string;
  is_open: boolean;
  trader_reviews: TraderReview[];
  best_match: string;
  weakest_dimension: string;
  bull_case: string[];
  bear_case: string[];
  entry_plan: TradeEntryPlan;
  overall_score: number;
  overall_verdict: string;
  lesson: string;
};

type AgentSummary = { summary: string };
type AgentPipelineResult = {
  ticker: string;
  agents: {
    data: AgentSummary & { facts?: Record<string, unknown> };
    technical: AgentSummary & { indicators?: Record<string, unknown> };
    chart: AgentSummary & { pattern?: string | null; levels?: Record<string, unknown> };
    risk: AgentSummary & {
      suggested_size_pct?: number | null;
      rr?: number | null;
      stop_distance_pct?: number | null;
      var_1d_pct?: number | null;
      status: "approved" | "warn" | "reject";
    };
  };
  moderator: {
    signal: "BUY" | "SELL" | "HOLD";
    confidence: number;
    consensus?: string;
    entry?: number | null;
    stop?: number | null;
    target?: number | null;
    reasoning: string;
    lesson?: string | null;
  };
};

function isAgentPipelineResult(r: unknown): r is AgentPipelineResult {
  return (
    !!r &&
    typeof r === "object" &&
    "agents" in r &&
    "moderator" in r &&
    typeof (r as { moderator?: unknown }).moderator === "object"
  );
}

function stateBadge(state: string | null) {
  if (!state) return null;
  const s = state.toUpperCase();
  const cls =
    s === "CLOSE" ? "border-[var(--gain-fg)] text-[var(--gain-fg)]" :
    s === "OPEN" ? "border-[var(--accent)] text-[var(--accent)]" :
    s === "SEMI-OPEN" ? "border-[var(--warn-500)] text-[var(--warn-500)]" :
    "border-[var(--line)] text-[var(--fg-3)]";
  return <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{state}</span>;
}

type ReviewStyle = "trader-debate" | "agent-pipeline";

const AGENT_LABELS: Record<keyof AgentPipelineResult["agents"], { label: string; accent: string }> = {
  data: { label: "Data", accent: "text-[var(--accent)] border-[var(--accent)] bg-[var(--accent-soft-bg)]" },
  technical: { label: "Technical", accent: "text-[var(--gain-fg)] border-[var(--gain-fg)] bg-[var(--gain-bg)]" },
  chart: { label: "Chart", accent: "text-[var(--warn-500)] border-[var(--warn-500)] bg-[var(--bg-raised)]" },
  risk: { label: "Risk", accent: "text-[var(--loss-fg)] border-[var(--loss-fg)] bg-[var(--loss-bg)]" },
};

function signalColor(s: string): string {
  if (s === "BUY") return "bg-[var(--gain-bg)] text-[var(--gain-fg)] border-[var(--gain-fg)]";
  if (s === "SELL") return "bg-[var(--loss-bg)] text-[var(--loss-fg)] border-[var(--loss-fg)]";
  return "bg-[var(--bg-raised)] text-[var(--warn-500)] border-[var(--warn-500)]";
}

function AgentPipelineView({ result }: { result: AgentPipelineResult }) {
  const { agents, moderator } = result;
  return (
    <div className="space-y-4">
      <div className="text-xs font-medium text-[var(--fg-2)] uppercase tracking-wide">Agent pipeline</div>
      <div className="space-y-2">
        {(["data", "technical", "chart", "risk"] as const).map((k) => {
          const agent = agents[k];
          const meta = AGENT_LABELS[k];
          return (
            <div key={k} className="rounded-lg border border-[var(--line)] bg-[var(--bg-raised)] px-4 py-3">
              <div className="flex items-center gap-2 mb-1">
                <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold uppercase ${meta.accent}`}>
                  {meta.label}
                </span>
                {k === "risk" && agents.risk.status && (
                  <span className={`text-[10px] uppercase ${agents.risk.status === "approved" ? "text-[var(--gain-fg)]" : agents.risk.status === "warn" ? "text-[var(--warn-500)]" : "text-[var(--loss-fg)]"}`}>
                    {agents.risk.status}
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--fg-2)] leading-relaxed">{agent.summary}</p>
              {k === "risk" && (
                <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-[var(--fg-3)]">
                  {agents.risk.suggested_size_pct != null && <span>Size: {agents.risk.suggested_size_pct.toFixed(1)}%</span>}
                  {agents.risk.rr != null && <span>R/R: {agents.risk.rr.toFixed(2)}</span>}
                  {agents.risk.stop_distance_pct != null && <span>Stop: {agents.risk.stop_distance_pct.toFixed(1)}%</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-raised)] px-4 py-3">
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <span className="text-[10px] text-[var(--fg-3)] uppercase tracking-wide">Moderator</span>
          <span className={`rounded border px-2 py-0.5 text-xs font-semibold uppercase ${signalColor(moderator.signal)}`}>
            {moderator.signal}
          </span>
          <span className={`text-2xl font-bold ${scoreColor(moderator.confidence)}`}>
            {moderator.confidence.toFixed(1)}<span className="text-xs text-[var(--fg-3)]">/10</span>
          </span>
          {moderator.consensus && <span className="text-[10px] text-[var(--fg-3)]">consensus {moderator.consensus}</span>}
        </div>
        {(moderator.entry != null || moderator.stop != null || moderator.target != null) && (
          <div className="grid grid-cols-3 gap-3 mb-3 text-xs">
            {[
              { label: "Entry", value: moderator.entry },
              { label: "Stop", value: moderator.stop },
              { label: "Target", value: moderator.target },
            ].map(({ label, value }) => (
              <div key={label}>
                <div className="text-[10px] text-[var(--fg-3)]">{label}</div>
                <div className="font-semibold text-[var(--fg-1)]">{value != null ? `$${value.toFixed(2)}` : "—"}</div>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-[var(--fg-2)] leading-relaxed">{moderator.reasoning}</p>
        {moderator.lesson && (
          <>
            <div className="mt-3 text-[10px] text-[var(--fg-3)] uppercase tracking-wide">Journal lesson</div>
            <p className="text-xs text-[var(--fg-1)] leading-relaxed italic">{moderator.lesson}</p>
          </>
        )}
      </div>
    </div>
  );
}

function TradeReviewModal({ trade, onClose, onVerdictSaved }: { trade: Trade; onClose: () => void; onVerdictSaved: () => void }) {
  const [providers, setProviders] = useState<Providers | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [selectedStyle, setSelectedStyle] = useState<ReviewStyle>("trader-debate");
  const [history, setHistory] = useState<VerdictHistoryItem[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TradeReviewResult | AgentPipelineResult | null>(
    trade.verdict ? (trade.verdict as unknown as TradeReviewResult | AgentPipelineResult) : null
  );
  const [isFromCache, setIsFromCache] = useState(!!trade.verdict);
  const [providerNote, setProviderNote] = useState<string>("");

  useEffect(() => {
    fetch("/api/analysis/providers")
      .then((r) => r.json())
      .then((data: Providers) => {
        setProviders(data);
        const first = (["deepseek", "gemini", "openai", "anthropic"] as const).find((p) => data[p]);
        if (first) setSelectedProvider(first);
      })
      .catch(() => setProviders({ deepseek: false, gemini: false, openai: false, anthropic: false }));

    fetch(`/api/journal/trades/${trade.id}/verdict-history`)
      .then((r) => r.json())
      .then((data: VerdictHistoryItem[]) => setHistory(data))
      .catch(() => {});
  }, [trade.id]);

  function fetchHistory() {
    fetch(`/api/journal/trades/${trade.id}/verdict-history`)
      .then((r) => r.json())
      .then((data: VerdictHistoryItem[]) => { setHistory(data); setSelectedHistoryId(""); })
      .catch(() => {});
  }

  function selectHistoryItem(id: string) {
    setSelectedHistoryId(id);
    const item = history.find((h) => h.id === id);
    if (item) {
      setResult(item.verdict as unknown as TradeReviewResult | AgentPipelineResult);
      setIsFromCache(true);
      setProviderNote("");
      setError(null);
    }
  }

  function runReview(force = false) {
    setLoading(true);
    setError(null);
    setProviderNote("");
    fetch("/api/analysis/trade-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tradeId: trade.id, force, provider: selectedProvider, style: selectedStyle }),
    })
      .then((r) => r.json())
      .then((data: Record<string, unknown>) => {
        if (data.error) throw new Error(data.error as string);
        const { _meta, ...review } = data;
        setResult(review as unknown as TradeReviewResult | AgentPipelineResult);
        setIsFromCache(false);
        const meta = _meta as { providerNote?: string } | undefined;
        if (meta?.providerNote) setProviderNote(meta.providerNote);
        onVerdictSaved();
        fetchHistory();
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  const isOpen = trade.pnl === null;
  const pnlNum = isOpen ? null : parseFloat(trade.pnl!.toString());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative z-10 w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--bg-surface)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--line)] bg-[var(--bg-surface)] px-5 py-3 backdrop-blur">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-lg font-semibold text-[var(--fg-1)]">{trade.ticker}</span>
            <span className="text-xs text-[var(--fg-2)]">Trade Review</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${isOpen ? "bg-[var(--accent-soft-bg)] text-[var(--accent)]" : pnlNum! >= 0 ? "bg-[var(--gain-bg)] text-[var(--gain-fg)]" : "bg-[var(--loss-bg)] text-[var(--loss-fg)]"}`}>
              {isOpen ? "Open" : pnlNum! >= 0 ? "Win" : "Loss"}
            </span>
            {isFromCache && !selectedHistoryId && <span className="text-[10px] text-[var(--fg-3)] italic">cached</span>}
            {trade.wikiVerdict && (
              <span
                className="rounded border border-[var(--accent)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]"
                title={`Imported from ${trade.wikiVerdict.source} (${trade.wikiVerdict.operatorLabel})`}
              >
                wiki
              </span>
            )}
            {history.length > 0 && (
              <select
                value={selectedHistoryId}
                onChange={(e) => e.target.value ? selectHistoryItem(e.target.value) : (setSelectedHistoryId(""), setResult(trade.verdict ? (trade.verdict as unknown as TradeReviewResult) : null), setIsFromCache(!!trade.verdict))}
                className="rounded bg-[var(--bg-raised)] border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--fg-2)] focus:outline-none"
              >
                <option value="">Latest</option>
                {history.map((h) => (
                  <option key={h.id} value={h.id}>
                    {new Date(h.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {h.provider} {h.score != null ? `(${h.score.toFixed(1)})` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>
          <button onClick={onClose} className="rounded p-1 text-[var(--fg-2)] hover:text-[var(--fg-1)] hover:bg-[var(--bg-raised)] shrink-0">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Trade summary strip */}
          <div className="rounded-lg bg-[var(--bg-raised)] border border-[var(--line)] px-4 py-3 grid grid-cols-3 sm:grid-cols-6 gap-3 text-center text-xs">
            {[
              { label: "Side", value: trade.side ?? "—" },
              { label: "Entry", value: trade.buyPrice ? "$" + parseFloat(trade.buyPrice.toString()).toFixed(2) : "—" },
              { label: "Exit", value: trade.exitPrice ? "$" + parseFloat(trade.exitPrice.toString()).toFixed(2) : "—" },
              { label: "Qty", value: trade.quantity ? parseFloat(trade.quantity.toString()).toString() : "—" },
              { label: "P&L", value: isOpen ? "Open" : `${pnlNum! >= 0 ? "+" : ""}$${Math.abs(pnlNum!).toFixed(2)}` },
              { label: "Strategy", value: trade.strategy ?? "—" },
            ].map(({ label, value }) => (
              <div key={label}>
                <div className="text-[var(--fg-3)] mb-0.5">{label}</div>
                <div className="font-semibold text-[var(--fg-1)]">{value}</div>
              </div>
            ))}
          </div>

          {/* Pre-trade plan strip (if available) */}
          {(trade.proposedEntry || trade.proposedSL || trade.proposedTP) && (
            <div className="rounded-lg bg-[var(--bg-raised)] border border-[var(--line)] px-4 py-2 grid grid-cols-3 sm:grid-cols-5 gap-3 text-center text-xs">
              {[
                { label: "Plan Entry", value: trade.proposedEntry ? "$" + parseFloat(trade.proposedEntry.toString()).toFixed(2) : "—" },
                { label: "Plan SL", value: trade.proposedSL ? "$" + parseFloat(trade.proposedSL.toString()).toFixed(2) : "—" },
                { label: "Plan TP", value: trade.proposedTP ? "$" + parseFloat(trade.proposedTP.toString()).toFixed(2) : "—" },
                { label: "RRR", value: trade.rrr ? parseFloat(trade.rrr.toString()).toFixed(2) : "—" },
                { label: "Risk %", value: trade.riskPct ? parseFloat(trade.riskPct.toString()).toFixed(1) + "%" : "—" },
              ].map(({ label, value }) => (
                <div key={label}>
                  <div className="text-[var(--fg-3)] mb-0.5">{label}</div>
                  <div className="font-medium text-[var(--fg-2)]">{value}</div>
                </div>
              ))}
            </div>
          )}

          {trade.wikiVerdict && (
            <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-raised)] px-4 py-2 text-xs text-[var(--fg-2)]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[var(--fg-3)]">{trade.wikiVerdict.operatorLabel}</span>
                {trade.wikiVerdict.qualityGrade && (
                  <span className={`rounded border px-1.5 py-0.5 font-semibold ${scoreBadgeBg(trade.verdictScore ?? 0)}`}>
                    {trade.wikiVerdict.qualityGrade}-grade
                  </span>
                )}
                {trade.wikiVerdict.auditGrade && (
                  <span className="rounded border border-[var(--line)] px-1.5 py-0.5 text-[var(--fg-3)]">
                    day-14 {trade.wikiVerdict.auditGrade}
                  </span>
                )}
                {trade.wikiVerdict.setup && <span>{trade.wikiVerdict.setup}</span>}
                {trade.wikiVerdict.model && <span className="text-[var(--fg-3)]">{trade.wikiVerdict.model}</span>}
                <span className="ml-auto inline-flex gap-2">
                  {trade.wikiVerdict.day0Url && (
                    <a className="text-[var(--accent)] hover:underline" href={trade.wikiVerdict.day0Url} target="_blank" rel="noreferrer">
                      day0
                    </a>
                  )}
                  {trade.wikiVerdict.day14Url && (
                    <a className="text-[var(--accent)] hover:underline" href={trade.wikiVerdict.day14Url} target="_blank" rel="noreferrer">
                      day14
                    </a>
                  )}
                </span>
              </div>
            </div>
          )}

          {/* Review style toggle */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[var(--fg-3)] uppercase tracking-wide">Review style</span>
            <div className="inline-flex rounded-md border border-[var(--line)] bg-[var(--bg-raised)] p-0.5">
              {(["trader-debate", "agent-pipeline"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSelectedStyle(s)}
                  disabled={loading}
                  className={`rounded px-3 py-1 text-[11px] font-medium transition ${
                    selectedStyle === s
                      ? "bg-[var(--accent)] text-[var(--fg-1)]"
                      : "text-[var(--fg-2)] hover:text-[var(--fg-1)]"
                  }`}
                >
                  {s === "trader-debate" ? "Trader Debate" : "Agent Pipeline"}
                </button>
              ))}
            </div>
            {selectedStyle === "agent-pipeline" && (
              <span className="text-[10px] text-[var(--warn-500)]">v0 — sparse snapshot, no live indicators</span>
            )}
          </div>

          {/* Provider bar */}
          <ProviderBar
            providers={providers}
            selected={selectedProvider}
            onSelect={setSelectedProvider}
            onRun={() => runReview(true)}
            loading={loading}
            hasResult={!!result}
          />
          {providerNote && (
            <div className="rounded bg-[var(--bg-raised)] border border-[var(--warn-500)] px-3 py-1.5 text-[11px] text-[var(--warn-500)]">
              {providerNote}
            </div>
          )}

          {loading && <Spinner label={`Reviewing ${trade.ticker} trade…`} />}
          {error && <div className="rounded-lg bg-[var(--loss-bg)] border border-[var(--loss-fg)] px-4 py-3 text-sm text-[var(--loss-fg)]">{error}</div>}

          {result && isAgentPipelineResult(result) && (
            <AgentPipelineView result={result} />
          )}

          {result && !isAgentPipelineResult(result) && (
            <>
              {/* Sector / industry header */}
              {(result.sector || result.industry) && (
                <div className="flex gap-2 flex-wrap">
                  {result.sector && <span className="rounded bg-[var(--bg-raised)] border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--fg-2)]">{result.sector}</span>}
                  {result.industry && <span className="rounded bg-[var(--bg-raised)] border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--fg-2)]">{result.industry}</span>}
                  {result.market_cap_tier && <span className="rounded bg-[var(--bg-raised)] border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--fg-2)]">{result.market_cap_tier} Cap</span>}
                </div>
              )}

                              {/* 7-trader scoring rows */}
              <div>
                <div className="text-xs font-medium text-[var(--fg-2)] uppercase tracking-wide mb-2">Trader Perspectives</div>
                <div className="space-y-2">
                  {(result.trader_reviews ?? []).map((t) => {
                    const total = t.total_score ?? (t.entry_score + (t.risk_score ?? 0) + (t.setup_score ?? 0));
                    return (
                      <div key={t.handle} className="rounded-lg border border-[var(--line)] bg-[var(--bg-raised)] px-4 py-3">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <span className="text-xs font-semibold text-[var(--fg-2)] w-32 shrink-0">{t.handle}</span>
                          <span className={`text-lg font-bold ${scoreColor(total)}`}>{total}<span className="text-xs text-[var(--fg-3)]">/10</span></span>
                          <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold uppercase ${verdictColor(t.verdict)}`}>{t.verdict}</span>
                          <span className="ml-auto text-[10px] text-[var(--fg-3)]">
                            Entry {t.entry_score}/4 · Risk {t.risk_score ?? "?"}/3 · Setup {t.setup_score ?? "?"}/3
                          </span>
                        </div>
                        <p className="text-xs text-[var(--fg-2)] leading-relaxed">{t.note}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Bull / Bear case */}
              {(result.bull_case?.length > 0 || result.bear_case?.length > 0) && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs font-medium text-[var(--gain-fg)] uppercase tracking-wide mb-2">Bull Case</div>
                    <ul className="space-y-1">{(result.bull_case ?? []).map((b, i) => <li key={i} className="flex gap-2 text-xs text-[var(--fg-2)]"><span className="text-[var(--gain-fg)] mt-0.5">▲</span>{b}</li>)}</ul>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-[var(--loss-fg)] uppercase tracking-wide mb-2">Bear Case</div>
                    <ul className="space-y-1">{(result.bear_case ?? []).map((b, i) => <li key={i} className="flex gap-2 text-xs text-[var(--fg-2)]"><span className="text-[var(--loss-fg)] mt-0.5">▼</span>{b}</li>)}</ul>
                  </div>
                </div>
              )}

              {/* Entry plan */}
              {result.entry_plan && (
                <div>
                  <div className="text-xs font-medium text-[var(--fg-2)] uppercase tracking-wide mb-2">Entry Plan</div>
                  <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-raised)] px-4 py-3 space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                      {[
                        { label: "Ideal Entry", value: result.entry_plan.ideal_entry },
                        { label: "Stop Loss", value: result.entry_plan.stop_loss },
                        { label: "Target 1", value: result.entry_plan.target_1 },
                        { label: "Target 2", value: result.entry_plan.target_2 },
                        { label: "Position Size", value: result.entry_plan.position_size },
                      ].map(({ label, value }) => (
                        <div key={label}>
                          <div className="text-[var(--fg-3)] mb-0.5">{label}</div>
                          <div className="font-semibold text-[var(--fg-1)]">{value}</div>
                        </div>
                      ))}
                    </div>
                    {result.entry_plan.batch_sells?.length > 0 && (
                      <div>
                        <div className="text-[10px] text-[var(--fg-3)] mb-1.5">Batch Exit Plan</div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {result.entry_plan.batch_sells.map((b, i) => (
                            <div key={i} className="rounded bg-[var(--bg-raised)] border border-[var(--line)] px-2 py-1.5 text-center">
                              <div className="text-[10px] text-[var(--fg-2)]">{b.tranche}</div>
                              <div className="text-xs font-medium text-[var(--fg-1)]">{b.at}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Composite score footer */}
              <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-raised)] px-4 py-3 flex items-start gap-4">
                <div className="shrink-0">
                  <div className="text-[10px] text-[var(--fg-3)] uppercase tracking-wide">Score</div>
                  <span className={`text-3xl font-bold ${scoreColor(result.overall_score)}`}>
                    {result.overall_score}<span className="text-sm text-[var(--fg-3)]">/10</span>
                  </span>
                  <div className="mt-1">
                    <span className={`rounded border px-2 py-0.5 text-xs font-semibold uppercase ${verdictColor(result.overall_verdict)}`}>{result.overall_verdict}</span>
                  </div>
                </div>
                <div className="flex-1 space-y-1.5">
                  {result.best_match && <p className="text-[10px] text-[var(--fg-3)]">Best match: <span className="text-[var(--fg-2)] font-medium">{result.best_match}</span></p>}
                  {result.weakest_dimension && <p className="text-[10px] text-[var(--fg-3)]">Weakest: <span className="text-[var(--warn-500)]">{result.weakest_dimension}</span></p>}
                  <div className="text-[10px] text-[var(--fg-3)] mt-1">Key Lesson</div>
                  <p className="text-xs text-[var(--fg-2)] leading-relaxed">{result.lesson}</p>
                </div>
              </div>
            </>
          )}

          {!loading && !error && !result && (
            <div className="py-8 text-center text-sm text-[var(--fg-3)]">
              Select a provider and click Analyse to get a detailed trade quality review.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Format helpers ─────────────────────────────────────────────────────────────

function fmtNum(v: Decimal | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const n = parseFloat(v.toString());
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ccSymbol(cc: string | null | undefined): string {
  const c = (cc ?? "").toUpperCase();
  if (c === "MYR") return "RM ";
  if (c === "" || c === "USD") return "$";
  return `${c} `;
}

function fmtMoney(n: number, symbol: string): string {
  return `${n >= 0 ? "+" : "-"}${symbol}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Currency-aware P&L. Prefers the USD-normalized `pnlUsd` (broker-true or
 * fixed-rate converted) and surfaces the original sheet currency (e.g. RM) on
 * hover. When not yet converted, shows the native currency honestly instead of
 * mislabeling MYR as USD.
 */
function fmtPnlRow(t: Trade): { text: string; color: string; title?: string } {
  const raw = t.pnl == null ? null : parseFloat(t.pnl.toString());
  const usd = t.pnlUsd ?? null;
  const cc = t.currencyCode ?? t.currency ?? null;
  const isNonUsd = cc != null && cc.toUpperCase() !== "USD";

  if (usd != null) {
    const title = raw != null && isNonUsd
      ? `Sheet original: ${ccSymbol(cc)}${Math.abs(raw).toLocaleString("en-US", { minimumFractionDigits: 2 })}` +
        (t.pnlSource ? ` (${t.pnlSource})` : "")
      : undefined;
    return { text: fmtMoney(usd, "$"), color: usd >= 0 ? "text-[var(--gain-fg)]" : "text-[var(--loss-fg)]", title };
  }
  if (raw == null) return { text: "Open", color: "text-[var(--fg-3)]" };
  return {
    text: fmtMoney(raw, ccSymbol(cc)),
    color: raw >= 0 ? "text-[var(--gain-fg)]" : "text-[var(--loss-fg)]",
    title: isNonUsd ? "Original sheet currency — not yet converted to USD (set the fixed FX rate in Settings)" : undefined,
  };
}

// ─── TradeLog ────────────────────────────────────────────────────────────────────

export default function TradeLog() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [symbol, setSymbol] = useState("");
  const [side, setSide] = useState("");
  const [result, setResult] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [stockTicker, setStockTicker] = useState<string | null>(null);
  const [reviewTrade, setReviewTrade] = useState<Trade | null>(null);
  const [bulkRunning, setBulkRunning] = useState<"filtered" | "all" | null>(null);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);

  function loadTrades() {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      ...(symbol ? { symbol } : {}),
      ...(side ? { side } : {}),
      ...(result ? { result } : {}),
      ...(stateFilter ? { state: stateFilter } : {}),
    });
    fetch(`/api/journal/trades?${params}`)
      .then((r) => r.json())
      .then((data: { trades: Trade[]; total: number; page: number; pages: number }) => {
        setTrades(data.trades);
        setTotal(data.total);
        setPages(data.pages);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadTrades(); }, [page, symbol, side, result, stateFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleVerdictSaved() {
    // Refresh the trade list so the score badge updates
    loadTrades();
  }

  function runBulkReviews(mode: "filtered" | "all") {
    setBulkRunning(mode);
    setBulkMessage(null);
    fetch("/api/analysis/trade-review/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        force: true,
        limit: 300,
        filters: { symbol, side, result, state: stateFilter },
      }),
    })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok || data.error) throw new Error(data.error ?? "Bulk review failed");
        const reviewed = Number(data.reviewed ?? 0);
        const errors = Array.isArray(data.errors) ? data.errors.length : 0;
        const firstError = Array.isArray(data.errors) && data.errors[0]?.error
          ? String(data.errors[0].error)
          : null;
        const quotaSkipped = Number(data.skippedForQuota ?? 0);
        const limitSkipped = Number(data.skippedForLimit ?? 0);
        setBulkMessage(
          [
            `AI reviewed ${reviewed} trade${reviewed === 1 ? "" : "s"}`,
            errors ? `${errors} error${errors === 1 ? "" : "s"}${firstError ? ` (${firstError})` : ""}` : null,
            limitSkipped ? `${limitSkipped} left for next batch` : null,
            quotaSkipped ? `${quotaSkipped} skipped by quota` : null,
          ]
            .filter(Boolean)
            .join(" / "),
        );
        loadTrades();
      })
      .catch((e: Error) => setBulkMessage(e.message))
      .finally(() => setBulkRunning(null));
  }

  return (
    <div className="space-y-3">
      {stockTicker && <StockAnalysisModal ticker={stockTicker} onClose={() => setStockTicker(null)} />}
      {reviewTrade && (
        <TradeReviewModal
          trade={reviewTrade}
          onClose={() => setReviewTrade(null)}
          onVerdictSaved={handleVerdictSaved}
        />
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Symbol"
          value={symbol}
          onChange={(e) => { setSymbol(e.target.value.toUpperCase()); setPage(1); }}
          className="w-28 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-raised)] px-3 py-1.5 text-sm text-[var(--fg-1)] focus:border-[var(--accent)] focus:outline-none"
        />
        {[
          { v: side, set: setSide, opts: [["", "All Sides"], ["Long", "Long"], ["Short", "Short"]] },
          { v: result, set: setResult, opts: [["", "All Results"], ["win", "Win"], ["loss", "Loss"], ["open", "Open"]] },
          { v: stateFilter, set: setStateFilter, opts: [["", "All States"], ["OPEN", "OPEN"], ["SEMI-OPEN", "SEMI-OPEN"], ["CLOSE", "CLOSE"], ["PLANNING", "PLANNING"]] },
        ].map((f, fi) => (
          <select
            key={fi}
            value={f.v}
            onChange={(e) => { f.set(e.target.value); setPage(1); }}
            className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-raised)] px-3 py-1.5 text-sm text-[var(--fg-1)] focus:border-[var(--accent)] focus:outline-none"
          >
            {f.opts.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
          </select>
        ))}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => runBulkReviews("filtered")}
            disabled={!!bulkRunning}
            className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-raised)] px-3 py-1.5 text-xs font-medium text-[var(--fg-2)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
            title="Rerun AI trade review on up to 300 trades matching the current filters"
          >
            {bulkRunning === "filtered" ? "Running..." : "Run filtered"}
          </button>
          <button
            type="button"
            onClick={() => runBulkReviews("all")}
            disabled={!!bulkRunning}
            className="rounded-[var(--radius-sm)] border border-[var(--accent-soft-border)] bg-[var(--accent-soft-bg)] px-3 py-1.5 text-xs font-medium text-[var(--accent)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            title="Rerun AI trade review on up to 300 trades across the whole book"
          >
            {bulkRunning === "all" ? "Running..." : "Run all"}
          </button>
          <span className="text-xs text-[var(--fg-3)]">{total} trade{total !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {bulkMessage && (
        <div className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-raised)] px-3 py-2 text-xs text-[var(--fg-2)]">
          {bulkMessage}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--line)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--bg-raised)] text-xs uppercase text-[var(--fg-3)]">
            <tr>
              {["#", "Date", "Symbol", "Side", "Qty", "Entry", "Exit", "Fees", "P&L", "State", "Verdict", "Grade"].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={12} className="px-3 py-6 text-center text-[var(--fg-3)]">Loading…</td></tr>
            ) : trades.length === 0 ? (
              <tr><td colSpan={12} className="px-3 py-6 text-center text-[var(--fg-3)]">No trades found</td></tr>
            ) : trades.map((t, i) => {
              const { text: pnlText, color: pnlColor, title: pnlTitle } = fmtPnlRow(t);
              const isOpen = t.pnl === null;
              const isLive = t.source === "LIVE";
              const liveU = t.liveUnrealizedPl;
              const grade = t.wikiVerdict?.qualityGrade ?? gradeFromScore(t.verdictScore);
              const verdict = t.verdict as TradeReviewResult | null;
              const verdictSummary = verdict
                ? `${verdict.overall_verdict}${verdict.best_match ? " · " + verdict.best_match : ""}`
                : null;
              return (
                <tr key={t.id} className="border-t border-[var(--line)] hover:bg-[var(--bg-raised)]">
                  <td className="px-3 py-2 text-[var(--fg-3)]">{(page - 1) * 50 + i + 1}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-[var(--fg-2)]">
                    {t.tradeDate ? new Date(t.tradeDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }) : "—"}
                  </td>
                  <td className="px-3 py-2 font-medium text-[var(--fg-1)]">
                    <span className="inline-flex items-center gap-1.5">
                      {isOpen ? (
                        <button
                          onClick={() => setStockTicker(t.ticker)}
                          className="cursor-pointer font-medium text-[var(--accent)] underline-offset-2 hover:underline"
                          title="Click for AI stock analysis"
                        >
                          {t.ticker}
                        </button>
                      ) : t.ticker}
                      {isLive && (
                        <span
                          className="rounded border border-[var(--accent)] px-1 py-px text-[9px] font-semibold leading-none text-[var(--accent)]"
                          title={`Live from ${t.broker ?? "broker"}${t.hasPlan ? " - plan from sheet" : ""}${t.priceSource ? ` - quote ${t.priceSource}` : ""}`}
                        >
                          {t.stale ? "LIVE?" : "LIVE"}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {t.side ? (
                      <span className={`rounded border px-1.5 py-0.5 text-xs font-medium ${t.side === "Long" ? "border-[var(--gain-fg)] text-[var(--gain-fg)]" : "border-[var(--loss-fg)] text-[var(--loss-fg)]"}`}>
                        {t.side}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2 text-[var(--fg-1)]">{fmtNum(t.quantity)}</td>
                  <td className="px-3 py-2 text-[var(--fg-1)]">${fmtNum(t.buyPrice)}</td>
                  <td className="px-3 py-2 text-[var(--fg-2)]">{t.exitPrice ? `$${fmtNum(t.exitPrice)}` : "—"}</td>
                  <td className="px-3 py-2 text-[var(--fg-2)]">{t.fees ? `$${fmtNum(t.fees)}` : "—"}</td>
                  <td className="px-3 py-2 font-medium">
                    {isLive && liveU != null ? (
                      <span className={liveU >= 0 ? "text-[var(--gain-fg)]" : "text-[var(--loss-fg)]"}>
                        {liveU >= 0 ? "+" : ""}${Math.abs(liveU).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                        <span className="ml-1 text-[10px] text-[var(--fg-4)]">{t.stale ? "stale" : "live"}</span>
                      </span>
                    ) : isLive ? (
                      <span className="text-[var(--fg-3)]" title={t.sheetPnl != null ? `Sheet P&L was ${t.sheetPnl}` : undefined}>
                        Live quote pending
                      </span>
                    ) : t.pnl != null ? (
                      <span className={pnlColor} title={pnlTitle}>{pnlText}</span>
                    ) : (
                      <span className="text-[var(--fg-3)]">Open</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{stateBadge(t.state)}</td>
                  {/* Verdict column: shows summary if cached, else notes */}
                  <td className="max-w-xs px-3 py-2">
                    {verdictSummary && !t.synthetic ? (
                      <div className="flex min-w-0 items-center gap-1.5">
                        <button
                          onClick={() => setReviewTrade(t)}
                          className="block max-w-[200px] truncate text-left text-xs text-[var(--fg-2)] hover:text-[var(--fg-1)]"
                          title={verdictSummary}
                        >
                          {verdictSummary}
                        </button>
                        {t.wikiVerdict && (
                          <span
                            className="shrink-0 rounded border border-[var(--accent)] px-1 py-px text-[9px] font-semibold leading-none text-[var(--accent)]"
                            title={`Imported from ${t.wikiVerdict.source}`}
                          >
                            wiki
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="block max-w-[160px] truncate text-xs text-[var(--fg-3)]">{t.notes || "—"}</span>
                    )}
                  </td>
                  {/* Score column: badge if scored, else Analyse button */}
                  <td className="px-3 py-2">
                    {t.verdictScore != null ? (
                      <button
                        onClick={() => setReviewTrade(t)}
                        className={`rounded border px-2 py-0.5 text-xs font-semibold transition-opacity hover:opacity-80 ${scoreBadgeBg(t.verdictScore)}`}
                        title={t.wikiVerdict?.auditGrade ? `Click to view full review. Day-14 audit grade: ${t.wikiVerdict.auditGrade}` : "Click to view full review"}
                      >
                        {grade ? `${grade} ` : ""}{t.verdictScore.toFixed(1)}
                        {t.wikiVerdict?.auditGrade ? (
                          <span className="ml-1 text-[9px] opacity-75">14d {t.wikiVerdict.auditGrade}</span>
                        ) : null}
                      </button>
                    ) : (
                      <button
                        onClick={() => setReviewTrade(t)}
                        className="whitespace-nowrap rounded-[var(--radius-sm)] border border-[var(--line)] px-2 py-1 text-[10px] font-medium text-[var(--fg-3)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                        title="AI trade review"
                      >
                        Analyse
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-raised)] px-3 py-1 text-sm text-[var(--fg-2)] transition hover:bg-[var(--bg-surface)] disabled:opacity-40"
          >
            ← Prev
          </button>
          <span className="text-sm text-[var(--fg-3)]">Page {page} of {pages}</span>
          <button
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            disabled={page === pages}
            className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-raised)] px-3 py-1 text-sm text-[var(--fg-2)] transition hover:bg-[var(--bg-surface)] disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
