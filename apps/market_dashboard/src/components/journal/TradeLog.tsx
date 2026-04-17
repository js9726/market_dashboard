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
                  <td className="px-3 py-2 font-medium">{t.ticker}</td>
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
