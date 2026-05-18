export type FreshnessStatus = "fresh" | "aging" | "stale" | "unknown";

export interface FreshnessThresholds {
  agingSec: number;
  staleSec: number;
}

export const LIVE_QUOTE_THRESHOLDS: FreshnessThresholds = { agingSec: 60, staleSec: 120 };
export const BRIEF_THRESHOLDS:      FreshnessThresholds = { agingSec: 1800, staleSec: 3600 };
export const SNAPSHOT_THRESHOLDS:   FreshnessThresholds = { agingSec: 7200, staleSec: 21600 };

export interface FreshnessResult {
  status: FreshnessStatus;
  ageSec: number | null;
  label: string;
  absolute: string | null;
}

function formatAge(ageSec: number, stale: boolean): string {
  const prefix = stale ? "STALE " : "";
  if (ageSec < 60) return `${prefix}${Math.max(0, Math.round(ageSec))}s ago`;
  const m = Math.floor(ageSec / 60);
  if (m < 60) return `${prefix}${m}m ago`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${prefix}${h}h ${rem}m ago` : `${prefix}${h}h ago`;
}

export function computeFreshness(
  ts: string | Date | null | undefined,
  thresholds: FreshnessThresholds,
): FreshnessResult {
  if (!ts) return { status: "unknown", ageSec: null, label: "—", absolute: null };
  const d = ts instanceof Date ? ts : new Date(ts);
  const t = d.getTime();
  if (Number.isNaN(t)) return { status: "unknown", ageSec: null, label: "—", absolute: null };
  const ageSec = Math.max(0, (Date.now() - t) / 1000);
  const status: FreshnessStatus =
    ageSec >= thresholds.staleSec ? "stale" :
    ageSec >= thresholds.agingSec ? "aging" : "fresh";
  return {
    status,
    ageSec,
    label: formatAge(ageSec, status === "stale"),
    absolute: d.toLocaleString("en-MY", {
      timeZone: "Asia/Kuala_Lumpur",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
  };
}
