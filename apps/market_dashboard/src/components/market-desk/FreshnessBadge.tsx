"use client";

import { useEffect, useState } from "react";
import {
  computeFreshness,
  type FreshnessStatus,
  type FreshnessThresholds,
} from "@/lib/freshness";

interface Props {
  timestamp: string | Date | null | undefined;
  thresholds: FreshnessThresholds;
  className?: string;
}

const DOT_COLOR: Record<FreshnessStatus, string> = {
  fresh:   "var(--gain-fg)",
  aging:   "var(--accent)",
  stale:   "var(--loss-fg)",
  unknown: "var(--fg-3)",
};

export default function FreshnessBadge({ timestamp, thresholds, className }: Props) {
  // Force re-render every 15s so labels tick (parents may not re-render).
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  const f = computeFreshness(timestamp, thresholds);
  const cls = "inline-flex items-center gap-1 t-caption t-mono" + (className ? ` ${className}` : "");

  return (
    <span className={cls} title={f.absolute ?? undefined}>
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 8,
          height: 8,
          borderRadius: 999,
          background: DOT_COLOR[f.status],
        }}
      />
      <span style={{ color: f.status === "stale" ? "var(--loss-fg)" : undefined }}>
        {f.label}
      </span>
    </span>
  );
}
