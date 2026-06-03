"use client";

import { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";

type Point = { date: string; cumulative: number };

/**
 * Recharts colors are SVG attributes, not CSS — they can't read `var(--…)`
 * directly. This hook resolves the mode-aware design tokens to concrete values
 * and re-reads them when the theme toggles (data-mode mutation), so the chart
 * follows light/dark like the rest of the app.
 */
function useThemeColors() {
  const [c, setC] = useState({
    gain: "#22c55e", loss: "#ef4444", grid: "#1e2d3d",
    axis: "#64748b", zero: "#334155", surface: "#0e1318",
  });
  useEffect(() => {
    const read = () => {
      const s = getComputedStyle(document.documentElement);
      const g = (k: string, f: string) => s.getPropertyValue(k).trim() || f;
      setC({
        gain: g("--gain-fg", "#22c55e"),
        loss: g("--loss-fg", "#ef4444"),
        grid: g("--line", "#1e2d3d"),
        axis: g("--fg-3", "#64748b"),
        zero: g("--line-strong", "#334155"),
        surface: g("--bg-surface", "#0e1318"),
      });
    };
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode", "class"] });
    return () => obs.disconnect();
  }, []);
  return c;
}

export default function EquityCurve({ data }: { data: Point[] }) {
  const c = useThemeColors();
  if (!data.length) {
    return <p className="py-8 text-center text-sm text-[var(--fg-3)]">No closed trades yet.</p>;
  }

  const netPositive = data[data.length - 1].cumulative >= 0;
  const lineColor = netPositive ? c.gain : c.loss;

  return (
    <div className="w-full" style={{ height: 320 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
          <XAxis
            dataKey="date"
            tick={{ fill: c.axis, fontSize: 11 }}
            tickLine={false}
            tickFormatter={(v: string) => {
              const d = new Date(v);
              return `${d.toLocaleString("default", { month: "short" })} ${d.getDate()}`;
            }}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: c.axis, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `$${v >= 0 ? "" : "-"}${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
            width={70}
          />
          <Tooltip
            contentStyle={{ background: c.surface, border: `1px solid ${c.grid}`, borderRadius: 8 }}
            labelStyle={{ color: c.axis, fontSize: 11 }}
            formatter={(value: number) => [
              `$${value >= 0 ? "+" : ""}${value.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
              "Cumulative P&L",
            ]}
          />
          <ReferenceLine y={0} stroke={c.zero} strokeDasharray="4 4" />
          <Line
            type="monotone"
            dataKey="cumulative"
            stroke={lineColor}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: lineColor }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
