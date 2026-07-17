"use client";

/**
 * GoalsAlertsCard — goals with live progress + in-app alerts on the Journal
 * home (TradesViz-platform P4-🄺). Alerts are dashboard-only (Telegram push is
 * on hold); goals are CRUD-able inline.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Goal = {
  id: string;
  kind: string;
  label: string;
  target: number | null;
  unit: string | null;
  actual: number | null;
  progress: number | null;
  status: string;
  note: string;
  measuredTrades: number;
};
type Alert = { key: string; severity: "info" | "warn" | "danger"; title: string; detail: string; href?: string };

const KIND_LABEL: Record<string, string> = {
  PNL: "P&L target",
  MAX_DAILY_LOSS: "Max daily loss",
  MAX_DRAWDOWN: "Max drawdown",
  WIN_RATE: "Win rate",
  PROCESS: "Process",
};
const STATUS_TONE: Record<string, string> = {
  achieved: "gain",
  "on-track": "text-[var(--fg-2)]",
  "at-risk": "text-[var(--warn-fg,#f59e0b)]",
  breached: "loss",
  manual: "text-[var(--fg-3)]",
};
const SEV_BORDER: Record<string, string> = {
  danger: "var(--loss-fg, #dc2626)",
  warn: "var(--warn-fg, #f59e0b)",
  info: "var(--accent)",
};

function fmt(n: number | null | undefined, unit?: string | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = n.toLocaleString(undefined, { maximumFractionDigits: unit === "%" ? 1 : 0 });
  return unit === "%" ? `${s}%` : `$${s}`;
}

export default function GoalsAlertsCard() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState({ kind: "MAX_DAILY_LOSS", label: "", target: "" });

  const load = useCallback(async () => {
    const [g, a] = await Promise.all([
      fetch("/api/goals", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/alerts", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (g?.goals) setGoals(g.goals);
    if (a?.alerts) setAlerts(a.alerts);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function addGoal() {
    if (busy) return;
    const target = draft.target.trim() === "" ? null : Number(draft.target);
    const label = draft.label.trim() || KIND_LABEL[draft.kind];
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: draft.kind, label, target }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setDraft({ kind: "MAX_DAILY_LOSS", label: "", target: "" });
      setAdding(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeGoal(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/goals?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-surface)] px-2 py-1.5 text-xs text-[var(--fg-1)] outline-none focus:border-[var(--accent)]";

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Alerts */}
      <section className="market-panel p-4">
        <p className="t-overline mb-2 text-[var(--fg-3)]">Alerts</p>
        {loading ? (
          <p className="t-caption text-[var(--fg-3)]">Loading…</p>
        ) : alerts.length === 0 ? (
          <p className="t-caption text-[var(--fg-3)]">Nothing to flag — no rule breaches, bridge healthy, data clean.</p>
        ) : (
          <ul className="space-y-2">
            {alerts.map((a) => {
              const body = (
                <>
                  <p className="text-sm font-semibold text-[var(--fg-1)]">{a.title}</p>
                  <p className="t-caption mt-0.5 text-[var(--fg-3)]">{a.detail}</p>
                </>
              );
              return (
                <li key={a.key} className="border-l-2 pl-3" style={{ borderColor: SEV_BORDER[a.severity] }}>
                  {a.href ? (
                    <Link href={a.href} className="block hover:opacity-80">
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Goals */}
      <section className="market-panel p-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="t-overline text-[var(--fg-3)]">Goals</p>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="t-caption text-[var(--accent)] hover:underline"
          >
            {adding ? "Cancel" : "+ Add"}
          </button>
        </div>

        {adding && (
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <label className="t-caption text-[var(--fg-3)]">
              Kind
              <br />
              <select className={`${inputCls} mt-1`} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
                {Object.entries(KIND_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="t-caption text-[var(--fg-3)]">
              Target {draft.kind === "WIN_RATE" ? "(%)" : draft.kind === "PROCESS" ? "(n/a)" : "($, positive)"}
              <br />
              <input
                type="number"
                className={`${inputCls} mt-1 w-24`}
                value={draft.target}
                disabled={draft.kind === "PROCESS"}
                onChange={(e) => setDraft({ ...draft, target: e.target.value })}
              />
            </label>
            <label className="t-caption min-w-0 flex-1 text-[var(--fg-3)]">
              Label
              <br />
              <input
                className={`${inputCls} mt-1 w-full`}
                placeholder={KIND_LABEL[draft.kind]}
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              />
            </label>
            <button
              type="button"
              onClick={addGoal}
              disabled={busy}
              className="rounded-[var(--radius-sm)] border border-[var(--accent-soft-border)] bg-[var(--accent-soft-bg)] px-3 py-1.5 text-xs font-bold text-[var(--accent)] disabled:opacity-40"
            >
              Save
            </button>
          </div>
        )}
        {err && <p className="t-caption mb-2 text-[var(--loss-fg)]">{err}</p>}

        {loading ? (
          <p className="t-caption text-[var(--fg-3)]">Loading…</p>
        ) : goals.length === 0 ? (
          <p className="t-caption text-[var(--fg-3)]">
            No goals yet. A <strong>max daily loss</strong> is the highest-value one to set — it powers the breach alert.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {goals.map((g) => (
              <li key={g.id}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-semibold text-[var(--fg-1)]">{g.label}</span>
                  <span className={`font-mono text-xs ${STATUS_TONE[g.status] ?? ""}`}>
                    {fmt(g.actual, g.unit)}
                    {g.target != null && <span className="text-[var(--fg-3)]"> / {fmt(g.target, g.unit)}</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeGoal(g.id)}
                    className="t-caption shrink-0 text-[var(--fg-3)] hover:text-[var(--loss-fg)]"
                    aria-label={`Delete ${g.label}`}
                  >
                    ×
                  </button>
                </div>
                {g.progress != null && (
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-raised)]">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.round(g.progress * 100)}%`,
                        background:
                          g.status === "breached"
                            ? "var(--loss-fg, #dc2626)"
                            : g.status === "at-risk"
                              ? "var(--warn-fg, #f59e0b)"
                              : g.status === "achieved"
                                ? "var(--gain-fg, #16a34a)"
                                : "var(--accent)",
                      }}
                    />
                  </div>
                )}
                <p className="t-caption mt-0.5 text-[var(--fg-3)]">
                  {KIND_LABEL[g.kind] ?? g.kind} · {g.status} · {g.note}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
