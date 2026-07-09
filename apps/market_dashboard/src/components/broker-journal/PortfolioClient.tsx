"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { observedLabel, usMarketSession } from "@/lib/market-clock";

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

function pnlColor(n: number | null | undefined): string {
  if (n == null) return "#6b7280";
  if (n > 0) return "#16a34a";
  if (n < 0) return "#dc2626";
  return "#6b7280";
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
      // UTC) — the session close — so journal ordering is sensible.
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
    const id = setInterval(load, 60_000);  // auto-refresh every 60s
    return () => clearInterval(id);
  }, []);

  if (loading) return <div style={{ padding: "2rem" }}>Loading portfolio…</div>;
  if (!data) return <div style={{ padding: "2rem", color: "#b91c1c" }}>Failed to load.</div>;

  const marketSession = usMarketSession();
  const marketOpen = marketSession === "REGULAR";
  const hasFreshOpenDQuotes = data.accounts.some((acct) =>
    acct.positions.some((p) => p.priceSource === "moomoo" && !p.stale),
  );
  const extendedSessionLive =
    hasFreshOpenDQuotes && (marketSession === "PREMARKET" || marketSession === "AFTER_HOURS");
  const positionChangeIsLive = (p: Position) =>
    marketOpen ? !p.stale : extendedSessionLive && !p.stale && p.priceSource === "moomoo";

  return (
    <div style={{ padding: "1.5rem" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>Portfolio</h1>
          <p style={{ color: "#666", margin: 0, fontSize: "0.85rem" }}>
            As of {new Date(data.asOf).toLocaleString()} {refreshing && <span>· refreshing…</span>}
            {extendedSessionLive && (
              <span style={{ marginLeft: "0.5rem", color: "#047857", fontWeight: 600 }}>
                {" - "}
                {marketSession === "PREMARKET" ? "PREMARKET" : "AFTER HOURS"}
                {" - moomoo OpenD live quotes"}
              </span>
            )}
            {!extendedSessionLive && !marketOpen && (
              <span style={{ marginLeft: "0.5rem", color: "#b45309", fontWeight: 600 }}>
                · MARKET CLOSED — &ldquo;Today&rdquo; shows the last session, not live
              </span>
            )}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <Link
            href="/dashboard/settings/brokers"
            title="Manage broker accounts"
            style={{
              padding: "0.5rem 0.75rem",
              background: "transparent",
              border: "1px solid #ddd",
              borderRadius: "0.375rem",
              color: "#374151",
              textDecoration: "none",
              fontSize: "0.9rem",
            }}
          >
            ⚙ Brokers
          </Link>
          <Link
            href="/dashboard/portfolio/import"
            style={{
              padding: "0.5rem 0.75rem",
              background: "transparent",
              border: "1px solid #ddd",
              borderRadius: "0.375rem",
              color: "#374151",
              textDecoration: "none",
              fontSize: "0.9rem",
            }}
          >
            Import CSV
          </Link>
          <button
            onClick={load}
            style={{
              padding: "0.5rem 0.75rem",
              background: "transparent",
              border: "1px solid #ddd",
              borderRadius: "0.375rem",
              cursor: "pointer",
            }}
          >
            Refresh
          </button>
          <Link
            href="/dashboard/portfolio/new"
            style={{
              padding: "0.5rem 1rem",
              background: "#1d4ed8",
              color: "white",
              borderRadius: "0.375rem",
              textDecoration: "none",
            }}
          >
            + New trade
          </Link>
        </div>
      </header>

      {/* Grand totals */}
      <div
        style={{
          padding: "1rem",
          background: "#f9fafb",
          border: "1px solid #e5e7eb",
          borderRadius: "0.5rem",
          marginBottom: "1.5rem",
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "1rem",
        }}
      >
        <div>
          <div style={{ color: "#6b7280", fontSize: "0.8rem" }}>Cost basis</div>
          <div style={{ fontSize: "1.25rem", fontWeight: 600 }}>{fmt(data.grandTotals.cost)}</div>
        </div>
        <div>
          <div style={{ color: "#6b7280", fontSize: "0.8rem" }}>Market value</div>
          <div style={{ fontSize: "1.25rem", fontWeight: 600 }}>{fmt(data.grandTotals.marketValue)}</div>
        </div>
        <div>
          <div style={{ color: "#6b7280", fontSize: "0.8rem" }}>
            Unrealised P&amp;L
            {data.grandTotals.unpricedCount > 0 && (
              <span title="Excludes positions awaiting live quote" style={{ color: "#f59e0b", marginLeft: "0.25rem" }}>
                · {data.grandTotals.pricedCount}/{data.grandTotals.pricedCount + data.grandTotals.unpricedCount} priced
              </span>
            )}
          </div>
          <div style={{ fontSize: "1.25rem", fontWeight: 600, color: pnlColor(data.grandTotals.unrealizedPl) }}>
            {data.grandTotals.unrealizedPl != null
              ? `${data.grandTotals.unrealizedPl >= 0 ? "+" : ""}${fmt(data.grandTotals.unrealizedPl)}`
              : "—"}
          </div>
        </div>
        <div>
          <div style={{ color: "#6b7280", fontSize: "0.8rem" }}>Return</div>
          <div style={{ fontSize: "1.25rem", fontWeight: 600, color: pnlColor(data.grandTotals.unrealizedPlPct) }}>
            {data.grandTotals.unrealizedPlPct != null
              ? `${data.grandTotals.unrealizedPlPct >= 0 ? "+" : ""}${fmt(data.grandTotals.unrealizedPlPct)}%`
              : "—"}
          </div>
        </div>
      </div>

      {data.accounts.length === 0 && (
        <div style={{ padding: "2rem", textAlign: "center", border: "1px dashed #ddd", borderRadius: "0.5rem", color: "#666" }}>
          No broker accounts yet.{" "}
          <Link href="/dashboard/settings/brokers" style={{ color: "#1d4ed8" }}>Add one</Link> to start
          tracking positions, or read the{" "}
          <Link href="/dashboard/guide" style={{ color: "#1d4ed8" }}>2-minute guide</Link>.
        </div>
      )}

      {data.accounts.map((acct) => (
        <section key={acct.id} style={{ marginBottom: "2rem" }}>
          <header
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              padding: "0.5rem 0",
              borderBottom: "2px solid #e5e7eb",
              marginBottom: "0.5rem",
            }}
          >
            <h2 style={{ margin: 0, fontSize: "1.1rem" }}>
              {acct.alias}{" "}
              <span style={{ color: "#6b7280", fontWeight: "normal", fontSize: "0.9rem" }}>
                · {acct.presetName} · {acct.region} · {acct.currency} {acct.isLive ? "· Live" : "· Paper"}
              </span>
            </h2>
            <div style={{ fontSize: "0.9rem", color: pnlColor(acct.totals.unrealizedPl) }}>
              {acct.totals.unrealizedPl != null
                ? `${acct.totals.unrealizedPl >= 0 ? "+" : ""}${fmt(acct.totals.unrealizedPl)}`
                : "Awaiting quotes"}
              {acct.totals.unrealizedPlPct != null && (
                <span> ({acct.totals.unrealizedPlPct >= 0 ? "+" : ""}{fmt(acct.totals.unrealizedPlPct)}%)</span>
              )}
              {acct.unpricedCount > 0 && acct.pricedCount > 0 && (
                <span style={{ color: "#f59e0b", marginLeft: "0.25rem" }}>
                  · {acct.pricedCount}/{acct.pricedCount + acct.unpricedCount} priced
                </span>
              )}
            </div>
          </header>

          {acct.positions.length === 0 ? (
            <div style={{ padding: "1rem", color: "#6b7280", fontStyle: "italic" }}>
              No open positions in this account.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
              <thead>
                <tr style={{ textAlign: "right", color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>
                  <th style={{ padding: "0.5rem", textAlign: "left" }}>Ticker</th>
                  <th style={{ padding: "0.5rem" }}>Qty</th>
                  <th style={{ padding: "0.5rem" }}>Avg cost</th>
                  <th style={{ padding: "0.5rem" }}>Last price</th>
                  <th style={{ padding: "0.5rem" }}>Today</th>
                  <th style={{ padding: "0.5rem" }}>Market value</th>
                  <th style={{ padding: "0.5rem" }}>Unrealised P&amp;L</th>
                  <th style={{ padding: "0.5rem" }}>Return</th>
                  <th style={{ padding: "0.5rem" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {acct.positions.map((p) => (
                  <Fragment key={p.id}>
                  <tr style={{ borderBottom: "1px solid #f3f4f6", textAlign: "right" }}>
                    <td style={{ padding: "0.5rem", textAlign: "left", fontWeight: 600 }}>
                      {p.latestTradeRecordId ? (
                        <Link
                          href={`/dashboard/journal/trades/${p.latestTradeRecordId}`}
                          title="Open journal entry"
                          style={{ color: "#1d4ed8", textDecoration: "none" }}
                        >
                          {p.ticker}
                        </Link>
                      ) : (
                        <span>{p.ticker}</span>
                      )}
                      {p.stale && (
                        <span title="Stale quote — server prices refresh twice per hour during US market hours" style={{ color: "#f59e0b", marginLeft: "0.25rem" }}>
                          ⏱
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "0.5rem" }}>{fmt(p.qty, 0)}</td>
                    <td style={{ padding: "0.5rem" }}>{fmt(p.avgCost, 4)}</td>
                    <td style={{ padding: "0.5rem" }}>{p.currentPrice != null ? fmt(p.currentPrice, 4) : "—"}</td>
                    <td style={{ padding: "0.5rem", color: positionChangeIsLive(p) ? pnlColor(p.changePct) : "#9ca3af" }}>
                      {p.changePct != null ? `${p.changePct >= 0 ? "+" : ""}${fmt(p.changePct)}%` : "—"}
                      {p.changePct != null && !positionChangeIsLive(p) && (
                        <span style={{ display: "block", fontSize: "0.7rem", color: "#9ca3af" }}>
                          as of {observedLabel(p.priceObservedAt) ?? "last session"}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "0.5rem" }}>{p.marketValue != null ? fmt(p.marketValue) : "—"}</td>
                    <td style={{ padding: "0.5rem", color: pnlColor(p.unrealizedPl) }}>
                      {p.unrealizedPl != null
                        ? `${p.unrealizedPl >= 0 ? "+" : ""}${fmt(p.unrealizedPl)}`
                        : "—"}
                    </td>
                    <td style={{ padding: "0.5rem", color: pnlColor(p.unrealizedPlPct) }}>
                      {p.unrealizedPlPct != null
                        ? `${p.unrealizedPlPct >= 0 ? "+" : ""}${fmt(p.unrealizedPlPct)}%`
                        : "—"}
                    </td>
                    <td style={{ padding: "0.5rem" }}>
                      <button
                        type="button"
                        onClick={() =>
                          closeDraft?.accountId === acct.id && closeDraft.ticker === p.ticker
                            ? setCloseDraft(null)
                            : startClose(acct.id, p)
                        }
                        style={{ padding: "0.15rem 0.6rem", fontSize: "0.8rem", border: "1px solid #d1d5db", borderRadius: "0.35rem", background: "#fff", cursor: "pointer" }}
                      >
                        {closeDraft?.accountId === acct.id && closeDraft.ticker === p.ticker ? "Cancel" : "Close"}
                      </button>
                    </td>
                  </tr>
                  {closeDraft?.accountId === acct.id && closeDraft.ticker === p.ticker && (
                    <tr style={{ background: "#f9fafb", borderBottom: "1px solid #f3f4f6" }}>
                      <td colSpan={9} style={{ padding: "0.6rem 0.5rem" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "end" }}>
                          <strong style={{ fontSize: "0.85rem" }}>Close {p.ticker}:</strong>
                          <label style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                            Quantity (max {fmt(closeDraft.maxQty, 0)})<br />
                            <input type="number" min={0} max={closeDraft.maxQty} step="any" value={closeDraft.qty}
                              onChange={(e) => setCloseDraft({ ...closeDraft, qty: e.target.value })}
                              style={{ width: "6.5rem", padding: "0.25rem", border: "1px solid #d1d5db", borderRadius: "0.25rem" }} />
                          </label>
                          <label style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                            Exit price<br />
                            <input type="number" min={0} step="any" value={closeDraft.price}
                              onChange={(e) => setCloseDraft({ ...closeDraft, price: e.target.value })}
                              style={{ width: "6.5rem", padding: "0.25rem", border: "1px solid #d1d5db", borderRadius: "0.25rem" }} />
                          </label>
                          <label style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                            Exit date<br />
                            <input type="date" value={closeDraft.date}
                              onChange={(e) => setCloseDraft({ ...closeDraft, date: e.target.value })}
                              style={{ padding: "0.25rem", border: "1px solid #d1d5db", borderRadius: "0.25rem" }} />
                          </label>
                          <button type="button" onClick={submitClose} disabled={closeBusy}
                            style={{ padding: "0.35rem 0.9rem", fontSize: "0.8rem", fontWeight: 600, border: "none", borderRadius: "0.35rem", background: closeBusy ? "#9ca3af" : "#dc2626", color: "#fff", cursor: closeBusy ? "wait" : "pointer" }}>
                            {closeBusy ? "Closing…" : Number(closeDraft.qty) < closeDraft.maxQty ? "Sell partial" : "Close position"}
                          </button>
                          {closeError && <span style={{ color: "#b91c1c", fontSize: "0.8rem" }}>{closeError}</span>}
                        </div>
                        <p style={{ margin: "0.4rem 0 0", fontSize: "0.72rem", color: "#9ca3af" }}>
                          Records a SELL fill at your price/date — the journal entry closes (or trims) automatically. Fees auto-calculated from the account preset.
                        </p>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </div>
  );
}
