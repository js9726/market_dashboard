/**
 * 4-segment stacked bar for Weinstein stages.
 *
 *  Stage Analysis
 *  [█████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] (4 colored segments end-to-end)
 *  ● Stage 1   ● Stage 2   ● Stage 3   ● Stage 4
 *  172·3%      2512·47%    696·13%     1934·36%
 */

interface StageAnalysisBarProps {
  counts: Partial<Record<"1" | "2" | "3" | "4", number>>;
}

const COLORS = {
  "1": "#94A3B8", // slate-400 — basing (neutral)
  "2": "#3B82F6", // blue-500 — markup (bullish)
  "3": "#EAB308", // yellow-500 — distribution
  "4": "#EC4899", // pink-500 — decline (bearish)
};

const LABELS: Record<"1" | "2" | "3" | "4", string> = {
  "1": "Stage 1",
  "2": "Stage 2",
  "3": "Stage 3",
  "4": "Stage 4",
};

export default function StageAnalysisBar({ counts }: StageAnalysisBarProps) {
  const c1 = counts["1"] ?? 0;
  const c2 = counts["2"] ?? 0;
  const c3 = counts["3"] ?? 0;
  const c4 = counts["4"] ?? 0;
  const total = c1 + c2 + c3 + c4;
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  const segs: Array<["1" | "2" | "3" | "4", number]> = [
    ["1", c1],
    ["2", c2],
    ["3", c3],
    ["4", c4],
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-semibold text-[var(--fg-1)]">Stage Analysis</span>
        <span className="text-[11px] text-[var(--fg-3)] font-mono">{total.toLocaleString()} stocks</span>
      </div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--bg-raised)]">
        {segs.map(([key, n]) =>
          n > 0 ? (
            <div key={key} style={{ width: `${pct(n)}%`, background: COLORS[key] }} />
          ) : null,
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4 text-[11px]">
        {segs.map(([key, n]) => (
          <div key={key} className="flex items-baseline gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: COLORS[key] }} />
            <span className="text-[var(--fg-2)]">{LABELS[key]}</span>
            <span className="ml-auto font-mono text-[var(--fg-1)]">
              {total > 0 ? `${n.toLocaleString()} · ${pct(n).toFixed(0)}%` : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
