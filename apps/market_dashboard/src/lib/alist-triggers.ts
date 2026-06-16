/**
 * alist-triggers.ts — per-setup entry-trigger state machine (pure).
 *
 * Encodes the wiki/entry-methods.md trigger rules on daily bars. A REC pick is
 * ARMED at pick day, then walks forward to a terminal state:
 *   - TRIGGERED   — the entry actually became buyable (the "take it" signal)
 *   - INVALIDATED — the thesis broke before triggering (e.g. ONTO gap-fade)
 *   - EXPIRED     — no trigger within the setup's validity window
 *
 * Daily-bar limitation: EP "opening-range-high" is intraday; here it is
 * approximated by a daily continuation that holds the EP-day range. The state
 * machine is deterministic + idempotent (re-running over the same path returns
 * the same first terminal event).
 */
import { validitySessions } from "@/lib/alist-validity";

export interface TriggerBar {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  ema8: number | null;
  ema21: number | null;
  rvol: number | null; // vs 50-day avg volume
}

export type TriggerState = "ARMED" | "TRIGGERED" | "INVALIDATED" | "EXPIRED";

export interface TriggerResult {
  state: TriggerState;
  /** Sessions after pick day where the terminal event fired (null if ARMED/EXPIRED-by-window). */
  dayIndex: number | null;
  date: string | null;
  reason: string;
}

const RVOL_OK = 1.0; // volume at least average (expansion proxy)
const RVOL_HIGH = 1.5; // distribution-grade volume on a down day

function family(setup: string | null | undefined): "EP" | "PULLBACK" | "BREAKOUT" {
  const s = (setup ?? "").toUpperCase();
  if (s.startsWith("EP") || s === "PARABOLIC") return "EP";
  if (s.startsWith("PB") || s.includes("MA-PULLBACK") || s.includes("POST-GAP")) return "PULLBACK";
  return "BREAKOUT"; // BO-CB / BO-VCP / default
}

/**
 * Evaluate the trigger state. `path[0]` is the pick-day bar; subsequent bars are
 * the forward sessions. `pivot` is the entry/pivot level (entryZone) if known.
 */
export function evaluateTrigger(
  setup: string | null | undefined,
  path: TriggerBar[],
  pivot: number | null,
): TriggerResult {
  if (path.length < 2) return { state: "ARMED", dayIndex: null, date: null, reason: "awaiting first forward session" };
  const fam = family(setup);
  const d0 = path[0];
  const window = validitySessions(setup);
  const rvol = (b: TriggerBar) => b.rvol ?? 1;

  for (let i = 1; i < path.length; i++) {
    const b = path[i];
    const inWindow = i <= window;

    if (fam === "EP") {
      if (b.close < d0.low)
        return { state: "INVALIDATED", dayIndex: i, date: b.date, reason: `close ${b.close.toFixed(2)} < EP-day low ${d0.low.toFixed(2)} (lost range)` };
      if (inWindow && b.close > d0.high && b.low >= d0.low && rvol(b) >= RVOL_OK)
        return { state: "TRIGGERED", dayIndex: i, date: b.date, reason: `held range + close > ${d0.high.toFixed(2)} on RVOL ${rvol(b).toFixed(1)}x` };
    } else if (fam === "PULLBACK") {
      if (b.ema21 != null && b.close < b.ema21 * 0.985)
        return { state: "INVALIDATED", dayIndex: i, date: b.date, reason: `close decisively below 21EMA (${b.ema21.toFixed(2)})` };
      if (rvol(b) >= RVOL_HIGH && b.close < b.open)
        return { state: "INVALIDATED", dayIndex: i, date: b.date, reason: `high-volume down day (RVOL ${rvol(b).toFixed(1)}x)` };
      if (inWindow && b.ema8 != null && b.close > b.ema8 && rvol(b) >= RVOL_OK)
        return { state: "TRIGGERED", dayIndex: i, date: b.date, reason: `reclaim 8EMA (${b.ema8.toFixed(2)}) on RVOL ${rvol(b).toFixed(1)}x` };
    } else {
      // BREAKOUT: wait for a higher-low then a pivot break on volume.
      if (b.close < d0.low)
        return { state: "INVALIDATED", dayIndex: i, date: b.date, reason: `close < breakout-day low ${d0.low.toFixed(2)}` };
      const pivotLevel = pivot ?? d0.high;
      if (inWindow && b.low > d0.low && b.close > pivotLevel && rvol(b) >= RVOL_OK)
        return { state: "TRIGGERED", dayIndex: i, date: b.date, reason: `higher-low + close > pivot ${pivotLevel.toFixed(2)} on RVOL ${rvol(b).toFixed(1)}x` };
    }
  }

  // No terminal event. Still inside the window → ARMED; past it → EXPIRED.
  const elapsed = path.length - 1;
  return elapsed > window
    ? { state: "EXPIRED", dayIndex: null, date: path[path.length - 1].date, reason: `no trigger within ${window} sessions` }
    : { state: "ARMED", dayIndex: null, date: null, reason: `armed — ${window - elapsed} session(s) left to trigger` };
}
