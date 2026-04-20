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

type SignalReasoning = { signal: string; details: string };
type FundamentalAnalysis = {
  signal: string;
  confidence: number;
  metrics: Record<string, unknown>;
  reasoning: {
    profitability_signal: SignalReasoning;
    growth_signal: SignalReasoning;
    financial_health_signal: SignalReasoning;
    price_ratios_signal: SignalReasoning;
  };
};
type TechnicalAnalysis = {
  signal: string;
  confidence: number;
  reasoning: {
    trend_signal: SignalReasoning;
    momentum_signal: SignalReasoning;
    volume_signal: SignalReasoning;
    support_resistance_signal: SignalReasoning;
  };
};
type AnalysisResult = {
  data: {
    analyst_signals: {
      fundamentals_agent?: Record<string, FundamentalAnalysis>;
      technical_agent?: Record<string, TechnicalAnalysis>;
    };
  };
};

function signalColor(signal: string) {
  if (signal === "bullish") return "text-green-400";
  if (signal === "bearish") return "text-red-400";
  return "text-yellow-400";
}
function signalBadge(signal: string) {
  if (signal === "bullish") return "bg-green-900/50 text-green-400 border border-green-800";
  if (signal === "bearish") return "bg-red-900/50 text-red-400 border border-red-800";
  return "bg-yellow-900/50 text-yellow-400 border border-yellow-800";
}

type Providers = { gemini: boolean; openai: boolean; anthropic: boolean };
const PROVIDER_LABELS: Record<string, string> = {
  gemini: "Gemini 2.5 Pro",
  openai: "GPT-4o",
  anthropic: "Claude Sonnet",
};

