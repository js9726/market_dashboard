/**
 * alist-triggers.ts — per-setup entry-trigger state machine (pure).
 *
 * Encodes the wiki/entry-methods.md trigger rules on daily bars. A REC pick is
 * ARMED at pick day, then walks forward to a terminal state:
 *   - TRIGGERED   — the entry actually became buyable (the "take it" signal)
 *   - INVALIDATED — the thesis broke before triggering (e.g. ONTO gap-fade)
 *   - EXPIRED     — no trigger within the setup's validity window
 *   - NEEDS-PIVOT — BREAKOUT family with no real prior-consolidation high to
 *                   break (fail-closed; added 2026-07-16 after the VCTR false-GO)
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

export type TriggerState = "ARMED" | "TRIGGERED" | "INVALIDATED" | "EXPIRED" | "NEEDS-PIVOT";

export interface TriggerResult {
  state: TriggerState;
  /** Sessions after pick day where the terminal event fired (null if ARMED/EXPIRED-by-window). */
  dayIndex: number | null;
  date: string | null;
  reason: string;
}

const RVOL_OK = 1.0; // volume at least average (expansion proxy)
const RVOL_HIGH = 1.5; // distribution-grade volume on a down day

// ── Wiki pre-screen (entry-methods.md "intraday trigger is not a setup",
//    2026-07-02 calibration): forbidden daily structures are auto-PASS before
//    any trigger is considered. GFS 2026-07-01 is the worked example. ──────────
const LOOSE_SWING_PCT = 5; // a ±5%+ close-to-close day counts as a loose swing
const LOOSE_SWING_MAX = 4; // ≥4 such days in the lookback = wide-and-loose
const DISTRIBUTION_MAX = 2; // ≥2 high-volume down days = distribution-heavy
const PRESCREEN_LOOKBACK = 20; // trading sessions inspected before pick day

export interface PreScreenResult {
  pass: boolean;
  reason: string;
  looseSwings: number;
  distributionDays: number;
}

/**
 * Doctrine pre-screen on the ~20 daily bars up to and including pick day.
 * Fails (auto-PASS the pick) when the structure is wide-and-loose or carries
 * repeated high-volume distribution days — the conditions under which an
 * intraday/daily trigger is forbidden per wiki/entry-methods.md.
 */
export function preScreenStructure(history: TriggerBar[]): PreScreenResult {
  const bars = history.slice(-PRESCREEN_LOOKBACK - 1);
  let looseSwings = 0;
  let distributionDays = 0;
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1];
    const b = bars[i];
    if (prev.close > 0) {
      const chg = ((b.close - prev.close) / prev.close) * 100;
      if (Math.abs(chg) >= LOOSE_SWING_PCT) looseSwings++;
    }
    if ((b.rvol ?? 0) >= RVOL_HIGH && b.close < b.open) distributionDays++;
  }
  if (looseSwings >= LOOSE_SWING_MAX)
    return { pass: false, looseSwings, distributionDays, reason: `wiki pre-screen: wide-and-loose (${looseSwings} days of ±${LOOSE_SWING_PCT}%+ in last ${PRESCREEN_LOOKBACK})` };
  if (distributionDays >= DISTRIBUTION_MAX)
    return { pass: false, looseSwings, distributionDays, reason: `wiki pre-screen: distribution-heavy (${distributionDays} high-volume down days in last ${PRESCREEN_LOOKBACK})` };
  return { pass: true, looseSwings, distributionDays, reason: "pre-screen ok" };
}

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
      // A breakout needs something to break OUT OF. `pivot` must be a real
      // prior-consolidation high (alist-levels.findPivot). Falling back to
      // `d0.high` — or, as before 2026-07-16, to the pick-day CLOSE — degrades
      // this into "closed higher two days running", which is how VCTR triggered
      // at +2.82 ATR above its 21EMA with no base. Fail closed instead.
      if (pivot == null)
        return { state: "NEEDS-PIVOT", dayIndex: null, date: b.date, reason: "no prior-consolidation high to break — the last close is not a pivot" };
      if (inWindow && b.low > d0.low && b.close > pivot && rvol(b) >= RVOL_OK)
        return { state: "TRIGGERED", dayIndex: i, date: b.date, reason: `higher-low + close > pivot ${pivot.toFixed(2)} on RVOL ${rvol(b).toFixed(1)}x` };
    }
  }

  // No terminal event. Still inside the window → ARMED; past it → EXPIRED.
  const elapsed = path.length - 1;
  return elapsed > window
    ? { state: "EXPIRED", dayIndex: null, date: path[path.length - 1].date, reason: `no trigger within ${window} sessions` }
    : { state: "ARMED", dayIndex: null, date: null, reason: `armed — ${window - elapsed} session(s) left to trigger` };
}
