"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = { onClose: () => void };

const EMPTY = { ticker: "", tradeDate: "", side: "", buyPrice: "", quantity: "", exitPrice: "", pnl: "", fees: "", notes: "" };

export default function AddTradeModal({ onClose }: Props) {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function set(field: keyof typeof EMPTY, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.ticker || !form.tradeDate || !form.buyPrice || !form.quantity) {
      setError("Ticker, date, entry price and quantity are required.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/journal/trades/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, side: form.side || null }),
      });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add trade");
    } finally {
      setLoading(false);
    }
  }

  const inputCls = "w-full rounded bg-slate-700 border border-slate-600 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-slate-500";
  const labelCls = "block text-xs text-slate-400 mb-1";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-lg rounded-xl bg-slate-900 border border-slate-700 p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold">Add Trade</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Ticker *</label>
              <input className={inputCls} placeholder="AAPL" value={form.ticker} onChange={(e) => set("ticker", e.target.value.toUpperCase())} />
            </div>
            <div>
              <label className={labelCls}>Date *</label>
              <input type="date" className={inputCls} value={form.tradeDate} onChange={(e) => set("tradeDate", e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Side</label>
              <select className={inputCls} value={form.side} onChange={(e) => set("side", e.target.value)}>
                <option value="">—</option>
                <option value="Long">Long</option>
                <option value="Short">Short</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Entry Price *</label>
              <input className={inputCls} placeholder="0.00" value={form.buyPrice} onChange={(e) => set("buyPrice", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Quantity *</label>
              <input className={inputCls} placeholder="100" value={form.quantity} onChange={(e) => set("quantity", e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Exit Price</label>
              <input className={inputCls} placeholder="0.00" value={form.exitPrice} onChange={(e) => set("exitPrice", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>P&L</label>
              <input className={inputCls} placeholder="0.00" value={form.pnl} onChange={(e) => set("pnl", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Fees</label>
              <input className={inputCls} placeholder="0.00" value={form.fees} onChange={(e) => set("fees", e.target.value)} />
            </div>
          </div>

          <div>
            <label className={labelCls}>Notes</label>
            <input className={inputCls} placeholder="Optional" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg bg-slate-700 hover:bg-slate-600 py-2 text-sm font-medium transition">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="flex-1 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 py-2 text-sm font-medium transition">
              {loading ? "Adding…" : "Add Trade"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
