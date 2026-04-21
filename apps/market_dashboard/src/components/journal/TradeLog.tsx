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
};

type Providers = { gemini: boolean; openai: boolean; anthropic: boolean };
const PROVIDER_LABELS: Record<string, string> = {
  gemini: "Gemini 2.5 Pro",
  openai: "GPT-4o",
  anthropic: "Claude Sonnet",
};

// ─── Shared helpers ────────────────────────────────────────────────────────────

function verdictColor(v: string): string {
  const s = v?.toUpperCase() ?? "";
  if (s.includes("STRONG BUY") || s.includes("GREAT")) return "bg-emerald-900/60 text-emerald-300 border-emerald-700";
  if (s.includes("BUY") || s.includes("GOOD")) return "bg-green-900/60 text-green-300 border-green-700";
  if (s.includes("HOLD") || s.includes("AVERAGE")) return "bg-yellow-900/60 text-yellow-300 border-yellow-700";
  if (s.includes("STRONG AVOID") || s.includes("MISTAKE")) return "bg-red-900/60 text-red-300 border-red-700";
  if (s.includes("AVOID") || s.includes("POOR")) return "bg-orange-900/60 text-orange-300 border-orange-700";
  return "bg-slate-700/60 text-slate-300 border-slate-600";
}

function scoreColor(score: number): string {
  if (score >= 8) return "text-emerald-400";
  if (score >= 6) return "text-green-400";
  if (score >= 4) return "text-yellow-400";
  return "text-red-400";
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
      <span className="text-xs text-slate-400 whitespace-nowrap">Analysis via</span>
      {providers === null ? (
        <div className="h-7 w-48 animate-pulse rounded bg-slate-800" />
      ) : (
        <div className="flex gap-2">
          {(["gemini", "openai", "anthropic"] as const).map((p) => {
            const available = providers[p];
            const active = selected === p;
            return (
              <button
                key={p}
                disabled={!available}
                onClick={() => available && onSelect(p)}
                className={`rounded px-3 py-1 text-xs font-medium border transition-colors
                  ${!available ? "opacity-35 cursor-not-allowed border-slate-700 text-slate-500" :
                    active ? "border-blue-500 bg-blue-900/40 text-blue-300" :
                    "border-slate-600 text-slate-300 hover:border-slate-400"}`}
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
        className="ml-auto rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-1.5 text-xs font-medium text-white transition-colors"
      >
        {loading ? "Analysing…" : hasResult ? "Re-run" : "Analyse"}
      </button>
    </div>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-slate-400">
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

type EntryPlan = {
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
  entry_plan: EntryPlan;
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
        const first = (["gemini", "openai", "anthropic"] as const).find((p) => data[p]);
        if (first) setSelectedProvider(first);
      })
      .catch(() => setProviders({ gemini: false, openai: false, anthropic: false }));
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
        className="relative z-10 w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-700 bg-slate-900/95 px-5 py-3 backdrop-blur">
          <div>
            <span className="text-lg font-semibold text-white">{ticker}</span>
            {result && <span className="ml-2 text-xs text-slate-400">{result.name} · {result.exchange}</span>}
            {!result && <span className="ml-2 text-xs text-slate-400">AI Stock Analysis</span>}
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:text-white hover:bg-slate-700">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-5">
          <ProviderBar
            providers={providers}
            selected={selectedProvider}
            onSelect={setSelectedProvider}
            onRun={runAnalysis}
            loading={loading}
            hasResult={!!result}
          />

          {loading && <Spinner label={`Analysing ${ticker} with ${PROVIDER_LABELS[selectedProvider] ?? "AI"}…`} />}
          {error && <div className="rounded-lg bg-red-900/30 border border-red-800 px-4 py-3 text-sm text-red-400">{error}</div>}

          {result && (
            <>
              {/* Price summary strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Price", value: result.price ? `$${fmt2(result.price)}` : "—" },
                  {
                    label: "Change",
                    value: result.price_change_pct != null
                      ? (result.price_change_pct >= 0 ? "+" : "") + fmt2(result.price_change_pct) + "%"
                      : "—",
                    color: result.price_change_pct != null
                      ? result.price_change_pct >= 0 ? "text-green-400" : "text-red-400"
                      : "",
                  },
                  { label: "52W Range", value: `$${fmt2(result.week52_low)} – $${fmt2(result.week52_high)}` },
                  { label: "Analyst PT", value: result.analyst_pt ? `$${fmt2(result.analyst_pt)}` : "—" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="rounded-lg bg-slate-800/60 border border-slate-700 px-3 py-2">
                    <div className="text-xs text-slate-500 mb-0.5">{label}</div>
                    <div className={`text-sm font-semibold ${color ?? "text-white"}`}>{value}</div>
                  </div>
                ))}
              </div>

              {/* Fundamentals strip */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
                {[
                  { label: "Mkt Cap", value: result.market_cap },
                  { label: "Revenue", value: result.revenue_ttm },
                  { label: "Gross Margin", value: result.gross_margin_pct != null ? fmt2(result.gross_margin_pct) + "%" : "—" },
                  { label: "Fwd EPS", value: result.forward_eps != null ? "$" + fmt2(result.forward_eps) : "—" },
                  { label: "Div Yield", value: result.dividend_yield_pct != null ? fmt2(result.dividend_yield_pct) + "%" : "None" },
                  {
                    label: "Earnings",
                    value: result.earnings_date
                      ? result.earnings_days != null && result.earnings_days >= 0
                        ? `${result.earnings_days}d`
                        : result.earnings_date
                      : "—",
                  },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded bg-slate-800/40 px-2 py-1.5">
                    <div className="text-[10px] text-slate-500">{label}</div>
                    <div className="text-xs font-medium text-slate-200">{value}</div>
                  </div>
                ))}
              </div>

              {/* 6-Trader Analysis */}
              <div>
                <div className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Trader Analysis</div>
                <div className="space-y-2">
                  {(result.trader_analysis ?? []).map((t) => (
                    <div key={t.handle} className="rounded-lg border border-slate-700 bg-slate-800/40 px-4 py-3">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-xs font-semibold text-slate-300 w-36 shrink-0">{t.handle}</span>
                        <span className={`text-lg font-bold ${scoreColor(t.score)}`}>{t.score}<span className="text-xs text-slate-500">/10</span></span>
                        <span className={`ml-1 rounded border px-2 py-0.5 text-[10px] font-semibold uppercase ${verdictColor(t.verdict)}`}>
                          {t.verdict}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed">{t.note}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Entry Plan */}
              {result.entry_plan && (
                <div>
                  <div className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Suggested Entry Plan</div>
                  <div className="rounded-lg border border-slate-700 bg-slate-800/40 px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: "Entry Zone", value: result.entry_plan.zone },
                      { label: "Stop Loss", value: result.entry_plan.stop },
                      { label: "Target", value: result.entry_plan.target },
                      { label: "R:R", value: result.entry_plan.risk_reward ? `${result.entry_plan.risk_reward}:1` : "—" },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <div className="text-[10px] text-slate-500 mb-0.5">{label}</div>
                        <div className="text-sm font-semibold text-white">{value}</div>
                      </div>
                    ))}
                    <div className="col-span-2 sm:col-span-4">
                      <div className="text-[10px] text-slate-500 mb-0.5">Batching</div>
                      <div className="text-xs text-slate-300">{result.entry_plan.batches}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Bulls & Bears */}
              {(result.bulls?.length > 0 || result.bears?.length > 0) && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs font-medium text-green-400 uppercase tracking-wide mb-2">Bulls</div>
                    <ul className="space-y-1">
                      {(result.bulls ?? []).map((b, i) => (
                        <li key={i} className="flex gap-2 text-xs text-slate-300">
                          <span className="text-green-500 mt-0.5">▲</span>{b}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-red-400 uppercase tracking-wide mb-2">Bears</div>
                    <ul className="space-y-1">
                      {(result.bears ?? []).map((b, i) => (
                        <li key={i} className="flex gap-2 text-xs text-slate-300">
                          <span className="text-red-500 mt-0.5">▼</span>{b}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* Composite */}
              <div className="rounded-lg border border-slate-600 bg-slate-800/60 px-4 py-3 flex items-center gap-4">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide">Composite Score</div>
                  <span className={`text-3xl font-bold ${scoreColor(result.composite_score)}`}>
                    {result.composite_score}
                    <span className="text-sm text-slate-500">/10</span>
                  </span>
                </div>
                <div className="flex-1">
                  <span className={`rounded border px-2 py-0.5 text-xs font-semibold uppercase ${verdictColor(result.composite_verdict)}`}>
                    {result.composite_verdict}
                  </span>
                  <p className="mt-1 text-xs text-slate-400">{result.composite_note}</p>
                  {result.best_match_trader && (
                    <p className="mt-1 text-[10px] text-slate-500">Best match: <span className="text-slate-300">{result.best_match_trader}</span></p>
                  )}
                </div>
              </div>
            </>
          )}

          {!loading && !error && !result && (
            <div className="py-8 text-center text-sm text-slate-500">
              Select a provider and click Analyse to get AI insights on {ticker}.
            </div>
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
  verdict: string;
  note: string;
};

type TradeReviewResult = {
  ticker: string;
  is_open: boolean;
  trader_reviews: TraderReview[];
  strengths: string[];
  weaknesses: string[];
  overall_score: number;
  overall_verdict: string;
  lesson: string;
};

function TradeReviewModal({ trade, onClose }: { trade: Trade; onClose: () => void }) {
  const [providers, setProviders] = useState<Providers | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TradeReviewResult | null>(null);

  useEffect(() => {
    fetch("/api/analysis/providers")
      .then((r) => r.json())
      .then((data: Providers) => {
        setProviders(data);
        const first = (["gemini", "openai", "anthropic"] as const).find((p) => data[p]);
        if (first) setSelectedProvider(first);
      })
      .catch(() => setProviders({ gemini: false, openai: false, anthropic: false }));
  }, []);

  function runReview() {
    setLoading(true);
    setError(null);
    setResult(null);
    fetch("/api/analysis/trade-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trade, provider: selectedProvider }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setResult(data as TradeReviewResult);
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
        className="relative z-10 w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-700 bg-slate-900/95 px-5 py-3 backdrop-blur">
          <div>
            <span className="text-lg font-semibold text-white">{trade.ticker}</span>
            <span className="ml-2 text-xs text-slate-400">Trade Review</span>
            <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${isOpen ? "bg-blue-900/50 text-blue-400" : pnlNum! >= 0 ? "bg-green-900/50 text-green-400" : "bg-red-900/50 text-red-400"}`}>
              {isOpen ? "Open" : pnlNum! >= 0 ? "Win" : "Loss"}
            </span>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:text-white hover:bg-slate-700">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Trade summary */}
          <div className="rounded-lg bg-slate-800/40 border border-slate-700 px-4 py-3 grid grid-cols-3 sm:grid-cols-5 gap-3 text-center text-xs">
            {[
              { label: "Side", value: trade.side ?? "—" },
              { label: "Entry", value: trade.buyPrice ? "$" + parseFloat(trade.buyPrice.toString()).toFixed(2) : "—" },
              { label: "Exit", value: trade.exitPrice ? "$" + parseFloat(trade.exitPrice.toString()).toFixed(2) : "—" },
              { label: "Qty", value: trade.quantity ? parseFloat(trade.quantity.toString()).toString() : "—" },
              {
                label: "P&L",
                value: isOpen ? "Open" : `${pnlNum! >= 0 ? "+" : ""}$${Math.abs(pnlNum!).toFixed(2)}`,
              },
            ].map(({ label, value }) => (
              <div key={label}>
                <div className="text-slate-500 mb-0.5">{label}</div>
                <div className="font-semibold text-slate-200">{value}</div>
              </div>
            ))}
          </div>

          <ProviderBar
            providers={providers}
            selected={selectedProvider}
            onSelect={setSelectedProvider}
            onRun={runReview}
            loading={loading}
            hasResult={!!result}
          />

          {loading && <Spinner label={`Reviewing ${trade.ticker} trade with ${PROVIDER_LABELS[selectedProvider] ?? "AI"}…`} />}
          {error && <div className="rounded-lg bg-red-900/30 border border-red-800 px-4 py-3 text-sm text-red-400">{error}</div>}

          {result && (
            <>
              {/* Per-trader reviews */}
              <div>
                <div className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Trader Perspectives</div>
                <div className="space-y-2">
                  {(result.trader_reviews ?? []).map((t) => (
                    <div key={t.handle} className="rounded-lg border border-slate-700 bg-slate-800/40 px-4 py-3">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-xs font-semibold text-slate-300 w-36 shrink-0">{t.handle}</span>
                        <span className={`text-lg font-bold ${scoreColor(t.entry_score)}`}>{t.entry_score}<span className="text-xs text-slate-500">/10</span></span>
                        <span className={`ml-1 rounded border px-2 py-0.5 text-[10px] font-semibold uppercase ${verdictColor(t.verdict)}`}>
                          {t.verdict}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed">{t.note}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Strengths & Weaknesses */}
              {(result.strengths?.length > 0 || result.weaknesses?.length > 0) && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs font-medium text-green-400 uppercase tracking-wide mb-2">Strengths</div>
                    <ul className="space-y-1">
                      {(result.strengths ?? []).map((s, i) => (
                        <li key={i} className="flex gap-2 text-xs text-slate-300">
                          <span className="text-green-500 mt-0.5">✓</span>{s}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-red-400 uppercase tracking-wide mb-2">Areas to Improve</div>
                    <ul className="space-y-1">
                      {(result.weaknesses ?? []).map((w, i) => (
                        <li key={i} className="flex gap-2 text-xs text-slate-300">
                          <span className="text-red-500 mt-0.5">✗</span>{w}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* Overall */}
              <div className="rounded-lg border border-slate-600 bg-slate-800/60 px-4 py-3 flex items-start gap-4">
                <div className="shrink-0">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide">Overall Score</div>
                  <span className={`text-3xl font-bold ${scoreColor(result.overall_score)}`}>
                    {result.overall_score}
                    <span className="text-sm text-slate-500">/10</span>
                  </span>
                  <div className="mt-1">
                    <span className={`rounded border px-2 py-0.5 text-xs font-semibold uppercase ${verdictColor(result.overall_verdict)}`}>
                      {result.overall_verdict}
                    </span>
                  </div>
                </div>
                <div className="flex-1">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Key Lesson</div>
                  <p className="text-xs text-slate-300 leading-relaxed">{result.lesson}</p>
                </div>
              </div>
            </>
          )}

          {!loading && !error && !result && (
            <div className="py-8 text-center text-sm text-slate-500">
              Select a provider and click Analyse to get a trade quality review.
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

function fmtPnl(v: Decimal | null | undefined): { text: string; color: string } {
  if (v === null || v === undefined) return { text: "Open", color: "text-slate-400" };
  const n = parseFloat(v.toString());
  return {
    text: `${n >= 0 ? "+" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
    color: n >= 0 ? "text-green-400" : "text-red-400",
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
  const [loading, setLoading] = useState(false);
  const [stockTicker, setStockTicker] = useState<string | null>(null);
  const [reviewTrade, setReviewTrade] = useState<Trade | null>(null);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      ...(symbol ? { symbol } : {}),
      ...(side ? { side } : {}),
      ...(result ? { result } : {}),
    });
    fetch(`/api/journal/trades?${params}`)
      .then((r) => r.json())
      .then((data: { trades: Trade[]; total: number; page: number; pages: number }) => {
        setTrades(data.trades);
        setTotal(data.total);
        setPages(data.pages);
      })
      .finally(() => setLoading(false));
  }, [page, symbol, side, result]);

  return (
    <div className="space-y-3">
      {stockTicker && <StockAnalysisModal ticker={stockTicker} onClose={() => setStockTicker(null)} />}
      {reviewTrade && <TradeReviewModal trade={reviewTrade} onClose={() => setReviewTrade(null)} />}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="text"
          placeholder="Symbol"
          value={symbol}
          onChange={(e) => { setSymbol(e.target.value.toUpperCase()); setPage(1); }}
          className="rounded bg-slate-800 border border-slate-700 px-3 py-1.5 text-sm w-28 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <select
          value={side}
          onChange={(e) => { setSide(e.target.value); setPage(1); }}
          className="rounded bg-slate-800 border border-slate-700 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">All Sides</option>
          <option value="Long">Long</option>
          <option value="Short">Short</option>
        </select>
        <select
          value={result}
          onChange={(e) => { setResult(e.target.value); setPage(1); }}
          className="rounded bg-slate-800 border border-slate-700 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">All Results</option>
          <option value="win">Win</option>
          <option value="loss">Loss</option>
          <option value="open">Open</option>
        </select>
        <span className="text-xs text-slate-500 ml-auto">{total} trade{total !== 1 ? "s" : ""}</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/80 text-slate-400 text-xs uppercase">
            <tr>
              {["#", "Date", "Symbol", "Side", "Qty", "Entry", "Exit", "Fees", "P&L", "Notes", "Review"].map((h) => (
                <th key={h} className="px-3 py-2 text-left whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="px-3 py-6 text-center text-slate-500">Loading…</td></tr>
            ) : trades.length === 0 ? (
              <tr><td colSpan={11} className="px-3 py-6 text-center text-slate-500">No trades found</td></tr>
            ) : trades.map((t, i) => {
              const { text: pnlText, color: pnlColor } = fmtPnl(t.pnl);
              const isOpen = t.pnl === null;
              return (
                <tr key={t.id} className="border-t border-slate-800 hover:bg-slate-800/40">
                  <td className="px-3 py-2 text-slate-500">{(page - 1) * 50 + i + 1}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {t.tradeDate ? new Date(t.tradeDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }) : "—"}
                  </td>
                  <td className="px-3 py-2 font-medium">
                    {isOpen ? (
                      <button
                        onClick={() => setStockTicker(t.ticker)}
                        className="font-medium text-blue-400 hover:text-blue-300 hover:underline underline-offset-2 cursor-pointer"
                        title="Click for AI stock analysis"
                      >
                        {t.ticker}
                      </button>
                    ) : (
                      t.ticker
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {t.side ? (
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${t.side === "Long" ? "bg-green-900/50 text-green-400" : "bg-red-900/50 text-red-400"}`}>
                        {t.side}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2">{fmtNum(t.quantity)}</td>
                  <td className="px-3 py-2">${fmtNum(t.buyPrice)}</td>
                  <td className="px-3 py-2">{t.exitPrice ? `$${fmtNum(t.exitPrice)}` : "—"}</td>
                  <td className="px-3 py-2">{t.fees ? `$${fmtNum(t.fees)}` : "—"}</td>
                  <td className={`px-3 py-2 font-medium ${pnlColor}`}>{pnlText}</td>
                  <td className="px-3 py-2 text-slate-400 max-w-xs truncate">{t.notes || "—"}</td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => setReviewTrade(t)}
                      className="rounded px-2 py-1 text-[10px] font-medium border border-slate-600 text-slate-400 hover:border-blue-500 hover:text-blue-400 transition-colors whitespace-nowrap"
                      title="AI trade review"
                    >
                      Review
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center gap-2 justify-end">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-40 px-3 py-1 text-sm"
          >
            ← Prev
          </button>
          <span className="text-sm text-slate-400">Page {page} of {pages}</span>
          <button
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            disabled={page === pages}
            className="rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-40 px-3 py-1 text-sm"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
