"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

interface ScatterPoint {
  ticker: string;
  date: string;
  operator: string;
  composite: number;
  actualPct: number;
  grade: "A" | "B" | "C";
  setup: string;
  drift: boolean;
}

interface SetupBucket {
  setup: string;
  total: number;
  gradeA: number;
  gradeB: number;
  gradeC: number;
  driftCount: number;
  avgReturn: number;
  winRate: number;
}

interface MonthlyDrift {
  period: string;
  total: number;
  drift: number;
  driftPct: number;
}

interface TraderCalibration {
  trader: string;
  yEnterCount: number;
  yEnterGradeA: number;
  nEnterCount: number;
  nEnterGradeC: number;
  yEnterPositive: number;
  yEnterRate: number;
}

interface AnalyticsPayload {
  operators: string[];
  totals: { trades: number; drift: number; driftPct: number; winRate: number };
  scatter: ScatterPoint[];
  setups: SetupBucket[];
  drift: MonthlyDrift[];
  traders: TraderCalibration[];
}

const GRADE_COLOUR: Record<"A" | "B" | "C", string> = {
  A: "var(--gain-fg)",
  B: "var(--accent)",
  C: "var(--loss-fg)",
};

export default function AnalyticsView() {
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [operator, setOperator] = useState<string | "ALL">("ALL");

  useEffect(() => {
    const qs = operator === "ALL" ? "" : `?operator=${encodeURIComponent(operator)}`;
    fetch(`/api/wiki/analytics${qs}`, { cache: "no-store" })
      .then(async (r) => {
        const payload = await r.json();
        if (!r.ok) throw new Error(payload.error ?? `HTTP ${r.status}`);
        setData(payload);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "load failed"));
  }, [operator]);

  const showOpPicker = (data?.operators?.length ?? 0) > 1;

  return (
    <section className="market-panel p-5">
      <div className="market-section-head">
        <div>
          <p className="t-overline">Conviction Analytics</p>
          <p className="t-caption">
            How well does the rubric predict your outcomes? Aggregates only journaled trades
            (<code>intent=journal</code>). Chat analyses and screener picks are excluded — those
            have their own pages.
          </p>
        </div>
        {showOpPicker ? (
          <div className="flex items-center gap-2">
            <label htmlFor="analytics-op" className="t-caption">Operator</label>
            <select
              id="analytics-op"
              value={operator}
              onChange={(e) => setOperator(e.target.value)}
              className="rounded border border-[var(--line)] bg-[var(--bg-raised)] px-2 py-1 text-[13px] font-mono"
            >
              <option value="ALL">All</option>
              {data?.operators.map((op) => <option key={op} value={op}>{op}</option>)}
            </select>
          </div>
        ) : null}
      </div>

      {error ? <p className="mb-3 t-caption text-[var(--loss-fg)]">{error}</p> : null}

      {!data ? (
        <p className="t-body-small text-[var(--fg-3)]">Loading analytics…</p>
      ) : data.totals.trades === 0 ? (
        <div className="rounded border border-dashed border-[var(--line)] p-4 t-body-small text-[var(--fg-3)]">
          No journaled trades with day-14 verdicts yet. Once trades age 14 days and get rescored,
          they show up here.
        </div>
      ) : (
        <div className="space-y-6">
          {/* Header stats */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Trades analysed" value={data.totals.trades.toString()} />
            <Stat label="Drift rate" value={`${data.totals.driftPct}%`} tone={data.totals.driftPct > 30 ? "loss" : data.totals.driftPct < 15 ? "gain" : "neutral"} />
            <Stat label="Win rate (14d)" value={`${data.totals.winRate}%`} tone={data.totals.winRate > 50 ? "gain" : "loss"} />
            <Stat label="Setups tracked" value={data.setups.length.toString()} />
          </div>

          {/* 1. Score vs Outcome scatter */}
          <Panel
            title="Rubric calibration — score vs actual outcome"
            subtitle="Each dot = one trade. X = composite technical score (0-10). Y = actual 14-day price move %. Color = grade. Tight diagonal = well-calibrated rubric."
          >
            <ResponsiveContainer width="100%" height={320}>
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis
                  type="number"
                  dataKey="composite"
                  domain={[0, 10]}
                  name="Composite score"
                  label={{ value: "Composite score (0-10)", position: "insideBottom", offset: -5 }}
                  stroke="var(--fg-3)"
                />
                <YAxis
                  type="number"
                  dataKey="actualPct"
                  name="14d move %"
                  label={{ value: "14d move %", angle: -90, position: "insideLeft" }}
                  stroke="var(--fg-3)"
                />
                <ZAxis range={[60, 60]} />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0].payload as ScatterPoint;
                    return (
                      <div className="rounded border border-[var(--line)] bg-[var(--bg-raised)] p-2 text-[11px]">
                        <p className="font-mono font-bold">
                          {p.ticker} <span className="text-[var(--fg-3)]">{p.operator} · {p.date}</span>
                        </p>
                        <p>Score: <span className="font-mono">{p.composite.toFixed(1)}</span></p>
                        <p>14d: <span className="font-mono" style={{ color: p.actualPct >= 0 ? "var(--gain-fg)" : "var(--loss-fg)" }}>
                          {p.actualPct >= 0 ? "+" : ""}{p.actualPct.toFixed(1)}%
                        </span></p>
                        <p>Grade: <span style={{ color: GRADE_COLOUR[p.grade] }}>{p.grade}</span> · Setup: {p.setup}</p>
                        {p.drift ? <p className="text-[var(--loss-fg)]">⚠ drift</p> : null}
                      </div>
                    );
                  }}
                />
                <Scatter data={data.scatter}>
                  {data.scatter.map((p, i) => (
                    <Cell key={i} fill={GRADE_COLOUR[p.grade]} fillOpacity={p.drift ? 0.5 : 0.85} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
            <p className="mt-2 t-caption text-[var(--fg-3)]">
              Read: high-composite (≥7) trades clustered above 0% on Y-axis = rubric picks winners.
              Faded dots = rubric drift flagged. A vertical line of dots all over the Y-axis at one
              score = the rubric isn&apos;t discriminating at that level.
            </p>
          </Panel>

          {/* 2. Setup-grade distribution */}
          <Panel
            title="Grade distribution by setup"
            subtitle="Per setup type: stacked count of A/B/C verdicts, plus avg 14d return and win rate. Spot which setups your rubric handles well."
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[12px]">
                <thead className="text-[10px] uppercase tracking-[0.12em] text-[var(--fg-3)]">
                  <tr className="border-b border-[var(--line)]">
                    <th className="py-2 pr-3 font-bold">Setup</th>
                    <th className="px-3 py-2 text-right font-bold">N</th>
                    <th className="px-3 py-2 text-right font-bold">A / B / C</th>
                    <th className="px-3 py-2 text-right font-bold">Drift</th>
                    <th className="px-3 py-2 text-right font-bold">Avg 14d</th>
                    <th className="py-2 pl-3 text-right font-bold">Win %</th>
                  </tr>
                </thead>
                <tbody>
                  {data.setups.map((s) => (
                    <tr key={s.setup} className="border-b border-[var(--line)] last:border-0">
                      <td className="py-2 pr-3 font-mono text-[var(--accent)]">{s.setup}</td>
                      <td className="px-3 py-2 text-right font-mono">{s.total}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        <span style={{ color: GRADE_COLOUR.A }}>{s.gradeA}</span>{" / "}
                        <span style={{ color: GRADE_COLOUR.B }}>{s.gradeB}</span>{" / "}
                        <span style={{ color: GRADE_COLOUR.C }}>{s.gradeC}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[var(--fg-2)]">
                        {s.driftCount} ({s.total > 0 ? Math.round((s.driftCount / s.total) * 100) : 0}%)
                      </td>
                      <td className={`px-3 py-2 text-right font-mono ${s.avgReturn > 0 ? "gain" : s.avgReturn < 0 ? "loss" : "text-[var(--fg-2)]"}`}>
                        {s.avgReturn >= 0 ? "+" : ""}{s.avgReturn.toFixed(1)}%
                      </td>
                      <td className={`py-2 pl-3 text-right font-mono ${s.winRate >= 50 ? "gain" : "loss"}`}>
                        {s.winRate.toFixed(0)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* 3. Drift over time */}
          <Panel
            title="Drift over time"
            subtitle="Monthly rubric drift count + drift %. Sloping down = rubric improving. Spikes = month where the rubric misfired (e.g. April 2026 stop-too-tight cluster)."
          >
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={data.drift}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="period" stroke="var(--fg-3)" />
                <YAxis yAxisId="left" stroke="var(--fg-3)" label={{ value: "Drift count", angle: -90, position: "insideLeft" }} />
                <YAxis yAxisId="right" orientation="right" stroke="var(--fg-3)" label={{ value: "Drift %", angle: 90, position: "insideRight" }} />
                <Tooltip
                  contentStyle={{ background: "var(--bg-raised)", border: "1px solid var(--line)" }}
                />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="drift" stroke="var(--loss-fg)" name="Drift cases" dot />
                <Line yAxisId="right" type="monotone" dataKey="driftPct" stroke="var(--accent)" name="Drift %" dot />
              </LineChart>
            </ResponsiveContainer>
          </Panel>

          {/* 4. Trader calibration */}
          <Panel
            title="Trader-lens calibration"
            subtitle={`When trader X says "Would Enter = Y", what % of those trades closed positive at 14 days? The higher, the more predictive that lens is of YOUR outcomes.`}
          >
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.traders} layout="vertical" margin={{ left: 80 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis type="number" domain={[0, 100]} stroke="var(--fg-3)" />
                <YAxis type="category" dataKey="trader" stroke="var(--fg-3)" width={120} tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: "var(--bg-raised)", border: "1px solid var(--line)" }}
                  formatter={(value: number, name: string, props) => {
                    const p = props.payload as TraderCalibration;
                    return [`${value}% (${p.yEnterPositive}/${p.yEnterCount} positive)`, "Y-enter hit rate"];
                  }}
                />
                <Bar dataKey="yEnterRate" fill="var(--accent)" />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="text-[10px] uppercase tracking-[0.12em] text-[var(--fg-3)]">
                  <tr className="border-b border-[var(--line)]">
                    <th className="py-2 pr-3 font-bold">Trader</th>
                    <th className="px-3 py-2 text-right">Y-enter N</th>
                    <th className="px-3 py-2 text-right">→ Grade A</th>
                    <th className="px-3 py-2 text-right">→ Positive 14d</th>
                    <th className="px-3 py-2 text-right">Hit rate</th>
                    <th className="px-3 py-2 text-right">N-enter N</th>
                    <th className="py-2 pl-3 text-right">→ Grade C avoided</th>
                  </tr>
                </thead>
                <tbody>
                  {data.traders.map((t) => (
                    <tr key={t.trader} className="border-b border-[var(--line)] last:border-0">
                      <td className="py-2 pr-3 font-mono text-[var(--accent)]">{t.trader}</td>
                      <td className="px-3 py-2 text-right font-mono">{t.yEnterCount}</td>
                      <td className="px-3 py-2 text-right font-mono">{t.yEnterGradeA}</td>
                      <td className="px-3 py-2 text-right font-mono">{t.yEnterPositive}</td>
                      <td className={`px-3 py-2 text-right font-mono ${t.yEnterRate >= 60 ? "gain" : t.yEnterRate >= 40 ? "text-[var(--fg-2)]" : "loss"}`}>
                        {t.yEnterRate.toFixed(0)}%
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{t.nEnterCount}</td>
                      <td className="py-2 pl-3 text-right font-mono">{t.nEnterGradeC}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "gain" | "loss" | "neutral" }) {
  const colour =
    tone === "gain" ? "var(--gain-fg)" :
    tone === "loss" ? "var(--loss-fg)" :
    "var(--fg-1)";
  return (
    <div className="rounded-md border border-[var(--line)] bg-[var(--bg-raised)] p-3">
      <p className="t-overline">{label}</p>
      <p className="mt-1 text-xl font-bold" style={{ color: colour }}>{value}</p>
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-[var(--bg-raised)] p-4">
      <h3 className="mb-1 text-[13px] font-bold uppercase tracking-[0.1em]">{title}</h3>
      {subtitle ? <p className="mb-3 t-caption text-[var(--fg-3)]">{subtitle}</p> : null}
      {children}
    </div>
  );
}
