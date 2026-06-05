"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type SettingsPayload = {
  connection: {
    spreadsheetId: string;
    sheetTab: string;
    headerRow: number;
    lastSyncedAt: string | null;
    fixedFxRate: number | null;
  } | null;
};

export default function SettingsHome() {
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [fxRate, setFxRate] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/journal/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((payload: SettingsPayload) => {
        setData(payload);
        setFxRate(payload.connection?.fixedFxRate ? String(payload.connection.fixedFxRate) : "");
      })
      .catch((e: Error) => setMessage(e.message));
  }, []);

  async function saveFxRate() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/journal/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fixedFxRate: fxRate.trim() === "" ? null : Number(fxRate) }),
      });
      const payload = (await res.json()) as { fixedFxRate?: number | null; error?: string };
      if (!res.ok) throw new Error(payload.error ?? `HTTP ${res.status}`);
      setFxRate(payload.fixedFxRate ? String(payload.fixedFxRate) : "");
      setMessage("Saved");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const connection = data?.connection ?? null;

  return (
    <div className="space-y-5 p-5">
      <div>
        <p className="t-overline text-[var(--fg-3)]">Settings</p>
        <p className="t-caption">
          Journal mapping, fixed sheet FX, broker bridge setup, and data-source controls.
        </p>
      </div>

      <section className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[var(--fg-1)]">Google Sheet Mapping</p>
            <p className="mt-1 text-sm text-[var(--fg-2)]">
              {connection
                ? `Connected to ${connection.sheetTab}, header row ${connection.headerRow}.`
                : "No journal sheet connected yet."}
            </p>
            {connection?.lastSyncedAt ? (
              <p className="mt-1 text-xs text-[var(--fg-3)]">
                Last synced {new Date(connection.lastSyncedAt).toLocaleString()}.
              </p>
            ) : null}
          </div>
          <Link
            href="/journal/connect"
            className="rounded-[var(--radius-sm)] border border-[var(--accent-soft-border)] bg-[var(--accent-soft-bg)] px-3 py-1.5 text-xs font-medium text-[var(--accent)] transition hover:opacity-90"
          >
            {connection ? "Remap Sheet" : "Connect Sheet"}
          </Link>
        </div>
      </section>

      <section className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-card)]">
        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <p className="text-sm font-semibold text-[var(--fg-1)]">Fixed Sheet FX Rate</p>
            <p className="mt-1 text-sm text-[var(--fg-2)]">
              The journal sheet records closed-trade P&amp;L in MYR. Enter the fixed MYR per USD rate used by the sheet so historical P&amp;L can report in USD.
            </p>
            <label className="mt-3 block text-xs text-[var(--fg-3)]" htmlFor="fixed-fx-rate">
              MYR per USD
            </label>
            <input
              id="fixed-fx-rate"
              type="number"
              inputMode="decimal"
              step="0.000001"
              value={fxRate}
              onChange={(e) => setFxRate(e.target.value)}
              placeholder="4.700000"
              className="mt-1 w-full max-w-xs rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-raised)] px-3 py-2 text-sm text-[var(--fg-1)] focus:border-[var(--accent)] focus:outline-none"
              disabled={!connection}
            />
          </div>
          <button
            type="button"
            onClick={saveFxRate}
            disabled={saving || !connection}
            className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-raised)] px-4 py-2 text-xs font-medium text-[var(--fg-2)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save FX"}
          </button>
        </div>
        {message ? <p className="mt-3 text-xs text-[var(--fg-3)]">{message}</p> : null}
      </section>

      <section className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[var(--fg-1)]">Broker Connections</p>
            <p className="mt-1 text-sm text-[var(--fg-2)]">
              MooMoo and IBKR live positions remain the source of truth when the bridge is connected.
            </p>
          </div>
          <Link
            href="/dashboard/settings/brokers"
            className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-raised)] px-3 py-1.5 text-xs font-medium text-[var(--fg-2)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            Manage Brokers
          </Link>
        </div>
      </section>
    </div>
  );
}
