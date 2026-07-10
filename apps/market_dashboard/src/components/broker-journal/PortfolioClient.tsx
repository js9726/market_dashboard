"use client";

import { Fragment, useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { observedLabel, usMarketSession } from "@/lib/market-clock";
import Icon from "@/components/market-desk/Icon";

type Position = {
  id: string;
  ticker: string;
  qty: number;
  avgCost: number;
  currency: string;
  currentPrice: number | null;
  marketValue: number | null;
  unrealizedPl: number | null;
  unrealizedPlPct: number | null;
  changePct: number | null;
  openedAt: string;
  lastFillAt: string;
  priceObservedAt: string | null;
  priceSource: string | null;
  stale: boolean;
  latestTradeRecordId: string | null;
};

type Account = {
  id: string;
  alias: string;
  presetName: string;
  currency: string;
  region: string;
  isLive: boolean;
  positions: Position[];
  pricedCount: number;
  unpricedCount: number;
  totals: {
    cost: number;
    marketValue: number | null;
    unrealizedPl: number | null;
    unrealizedPlPct: number | null;
  };
};

type PortfolioData = {
  accounts: Account[];
  grandTotals: {
    cost: number;
    marketValue: number | null;
    unrealizedPl: number | null;
    unrealizedPlPct: number | null;
    pricedCount: number;
    unpricedCount: number;
  };
  asOf: string;
};

function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function toneClass(n: number | null | undefined): string {
  if (n == null) return "text-[var(--fg-3)]";
  if (n > 0) return "gain";
  if (n < 0) return "loss";
  return "text-[var(--fg-3)]";
}

function signedValue(n: number | null | undefined, digits = 2, suffix = ""): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${fmt(n, digits)}${suffix}`;
}

function StatTile({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: string;
}) {
  return (
    <div className="market-panel p-4">
      <div className="mb-1 flex min-h-[18px] items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--fg-3)]">{label}</p>
        {note ? <span className="font-mono text-[10px] font-bold text-[var(--warn-500)]">{note}</span> : null}
      </div>
      <p className={`font-mono text-[20px] font-extrabold tabular-nums ${tone ?? "text-[var(--fg-1)]"}`}>
        {value}
      </p>
    </div>
  );
}

/** Close-position inline form state (client-beta: user-defined qty/price/date). */
type CloseDraft = {
  accountId: string;
  ticker: string;
  maxQty: number;
  qty: string;
  price: string;
  date: string; // YYYY-MM-DD, user-editable
};

const inputClass =
  "mt-1 rounded border border-[var(--line)] bg-[var(--bg-surface)] px-2 py-1.5 font-mono text-[12px] normal-case text-[var(--fg-1)] outline-none focus:border-[var(--accent)]";

export default function PortfolioClient() {
  const [data, setData] = useState<PortfolioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [closeDraft, setCloseDraft] = useState<CloseDraft | null>(null);
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  function startClose(accountId: string, p: Position) {
    setCloseError(null);
    setCloseDraft({
      accountId,
      ticker: p.ticker,
      maxQty: p.qty,
      qty: String(p.qty),
      price: p.currentPrice != null ? String(p.currentPrice) : String(p.avgCost),
      date: new Date().toISOString().slice(0, 10),
    });
  }

  async function submitClose() {
    if (!closeDraft) return;
    const qty = Number(closeDraft.qty);
    const price = Number(closeDraft.price);
    if (!Number.isFinite(qty) || qty <= 0 || qty > closeDraft.maxQty) {
      setCloseError(`Quantity must be between 0 and ${closeDraft.maxQty}.`);
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      setCloseError("Enter the exit price you actually sold at.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(closeDraft.date)) {
      setCloseError("Pick the exit date.");
      return;
    }
    setCloseBusy(true);
    setCloseError(null);
    try {
      // executedAt: the user picks the DATE; time is pinned to 16:00 ET (20:00
      // UTC) so journal ordering is sensible.
      const res = await fetch("/api/trades/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brokerAccountId: closeDraft.accountId,
          ticker: closeDraft.ticker,
          side: "SELL",
          qty,
          price,
          executedAt: `${closeDraft.date}T20:00:00.000Z`,
          notes: "Closed from Portfolio",
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setCloseDraft(null);
      await load();
    } catch (e) {
      setCloseError(e instanceof Error ? e.message : "Close failed.");
    } finally {
      setCloseBusy(false);
    }
  }

  async function load() {
    setRefreshing(true);
    const res = await fetch("/api/portfolio");
    const json = await res.json();
    setData(json);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  if (loading) {
    return (
      <section className="market-panel p-6">
        <p className="t-caption">Loading portfolio...</p>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="market-panel p-6">
        <p className="t-caption text-[var(--loss-fg)]">Failed to load portfolio.</p>
      </section>
    );
  }

  const marketSession = usMarketSession();
  const marketOpen = marketSession === "REGULAR";
  const hasFreshOpenDQuotes = data.accounts.some((acct) =>
    acct.positions.some((p) => p.priceSource === "moomoo" && !p.stale),
  );
  const extendedSessionLive =
    hasFreshOpenDQuotes && (marketSession === "PREMARKET" || marketSession === "AFTER_HOURS");
  const positionChangeIsLive = (p: Position) =>
    marketOpen ? !p.stale : extendedSessionLive && !p.stale && p.priceSource === "moomoo";

  const pricedNote =
    data.grandTotals.unpricedCount > 0
      ? `${data.grandTotals.pricedCount}/${data.grandTotals.pricedCount + data.grandTotals.unpricedCount} priced`
      : null;

  return (
    <div className="space-y-5">
      <header className="market-panel p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--bg-raised)] text-[var(--accent)]">
                <Icon name="portfolio" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--fg-3)]">Broker journal</p>
                <h1 className="text-[22px] font-extrabold leading-tight text-[var(--fg-1)]">Portfolio</h1>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-[var(--bg-raised)] px-2 py-1 font-mono text-[11px] text-[var(--fg-2)]">
                As of {new Date(data.asOf).toLocaleString()}
              </span>
              {refreshing ? (
                <span className="rounded bg-[var(--accent-soft-bg)] px-2 py-1 font-mono text-[11px] font-bold text-[var(--accent)]">
                  refreshing...
                </span>
              ) : null}
              {extendedSessionLive ? (
                <span className="rounded bg-[var(--gain-bg)] px-2 py-1 font-mono text-[11px] font-bold text-[var(--gain-fg)]">
                  {marketSession === "PREMARKET" ? "PREMARKET" : "AFTER HOURS"} - moomoo OpenD live quotes
                </span>
              ) : null}
              {!extendedSessionLive && !marketOpen ? (
                <span className="rounded bg-[var(--bg-raised)] px-2 py-1 font-mono text-[11px] font-bold text-[var(--warn-500)]">
                  MARKET CLOSED - Today shows last session
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link className="mds-button h-9 px-3 text-[12px]" href="/dashboard/settings/brokers" title="Manage broker accounts">
              <Icon name="accounts" />
              Brokers
            </Link>
            <Link className="mds-button h-9 px-3 text-[12px]" href="/dashboard/portfolio/import">
              <Icon name="import" />
              Import CSV
            </Link>
            <button className="mds-button h-9 px-3 text-[12px]" disabled={refreshing} onClick={load} type="button">
              <Icon name="replay" />
              Refresh
            </button>
            <Link className="mds-button mds-button--primary h-9 px-3 text-[12px]" href="/dashboard/portfolio/new">
              <Icon name="plus" />
              New trade
            </Link>
          </div>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Cost basis" value={fmt(data.grandTotals.cost)} />
        <StatTile label="Market value" value={fmt(data.grandTotals.marketValue)} />
        <StatTile
          label="Unrealised P&L"
          note={pricedNote}
          tone={toneClass(data.grandTotals.unrealizedPl)}
          value={signedValue(data.grandTotals.unrealizedPl)}
        />
        <StatTile
          label="Return"
          tone={toneClass(data.grandTotals.unrealizedPlPct)}
          value={signedValue(data.grandTotals.unrealizedPlPct, 2, "%")}
        />
      </section>

      {data.accounts.length === 0 ? (
        <section className="market-panel border-dashed p-6 text-center">
          <p className="mb-4 text-sm text-[var(--fg-2)]">
            No broker accounts yet. Add one to start tracking positions, or read the quick guide.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link className="mds-button mds-button--primary h-9 px-4 text-[12px]" href="/dashboard/settings/brokers">
              <Icon name="accounts" />
              Add account
            </Link>
            <Link className="mds-button h-9 px-4 text-[12px]" href="/dashboard/guide">
              <Icon name="journal" />
              Guide
            </Link>
          </div>
        </section>
      ) : null}

      {data.accounts.map((acct) => (
        <section className="market-panel overflow-hidden" key={acct.id}>
          <header className="flex flex-col gap-3 border-b border-[var(--line)] bg-[var(--bg-raised)] p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-extrabold text-[var(--fg-1)]">{acct.alias}</h2>
                <span className="rounded bg-[var(--bg-surface)] px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-[var(--fg-3)]">
                  {acct.isLive ? "Live" : "Paper"}
                </span>
              </div>
              <p className="mt-1 font-mono text-[11px] text-[var(--fg-3)]">
                {acct.presetName} / {acct.region} / {acct.currency}
              </p>
            </div>
            <div className="font-mono text-sm font-extrabold tabular-nums">
              <span className={toneClass(acct.totals.unrealizedPl)}>
                {acct.totals.unrealizedPl != null ? signedValue(acct.totals.unrealizedPl) : "Awaiting quotes"}
              </span>
              {acct.totals.unrealizedPlPct != null ? (
                <span className={`ml-2 ${toneClass(acct.totals.unrealizedPlPct)}`}>
                  ({signedValue(acct.totals.unrealizedPlPct, 2, "%")})
                </span>
              ) : null}
              {acct.unpricedCount > 0 && acct.pricedCount > 0 ? (
                <span className="ml-2 text-[11px] text-[var(--warn-500)]">
                  {acct.pricedCount}/{acct.pricedCount + acct.unpricedCount} priced
                </span>
              ) : null}
            </div>
          </header>

          {acct.positions.length === 0 ? (
            <p className="p-4 text-[12px] italic text-[var(--fg-3)]">No open positions in this account.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-right text-[12px]">
                <thead className="text-[10px] uppercase tracking-[0.12em] text-[var(--fg-3)]">
                  <tr className="border-b border-[var(--line)]">
                    <th className="py-2 pl-4 pr-3 text-left font-bold">Ticker</th>
                    <th className="px-3 py-2 font-bold">Qty</th>
                    <th className="px-3 py-2 font-bold">Avg cost</th>
                    <th className="px-3 py-2 font-bold">Last price</th>
                    <th className="px-3 py-2 font-bold">Today</th>
                    <th className="px-3 py-2 font-bold">Market value</th>
                    <th className="px-3 py-2 font-bold">Unrealised P&L</th>
                    <th className="px-3 py-2 font-bold">Return</th>
                    <th className="py-2 pl-3 pr-4 font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {acct.positions.map((p) => {
                    const closeActive = closeDraft?.accountId === acct.id && closeDraft.ticker === p.ticker;
                    return (
                      <Fragment key={p.id}>
                        <tr className="border-b border-[var(--line)] last:border-0">
                          <td className="py-3 pl-4 pr-3 text-left">
                            <div className="flex flex-wrap items-center gap-2">
                              {p.latestTradeRecordId ? (
                                <Link
                                  className="t-ticker text-[var(--accent)] hover:underline"
                                  href={`/dashboard/journal/trades/${p.latestTradeRecordId}`}
                                  title="Open journal entry"
                                >
                                  {p.ticker}
                                </Link>
                              ) : (
                                <span className="t-ticker">{p.ticker}</span>
                              )}
                              {p.stale ? (
                                <span
                                  className="rounded bg-[var(--bg-raised)] px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-[var(--warn-500)]"
                                  title="Stale quote - server prices refresh twice per hour during US market hours"
                                >
                                  stale
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-0.5 font-mono text-[10px] text-[var(--fg-3)]">{p.currency}</p>
                          </td>
                          <td className="px-3 py-3 font-mono tabular-nums">{fmt(p.qty, 0)}</td>
                          <td className="px-3 py-3 font-mono tabular-nums">{fmt(p.avgCost, 4)}</td>
                          <td className="px-3 py-3 font-mono tabular-nums">{fmt(p.currentPrice, 4)}</td>
                          <td className={`px-3 py-3 font-mono tabular-nums ${positionChangeIsLive(p) ? toneClass(p.changePct) : "text-[var(--fg-3)]"}`}>
                            {signedValue(p.changePct, 2, "%")}
                            {p.changePct != null && !positionChangeIsLive(p) ? (
                              <span className="block text-[10px] font-normal text-[var(--fg-3)]">
                                as of {observedLabel(p.priceObservedAt) ?? "last session"}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-3 font-mono tabular-nums">{fmt(p.marketValue)}</td>
                          <td className={`px-3 py-3 font-mono tabular-nums ${toneClass(p.unrealizedPl)}`}>
                            {signedValue(p.unrealizedPl)}
                          </td>
                          <td className={`px-3 py-3 font-mono tabular-nums ${toneClass(p.unrealizedPlPct)}`}>
                            {signedValue(p.unrealizedPlPct, 2, "%")}
                          </td>
                          <td className="py-3 pl-3 pr-4">
                            <button
                              className={`mds-button h-7 px-2 text-[11px] ${closeActive ? "border-[var(--warn-500)] text-[var(--warn-500)]" : ""}`}
                              onClick={() => (closeActive ? setCloseDraft(null) : startClose(acct.id, p))}
                              type="button"
                            >
                              {closeActive ? "Cancel" : "Close"}
                            </button>
                          </td>
                        </tr>
                        {closeActive ? (
                          <tr className="border-b border-[var(--line)] bg-[var(--bg-raised)]">
                            <td className="px-4 py-3" colSpan={9}>
                              <div className="flex flex-wrap items-end gap-3">
                                <strong className="text-[12px] text-[var(--fg-1)]">Close {p.ticker}</strong>
                                <label className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--fg-3)]">
                                  Quantity (max {fmt(closeDraft.maxQty, 0)})
                                  <input
                                    className={`${inputClass} w-28`}
                                    max={closeDraft.maxQty}
                                    min={0}
                                    onChange={(e) => setCloseDraft({ ...closeDraft, qty: e.target.value })}
                                    step="any"
                                    type="number"
                                    value={closeDraft.qty}
                                  />
                                </label>
                                <label className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--fg-3)]">
                                  Exit price
                                  <input
                                    className={`${inputClass} w-28`}
                                    min={0}
                                    onChange={(e) => setCloseDraft({ ...closeDraft, price: e.target.value })}
                                    step="any"
                                    type="number"
                                    value={closeDraft.price}
                                  />
                                </label>
                                <label className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--fg-3)]">
                                  Exit date
                                  <input
                                    className={`${inputClass} w-36`}
                                    onChange={(e) => setCloseDraft({ ...closeDraft, date: e.target.value })}
                                    type="date"
                                    value={closeDraft.date}
                                  />
                                </label>
                                <button
                                  className="mds-button h-8 px-3 text-[11px] disabled:cursor-wait disabled:opacity-60"
                                  disabled={closeBusy}
                                  onClick={submitClose}
                                  type="button"
                                >
                                  {closeBusy ? "Closing..." : Number(closeDraft.qty) < closeDraft.maxQty ? "Sell partial" : "Close position"}
                                </button>
                                {closeError ? <span className="text-[12px] text-[var(--loss-fg)]">{closeError}</span> : null}
                              </div>
                              <p className="mt-2 text-[11px] leading-relaxed text-[var(--fg-3)]">
                                Records a SELL fill at your price/date. The journal entry closes or trims automatically, and fees come from the account preset.
                              </p>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
