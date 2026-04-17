"use client";

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";

type Point = { date: string; cumulative: number };

export default function EquityCurve({ data }: { data: Point[] }) {
  if (!data.length) {
    return <p className="text-slate-500 text-sm py-8 text-center">No closed trades yet.</p>;
  }

  const netPositive = data[data.length - 1].cumulative >= 0;
  const lineColor = netPositive ? "#22c55e" : "#ef4444";

  return (
    <div className="w-full" style={{ height: 320 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="date"
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            tickLine={false}
            tickFormatter={(v: string) => {
              const d = new Date(v);
              return `${d.toLocaleString("default", { month: "short" })} ${d.getDate()}`;
            }}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `$${v >= 0 ? "" : "-"}${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
            width={70}
          />
          <Tooltip
            contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8 }}
            labelStyle={{ color: "#94a3b8", fontSize: 11 }}
            formatter={(value: number) => [
              `$${value >= 0 ? "+" : ""}${value.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
              "Cumulative P&L",
            ]}
          />
          <ReferenceLine y={0} stroke="#334155" strokeDasharray="4 4" />
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
