"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MarketSnapshot, TickerRow } from "@/types/market-dashboard";

const BASE = "/market-dashboard";

// ─── helpers ────────────────────────────────────────────────────────────────

function pct(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function ratio(up: number, down: number): string {
  if (down === 0) return up > 0 ? "∞" : "—";
  return (up / down).toFixed(2);
}

// Compute breadth stats for a set of rows
function breadth(rows: TickerRow[]) {
  const valid = rows.filter((r) => r.daily != null && !isNaN(r.daily as number));
  const upDay   = valid.filter((r) => (r.daily ?? 0) > 0).length;
  const downDay = valid.filter((r) => (r.daily ?? 0) < 0).length;

  const valid5d = rows.filter((r) => r["5d"] != null && !isNaN(r["5d"] as number));
  const upWk   = valid5d.filter((r) => (r["5d"] ?? 0) > 0).length;
  const downWk = valid5d.filter((r) => (r["5d"] ?? 0) < 0).length;

  const valid20 = rows.filter((r) => r["20d"] != null && !isNaN(r["20d"] as number));
  const upMo   = valid20.filter((r) => (r["20d"] ?? 0) > 0).length;
  const downMo = valid20.filter((r) => (r["20d"] ?? 0) < 0).length;

  // Above SMA50 proxy: dist_sma50_atr > 0
  const sma50valid = rows.filter((r) => r.dist_sma50_atr != null && !isNaN(r.dist_sma50_atr as number));
  const aboveSma50 = sma50valid.filter((r) => (r.dist_sma50_atr ?? 0) > 0).length;
  const belowSma50 = sma50valid.length - aboveSma50;

  // High RS = RS >= 70 (strong momentum)
  const rsValid = rows.filter((r) => r.rs != null);
  const highRS  = rsValid.filter((r) => (r.rs ?? 0) >= 70).length;
  const lowRS   = rsValid.filter((r) => (r.rs ?? 0) <= 30).length;

  return { upDay, downDay, upWk, downWk, upMo, downMo, aboveSma50, belowSma50, highRS, lowRS, total: rows.length };
}

type BreadthStats = ReturnType<typeof breadth>;

// Cell colour: green bg for positive signal, red for negative, neutral for ratio
function metricCellStyle(label: string, val: string): React.CSSProperties {
  if (val === "—") return { color: "#475569", background: "transparent" };
  if (label.toLowerCase().includes("up") || label.toLowerCase().includes("above") || label.toLowerCase().includes("high rs")) {
    return { background: "#14532d", color: "#86efac" };
  }
  if (label.toLowerCase().includes("down") || label.toLowerCase().includes("below") || label.toLowerCase().includes("low rs")) {
    return { background: "#450a0a", color: "#fca5a5" };
  }
  // Ratio row — colour by value
  const num = parseFloat(val);
  if (!isNaN(num)) {
    if (num >= 1.5) return { background: "#14532d", color: "#86efac" };
    if (num >= 1.0) return { background: "#1c3a1a", color: "#6ee7b7" };
    if (num < 0.67) return { background: "#450a0a", color: "#fca5a5" };
    return { background: "#3b1a0a", color: "#fdba74" };
  }
  return { color: "#94a3b8", background: "transparent" };
}

const METRIC_ROWS: { label: string; key: keyof BreadthStats | "ratioDay" | "ratioWk" | "ratioMo" }[] = [
  { label: "Up (Day)",     key: "upDay" },
  { label: "Down (Day)",   key: "downDay" },
  { label: "Ratio (Day)",  key: "ratioDay" },
  { label: "Up (Week)",    key: "upWk" },
  { label: "Down (Week)",  key: "downWk" },
  { label: "Ratio (Wk)",   key: "ratioWk" },
  { label: "Up (Month)",   key: "upMo" },
  { label: "Down (Month)", key: "downMo" },
  { label: "Ratio (Mo)",   key: "ratioMo" },
  { label: "Above SMA50",  key: "aboveSma50" },
  { label: "Below SMA50",  key: "belowSma50" },
  { label: "High RS (≥70)", key: "highRS" },
  { label: "Low RS (≤30)", key: "lowRS" },
];

function getMetricValue(stats: BreadthStats, key: string): string {
  if (key === "ratioDay") return ratio(stats.upDay, stats.downDay);
  if (key === "ratioWk")  return ratio(stats.upWk, stats.downWk);
  if (key === "ratioMo")  return ratio(stats.upMo, stats.downMo);
  const v = stats[key as keyof BreadthStats];
  return v != null ? String(v) : "—";
}

// ─── Screener rows (high RS leaders) ────────────────────────────────────────

function getLeaders(snapshot: MarketSnapshot): TickerRow[] {
  const all: TickerRow[] = Object.values(snapshot.groups).flat();
  return all
    .filter((r) => r.rs != null && (r.rs ?? 0) >= 60)
    .sort((a, b) => (b.rs ?? 0) - (a.rs ?? 0))
    .slice(0, 30);
}

function rsColor(rs: number | null): string {
  if (rs == null) return "#475569";
  if (rs >= 80) return "#22c55e";
  if (rs >= 60) return "#86efac";
  if (rs >= 40) return "#fbbf24";
  return "#f87171";
}

function AbcPill({ abc }: { abc: string | null }) {
  if (!abc) return <span style={{ color: "#475569" }}>—</span>;
  const bg = abc === "A" ? "#1d4ed8" : abc === "B" ? "#15803d" : "#b45309";
  return (
    <span style={{ background: bg, color: "#fff", borderRadius: 4, padding: "1px 6px", fontSize: 11, fontWeight: 700 }}>
      {abc}
    </span>
  );
}

// ─── Bar chart data ──────────────────────────────────────────────────────────

function makeBarData(
  labelA: string, statsA: BreadthStats,
  labelB: string, statsB: BreadthStats,
) {
  return [
    { period: "Day",   [`${labelA} Up`]: statsA.upDay,  [`${labelA} Down`]: -statsA.downDay,  [`${labelB} Up`]: statsB.upDay,  [`${labelB} Down`]: -statsB.downDay },
    { period: "Week",  [`${labelA} Up`]: statsA.upWk,   [`${labelA} Down`]: -statsA.downWk,   [`${labelB} Up`]: statsB.upWk,   [`${labelB} Down`]: -statsB.downWk },
    { period: "Month", [`${labelA} Up`]: statsA.upMo,   [`${labelA} Down`]: -statsA.downMo,   [`${labelB} Up`]: statsB.upMo,   [`${labelB} Down`]: -statsB.downMo },
  ];
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function MarketMetricsDashboard() {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/snapshot.json`)
      .then((r) => { if (!r.ok) throw new Error(`snapshot ${r.status}`); return r.json(); })
      .then((d) => { if (!cancelled) setSnapshot(d); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);

  const stats = useMemo(() => {
    if (!snapshot) return null;
    const g = snapshot.groups;
    return {
      Indices:    breadth(g["Indices"]    ?? []),
      Sectors:    breadth(g["Sectors"]    ?? []),
      Industries: breadth(g["Industries"] ?? []),
      Countries:  breadth(g["Countries"]  ?? []),
    };
  }, [snapshot]);

  const leaders = useMemo(() => snapshot ? getLeaders(snapshot) : [], [snapshot]);

  const barData1 = useMemo(() => {
    if (!stats) return [];
    return makeBarData("Indices", stats.Indices, "Sectors", stats.Sectors);
  }, [stats]);

  const barData2 = useMemo(() => {
    if (!stats) return [];
    return makeBarData("Industries", stats.Industries, "Countries", stats.Countries);
  }, [stats]);

  const COLS = ["Indices", "Sectors", "Industries", "Countries"] as const;

  if (error) {
    return (
      <div style={{ background: "#1a0a0a", border: "1px solid #7f1d1d", borderRadius: 8, padding: 16, color: "#fca5a5" }}>
        <p style={{ fontWeight: 600 }}>Market data not available</p>
        <p style={{ marginTop: 8, fontSize: 13, color: "#fcd9d9" }}>
          Run <code style={{ background: "#000", padding: "1px 6px", borderRadius: 4 }}>npm run sync:market</code> to load snapshot data.
        </p>
      </div>
    );
  }

  if (!snapshot || !stats) {
    return (
      <div style={{ color: "#475569", padding: 24, textAlign: "center" }}>
        Loading market metrics…
      </div>
    );
  }

  const builtAt = new Date(snapshot.built_at).toLocaleString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "short",
    day: "2-digit", hour: "2-digit", minute: "2-digit",
  });

  return (
    <div style={{ background: "#06090f", color: "#e2e8f0", fontFamily: "'Inter', 'Segoe UI', sans-serif", padding: "16px 0" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 20, padding: "0 4px" }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9", margin: 0, letterSpacing: "-0.5px" }}>
            📈 Market Metrics Dashboard
          </h2>
          <p style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>
            Breadth · SMA Positioning · RS Leaders · Inspired by @SteveDJacobs
          </p>
        </div>
        <div style={{ fontSize: 11, color: "#334155", textAlign: "right" }}>
          <div>Updated: {builtAt} MYT</div>
          <div style={{ marginTop: 2 }}>
            {COLS.map((c) => (
              <span key={c} style={{ marginLeft: 8 }}>
                <span style={{ color: "#64748b" }}>{c}:</span>{" "}
                <span style={{ color: "#94a3b8" }}>{stats[c].total}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Section 1: Key Metrics Table ── */}
      <section style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#475569", marginBottom: 8, paddingLeft: 4 }}>
          1 · Key Metrics
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#0f172a" }}>
                <th style={{ padding: "7px 12px", textAlign: "left", color: "#64748b", fontWeight: 600, fontSize: 11, width: 130, borderBottom: "1px solid #1e293b" }}>
                  Metric
                </th>
                {COLS.map((c) => (
                  <th key={c} style={{ padding: "7px 16px", textAlign: "center", color: "#94a3b8", fontWeight: 700, fontSize: 12, borderBottom: "1px solid #1e293b", borderLeft: "1px solid #1e293b" }}>
                    {c}
                    <div style={{ fontSize: 10, color: "#475569", fontWeight: 400 }}>
                      {stats[c].total} tickers
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {METRIC_ROWS.map((row, i) => {
                const isRatio = row.label.toLowerCase().includes("ratio");
                const isSeparator = row.label.includes("Up (Week)") || row.label.includes("Up (Month)") || row.label.includes("Above SMA");
                return (
                  <tr
                    key={row.key}
                    style={{
                      background: i % 2 === 0 ? "#0b1120" : "#080d18",
                      borderTop: isSeparator ? "1px solid #1e3a5f" : "none",
                    }}
                  >
                    <td style={{
                      padding: "5px 12px",
                      color: isRatio ? "#94a3b8" : "#64748b",
                      fontSize: 11,
                      fontWeight: isRatio ? 600 : 400,
                      whiteSpace: "nowrap",
                      borderRight: "1px solid #1e293b",
                    }}>
                      {row.label}
                    </td>
                    {COLS.map((c) => {
                      const val = getMetricValue(stats[c], row.key);
                      const style = metricCellStyle(row.label, val);
                      return (
                        <td
                          key={c}
                          style={{
                            padding: "5px 16px",
                            textAlign: "center",
                            fontWeight: 600,
                            fontSize: 13,
                            fontVariantNumeric: "tabular-nums",
                            borderLeft: "1px solid #1e293b",
                            ...style,
                          }}
                        >
                          {val}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Section 2 & 3: Bar Charts ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>

        {/* Chart 1: Indices + Sectors */}
        <section style={{ background: "#0b1120", border: "1px solid #1e293b", borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#475569", marginBottom: 12 }}>
            2 · Indices <span style={{ color: "#166534" }}>■</span> + Sectors <span style={{ color: "#14532d" }}>▪</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={barData1} margin={{ top: 4, right: 8, left: -16, bottom: 0 }} barSize={14}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="period" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: "#94a3b8", fontWeight: 600 }}
                cursor={{ fill: "#ffffff08" }}
              />
              <Legend iconSize={10} iconType="square" wrapperStyle={{ fontSize: 11, color: "#64748b" }} />
              <Bar dataKey="Indices Up"    fill="#166534" stackId="a" />
              <Bar dataKey="Indices Down"  fill="#7f1d1d" stackId="a" />
              <Bar dataKey="Sectors Up"   fill="#14532d" stackId="b" />
              <Bar dataKey="Sectors Down" fill="#450a0a" stackId="b" />
            </BarChart>
          </ResponsiveContainer>
        </section>

        {/* Chart 2: Industries + Countries */}
        <section style={{ background: "#0b1120", border: "1px solid #1e293b", borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#475569", marginBottom: 12 }}>
            3 · Industries <span style={{ color: "#166534" }}>■</span> + Countries <span style={{ color: "#14532d" }}>▪</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={barData2} margin={{ top: 4, right: 8, left: -16, bottom: 0 }} barSize={14}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="period" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: "#94a3b8", fontWeight: 600 }}
                cursor={{ fill: "#ffffff08" }}
              />
              <Legend iconSize={10} iconType="square" wrapperStyle={{ fontSize: 11, color: "#64748b" }} />
              <Bar dataKey="Industries Up"    fill="#166534" stackId="a" />
              <Bar dataKey="Industries Down"  fill="#7f1d1d" stackId="a" />
              <Bar dataKey="Countries Up"   fill="#14532d" stackId="b" />
              <Bar dataKey="Countries Down" fill="#450a0a" stackId="b" />
            </BarChart>
          </ResponsiveContainer>
        </section>
      </div>

      {/* ── Section 4: High RS Screener (Qullamaggie-inspired) ── */}
      <section>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#475569", marginBottom: 8, paddingLeft: 4 }}>
          4 · Qullamaggie-Inspired Screener — RS ≥ 60 Leaders ({leaders.length})
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#0f172a" }}>
                {["#", "Ticker", "RS", "ABC", "Day %", "Week %", "Month %", "ATR %", "Dist/SMA50"].map((h) => (
                  <th key={h} style={{ padding: "7px 10px", textAlign: h === "Ticker" || h === "#" ? "left" : "center", color: "#64748b", fontWeight: 600, fontSize: 11, borderBottom: "1px solid #1e293b", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leaders.map((r, i) => {
                const dayPct = r.daily;
                const wkPct  = r["5d"];
                const moPct  = r["20d"];
                return (
                  <tr
                    key={r.ticker}
                    style={{ background: i % 2 === 0 ? "#0b1120" : "#080d18", borderBottom: "1px solid #111827" }}
                  >
                    <td style={{ padding: "5px 10px", color: "#334155", fontSize: 11 }}>{i + 1}</td>
                    <td style={{ padding: "5px 10px", fontWeight: 700, color: "#e2e8f0", fontFamily: "monospace", letterSpacing: "0.03em" }}>
                      {r.ticker}
                    </td>
                    <td style={{ padding: "5px 10px", textAlign: "center" }}>
                      <span style={{
                        display: "inline-block",
                        background: "#0f172a",
                        border: `1px solid ${rsColor(r.rs)}`,
                        color: rsColor(r.rs),
                        borderRadius: 4,
                        padding: "1px 8px",
                        fontWeight: 700,
                        fontSize: 12,
                        minWidth: 36,
                        textAlign: "center",
                      }}>
                        {r.rs?.toFixed(0) ?? "—"}
                      </span>
                    </td>
                    <td style={{ padding: "5px 10px", textAlign: "center" }}>
                      <AbcPill abc={r.abc} />
                    </td>
                    {[dayPct, wkPct, moPct].map((v, vi) => (
                      <td key={vi} style={{
                        padding: "5px 10px",
                        textAlign: "center",
                        fontVariantNumeric: "tabular-nums",
                        fontWeight: 600,
                        fontSize: 12,
                        color: v == null || isNaN(v) ? "#334155" : v > 0 ? "#86efac" : v < 0 ? "#fca5a5" : "#64748b",
                        background: v == null || isNaN(v) ? "transparent" : v > 0 ? "#0d2a1a" : v < 0 ? "#1f0a0a" : "transparent",
                      }}>
                        {pct(v)}
                      </td>
                    ))}
                    <td style={{ padding: "5px 10px", textAlign: "center", color: "#475569", fontSize: 11 }}>
                      {r.atr_pct != null && !isNaN(r.atr_pct) ? `${r.atr_pct.toFixed(1)}%` : "—"}
                    </td>
                    <td style={{ padding: "5px 10px", textAlign: "center", color: "#475569", fontSize: 11 }}>
                      {r.dist_sma50_atr != null && !isNaN(r.dist_sma50_atr) ? r.dist_sma50_atr.toFixed(2) : "—"}
                    </td>
                  </tr>
                );
              })}
              {leaders.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ padding: 24, textAlign: "center", color: "#475569" }}>
                    No tickers with RS ≥ 60 in current snapshot
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}
