"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { calculateFees, type FeeFormula, type FeeSide } from "@/lib/fees";

type Account = {
  id: string;
  alias: string;
  displayCurrency: string | null;
  isLive: boolean;
  preset: { name: string; region: string; currency: string };
};

type Preset = {
  id: string;
  name: string;
  feeFormula: FeeFormula;
};

export default function ManualTradeClient() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form fields
  const [brokerAccountId, setBrokerAccountId] = useState("");
  const [ticker, setTicker] = useState("");
  const [side, setSide] = useState<FeeSide>("BUY");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [executedAt, setExecutedAt] = useState(() => {
    // Default to current time, formatted for datetime-local
    const d = new Date();
    d.setSeconds(0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [notes, setNotes] = useState("");
  const [proposedSL, setProposedSL] = useState("");
  const [proposedTP, setProposedTP] = useState("");

  useEffect(() => {
    (async () => {
      const [a, p] = await Promise.all([
        fetch("/api/broker-accounts").then((r) => r.json()),
        fetch("/api/broker-presets").then((r) => r.json()),
      ]);
      setAccounts(a.accounts ?? []);
      setPresets(p.presets ?? []);
      if (a.accounts?.length === 1) setBrokerAccountId(a.accounts[0].id);
      setLoading(false);
    })();
  }, []);

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === brokerAccountId),
    [accounts, brokerAccountId],
  );

  const selectedPreset = useMemo(
    () => (selectedAccount ? presets.find((p) => p.name === selectedAccount.preset.name) : null),
    [presets, selectedAccount],
  );

  const feePreview = useMemo(() => {
    const q = Number(qty);
    const p = Number(price);
    if (!selectedPreset || !Number.isFinite(q) || !Number.isFinite(p) || q <= 0 || p <= 0) {
      return null;
    }
    return calculateFees(selectedPreset.feeFormula, q, p, side);
  }, [selectedPreset, qty, price, side]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/trades/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brokerAccountId,
          ticker: ticker.trim().toUpperCase(),
          side,
          qty: Number(qty),
          price: Number(price),
          executedAt: new Date(executedAt).toISOString(),
          notes: notes.trim() || undefined,
          proposedSL: proposedSL ? Number(proposedSL) : undefined,
          proposedTP: proposedTP ? Number(proposedTP) : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setSuccess(`Trade saved (#${json.tradeRecordId.slice(0, 8)})`);
      setTicker("");
      setQty("");
      setPrice("");
      setNotes("");
      setProposedSL("");
      setProposedTP("");
      // Refresh router so portfolio table shows new row when user navigates
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div style={{ padding: "2rem" }}>Loading…</div>;

  if (accounts.length === 0) {
    return (
      <div style={{ padding: "2rem", maxWidth: 600 }}>
        <h1>New trade</h1>
        <p style={{ color: "#666" }}>
          You don&apos;t have any broker accounts yet. Add one in{" "}
          <Link href="/dashboard/settings/brokers" style={{ color: "#1d4ed8" }}>
            broker settings
          </Link>{" "}
          first.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: "1.5rem", maxWidth: 700 }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>New trade</h1>
      <p style={{ color: "#666", marginBottom: "1.5rem" }}>
        Manually log a trade. Fees are calculated from the selected broker preset.
      </p>

      <form onSubmit={submit}>
        <label style={{ display: "block", marginBottom: "0.75rem" }}>
          Broker account
          <select
            value={brokerAccountId}
            onChange={(e) => setBrokerAccountId(e.target.value)}
            style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem" }}
            required
          >
            <option value="">-- choose --</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.alias} ({a.preset.name}, {a.displayCurrency ?? a.preset.currency})
                {a.isLive ? " · Live" : " · Paper"}
              </option>
            ))}
          </select>
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
          <label>
            Ticker
            <input
              type="text"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              placeholder="US.HUT  or  HK.00700"
              style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem", boxSizing: "border-box" }}
              required
            />
          </label>
          <label>
            Side
            <select
              value={side}
              onChange={(e) => setSide(e.target.value as FeeSide)}
              style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem" }}
            >
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
          <label>
            Quantity
            <input
              type="number"
              step="any"
              min="0"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem", boxSizing: "border-box" }}
              required
            />
          </label>
          <label>
            Price
            <input
              type="number"
              step="any"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem", boxSizing: "border-box" }}
              required
            />
          </label>
        </div>

        <label style={{ display: "block", marginBottom: "0.75rem" }}>
          Executed at
          <input
            type="datetime-local"
            value={executedAt}
            onChange={(e) => setExecutedAt(e.target.value)}
            style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem", boxSizing: "border-box" }}
            required
          />
        </label>

        <details style={{ marginBottom: "0.75rem" }}>
          <summary style={{ cursor: "pointer", color: "#1d4ed8" }}>Pre-trade plan (optional)</summary>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginTop: "0.5rem" }}>
            <label>
              Stop loss
              <input
                type="number"
                step="any"
                value={proposedSL}
                onChange={(e) => setProposedSL(e.target.value)}
                style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem", boxSizing: "border-box" }}
              />
            </label>
            <label>
              Take profit
              <input
                type="number"
                step="any"
                value={proposedTP}
                onChange={(e) => setProposedTP(e.target.value)}
                style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem", boxSizing: "border-box" }}
              />
            </label>
          </div>
        </details>

        <label style={{ display: "block", marginBottom: "0.75rem" }}>
          Notes (optional)
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem", boxSizing: "border-box" }}
          />
        </label>

        {feePreview && (
          <div
            style={{
              padding: "0.75rem",
              background: "#f3f4f6",
              border: "1px solid #e5e7eb",
              borderRadius: "0.375rem",
              marginBottom: "0.75rem",
              fontSize: "0.875rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Estimated fees</span>
              <strong>{selectedAccount?.preset.currency} {feePreview.total.toFixed(4)}</strong>
            </div>
            {feePreview.components.length > 0 && (
              <div style={{ color: "#666", marginTop: "0.25rem", fontSize: "0.8rem" }}>
                {feePreview.components.map((c) => `${c.name} ${c.amount.toFixed(4)}`).join(" + ")}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.5rem", borderTop: "1px solid #e5e7eb", paddingTop: "0.25rem" }}>
              <span>Net {side === "BUY" ? "cost" : "proceeds"}</span>
              <strong>
                {selectedAccount?.preset.currency}{" "}
                {(Number(qty) * Number(price) + (side === "BUY" ? feePreview.total : -feePreview.total)).toFixed(2)}
              </strong>
            </div>
          </div>
        )}

        {error && <div style={{ color: "#b91c1c", marginBottom: "0.5rem" }}>{error}</div>}
        {success && <div style={{ color: "#16a34a", marginBottom: "0.5rem" }}>{success}</div>}

        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
          <Link href="/dashboard/portfolio" style={{ padding: "0.5rem 1rem", color: "#666", textDecoration: "none" }}>
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting}
            style={{
              padding: "0.5rem 1.25rem",
              background: submitting ? "#9ca3af" : "#1d4ed8",
              color: "white",
              border: "none",
              borderRadius: "0.375rem",
              cursor: submitting ? "wait" : "pointer",
            }}
          >
            {submitting ? "Saving…" : "Save trade"}
          </button>
        </div>
      </form>
    </div>
  );
}
