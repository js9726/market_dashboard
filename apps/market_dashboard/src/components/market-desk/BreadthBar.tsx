/**
 * Polygon.io-style filled breadth bar.
 *
 *   New Highs vs New Lows                       79.7%
 *   ████████████████████████░░░░░░░░░░░░░░
 *   157 Highs                              40 Lows
 *
 * Blue fill when the left side dominates (>=50%), magenta when the right
 * side dominates. The bar uses the same fill color as the percentage label
 * for a cohesive look.
 */

interface BreadthBarProps {
  label: string;
  leftCount: number | null | undefined;
  rightCount: number | null | undefined;
  leftLabel: string;
  rightLabel: string;
}

export default function BreadthBar({
  label,
  leftCount,
  rightCount,
  leftLabel,
  rightLabel,
}: BreadthBarProps) {
  const left = leftCount ?? 0;
  const right = rightCount ?? 0;
  const total = left + right;
  const pctLeft = total > 0 ? (left / total) * 100 : 50;
  const dominantLeft = pctLeft >= 50;
  const fill = dominantLeft ? "#3B82F6" : "#EC4899"; // blue-500 / pink-500

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-semibold text-[var(--fg-1)]">{label}</span>
        <span className="font-mono text-[13px] font-bold" style={{ color: fill }}>
          {total > 0 ? `${pctLeft.toFixed(1)}%` : "—"}
        </span>
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-raised)]">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pctLeft}%`, background: fill }}
        />
      </div>
      <div className="flex items-baseline justify-between text-[11px] text-[var(--fg-3)] font-mono">
        <span>{leftCount == null ? "—" : `${leftCount.toLocaleString()} ${leftLabel}`}</span>
        <span>{rightCount == null ? "—" : `${rightCount.toLocaleString()} ${rightLabel}`}</span>
      </div>
    </div>
  );
}