function AnalysisModal({ ticker, onClose }: { ticker: string; onClose: () => void }) {
  const [providers, setProviders] = useState<Providers | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);

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
    fetch("/api/analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers: [ticker], provider: selectedProvider }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setResult(data);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  const fund = result?.data?.analyst_signals?.fundamentals_agent?.[ticker];
  const tech = result?.data?.analyst_signals?.technical_agent?.[ticker];

  const reasoningRows: { label: string; key: keyof FundamentalAnalysis["reasoning"] }[] = [
    { label: "Profitability", key: "profitability_signal" },
    { label: "Growth", key: "growth_signal" },
    { label: "Financial Health", key: "financial_health_signal" },
    { label: "Price Ratios", key: "price_ratios_signal" },
  ];
  const techRows: { label: string; key: keyof TechnicalAnalysis["reasoning"] }[] = [
    { label: "Trend", key: "trend_signal" },
    { label: "Momentum", key: "momentum_signal" },
    { label: "Volume", key: "volume_signal" },
    { label: "Support / Resistance", key: "support_resistance_signal" },
  ];

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
            <span className="ml-2 text-xs text-slate-400">AI Trader Verdict</span>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:text-white hover:bg-slate-700">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Provider selector */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400 whitespace-nowrap">Analysis via</span>
            {providers === null ? (
              <div className="h-8 w-48 animate-pulse rounded bg-slate-800" />
            ) : (
              <div className="flex gap-2">
                {(["gemini", "openai", "anthropic"] as const).map((p) => {
                  const available = providers[p];
                  const active = selectedProvider === p;
                  return (
                    <button
                      key={p}
                      disabled={!available}
                      onClick={() => available && setSelectedProvider(p)}
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
              onClick={runAnalysis}
              disabled={!selectedProvider || loading || providers === null}
              className="ml-auto rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-1.5 text-xs font-medium text-white transition-colors"
            >
              {loading ? "Analysing…" : result ? "Re-run" : "Analyse"}
            </button>
          </div>

          {loading && (
            <div className="flex flex-col items-center gap-3 py-12 text-slate-400">
              <svg className="h-8 w-8 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
              <span className="text-sm">Analysing {ticker} with {PROVIDER_LABELS[selectedProvider]}…</span>
            </div>
          )}
          {error && <div className="rounded-lg bg-red-900/30 border border-red-800 px-4 py-3 text-sm text-red-400">{error}</div>}

          {fund && (
            <>
              {/* Fundamental signal */}
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-400 uppercase tracking-wide">Fundamental</span>
                <span className={`rounded-full px-3 py-0.5 text-xs font-semibold uppercase ${signalBadge(fund.signal)}`}>{fund.signal}</span>
                <span className="ml-auto text-xs text-slate-400">Confidence <span className={`font-semibold ${signalColor(fund.signal)}`}>{fund.confidence}%</span></span>
              </div>

              {/* Fundamental reasoning */}
              <div className="rounded-lg border border-slate-700 overflow-hidden">
                <div className="bg-slate-800/60 px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide">Fundamental Analysis</div>
                <div className="divide-y divide-slate-800">
                  {reasoningRows.map(({ label, key }) => {
                    const row = fund.reasoning?.[key];
                    if (!row) return null;
                    return (
                      <div key={key} className="px-4 py-3 grid grid-cols-[120px_1fr] gap-3">
                        <div className="flex items-start gap-2">
                          <span className="text-xs text-slate-400 mt-0.5">{label}</span>
                        </div>
                        <div>
                          <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium mb-1 ${signalBadge(row.signal)}`}>{row.signal}</span>
                          <p className="text-xs text-slate-300 leading-relaxed">{row.details}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {tech && (
            <>
              {/* Technical signal */}
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-400 uppercase tracking-wide">Technical</span>
                <span className={`rounded-full px-3 py-0.5 text-xs font-semibold uppercase ${signalBadge(tech.signal)}`}>{tech.signal}</span>
                <span className="ml-auto text-xs text-slate-400">Confidence <span className={`font-semibold ${signalColor(tech.signal)}`}>{tech.confidence}%</span></span>
              </div>

              {/* Technical reasoning */}
              <div className="rounded-lg border border-slate-700 overflow-hidden">
                <div className="bg-slate-800/60 px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide">Technical Analysis</div>
                <div className="divide-y divide-slate-800">
                  {techRows.map(({ label, key }) => {
                    const row = tech.reasoning?.[key];
                    if (!row) return null;
                    return (
                      <div key={key} className="px-4 py-3 grid grid-cols-[120px_1fr] gap-3">
                        <span className="text-xs text-slate-400 mt-0.5">{label}</span>
                        <div>
                          <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium mb-1 ${signalBadge(row.signal)}`}>{row.signal}</span>
                          <p className="text-xs text-slate-300 leading-relaxed">{row.details}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {!loading && !error && !fund && (
            <div className="py-8 text-center text-sm text-slate-500">No analysis available for {ticker}.</div>
          )}
        </div>
      </div>
    </div>
  );
}

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

export default function TradeLog() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [symbol, setSymbol] = useState("");
  const [side, setSide] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [analysisTicker, setAnalysisTicker] = useState<string | null>(null);

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
      {analysisTicker && <AnalysisModal ticker={analysisTicker} onClose={() => setAnalysisTicker(null)} />}
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
              {["#", "Date", "Symbol", "Side", "Qty", "Entry", "Exit", "Fees", "P&L", "Notes"].map((h) => (
                <th key={h} className="px-3 py-2 text-left whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-slate-500">Loading…</td></tr>
            ) : trades.length === 0 ? (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-slate-500">No trades found</td></tr>
            ) : trades.map((t, i) => {
              const { text: pnlText, color: pnlColor } = fmtPnl(t.pnl);
              return (
                <tr key={t.id} className="border-t border-slate-800 hover:bg-slate-800/40">
                  <td className="px-3 py-2 text-slate-500">{(page - 1) * 50 + i + 1}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {t.tradeDate ? new Date(t.tradeDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }) : "—"}
                  </td>
                  <td className="px-3 py-2 font-medium">
                    {t.pnl === null ? (
                      <button
                        onClick={() => setAnalysisTicker(t.ticker)}
                        className="font-medium text-blue-400 hover:text-blue-300 hover:underline underline-offset-2 cursor-pointer"
                        title="Click for AI analysis"
                      >
                        {t.ticker}
                      </button>
                    ) : t.ticker}
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
