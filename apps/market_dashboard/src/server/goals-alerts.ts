/**
 * goals-alerts.ts — goal progress + in-app alert evaluation
 * (TradesViz-platform P4-🄺, 2026-07-17).
 *
 * Pure-ish computation shared by /api/goals and /api/alerts so both surfaces
 * agree. Telegram delivery is deliberately NOT here (operator put it on hold);
 * these alerts are dashboard-only for now, and the shape below is what a future
 * push channel would consume.
 *
 * INTEGRITY GATES (PLAN-tradesviz-platform.md §"Cross-cutting journal integrity
 * gates" — Codex 2026-07-17). This module MUST NOT re-derive its own trade
 * filter:
 *   #2 realized performance → every money metric flows through
 *      `closedTradesWhere()` (canonical CLOSE-only, :dup-excluded, NULL-safe).
 *   #3 currency truth       → USD via `usdPnl()`; unconverted rows never enter
 *      a money sum (they are surfaced as a data-quality alert instead).
 *   #4 account separation   → paper/SIMULATE accounts excluded from live
 *      performance (LIVE_ACCOUNT_ONLY), matching stats/calendar.
 */
import { prisma } from "@/lib/prisma";
import { closedTradesWhere, usdPnl, type PivotTradeRow } from "@/server/journal-pivot";
import type { Prisma } from "@prisma/client";

/** Gate #4: sheet rows (no broker account) + LIVE broker accounts only. */
const LIVE_ACCOUNT_ONLY: Prisma.TradeRecordWhereInput = {
  OR: [{ brokerAccountId: null }, { brokerAccount: { isLive: true } }],
};

export const GOAL_KINDS = ["PNL", "MAX_DAILY_LOSS", "MAX_DRAWDOWN", "WIN_RATE", "PROCESS"] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];

export type GoalProgress = {
  id: string;
  kind: string;
  label: string;
  target: number | null;
  unit: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  /** Measured value for the goal's window; null when not computable. */
  actual: number | null;
  /** 0..1 for target-style goals; null when not applicable (e.g. PROCESS). */
  progress: number | null;
  /** "on-track" | "at-risk" | "breached" | "achieved" | "manual" */
  status: string;
  note: string;
  measuredTrades: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Realized USD P&L per day, newest-last, for a user's LIVE closed trades. */
async function loadClosedForWindow(userId: string, from: Date | null, to: Date | null) {
  const rows = (await prisma.tradeRecord.findMany({
    where: { AND: [closedTradesWhere(userId, from, to), LIVE_ACCOUNT_ONLY] },
    select: {
      ticker: true,
      side: true,
      strategy: true,
      source: true,
      platform: true,
      industry: true,
      currencyCode: true,
      currency: true,
      pnl: true,
      pnlUsd: true,
      tags: true,
      mistakes: true,
      tradeDate: true,
      executedAt: true,
      rrr: true,
    },
    orderBy: { tradeDate: "asc" },
  })) as unknown as PivotTradeRow[];
  return rows;
}

function dailyPnl(rows: PivotTradeRow[]): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const t of rows) {
    const p = usdPnl(t);
    const when = t.tradeDate ?? t.executedAt;
    if (p == null || !when) continue; // gate #3: unconverted never enters a sum
    const k = dayKey(when);
    byDay.set(k, (byDay.get(k) ?? 0) + p);
  }
  return byDay;
}

/** Peak-to-trough of the cumulative realized curve, as a positive magnitude. */
function maxDrawdown(byDay: Map<string, number>): number {
  let cum = 0;
  let peak = 0;
  let worst = 0;
  for (const k of Array.from(byDay.keys()).sort()) {
    cum += byDay.get(k)!;
    peak = Math.max(peak, cum);
    worst = Math.min(worst, cum - peak);
  }
  return Math.abs(worst);
}

export async function computeGoalProgress(userId: string): Promise<GoalProgress[]> {
  const goals = await prisma.goal.findMany({
    where: { userId, active: true },
    orderBy: { createdAt: "asc" },
  });
  if (goals.length === 0) return [];

  const out: GoalProgress[] = [];
  for (const g of goals) {
    const from = g.periodStart ?? null;
    const to = g.periodEnd ?? null;
    const rows = await loadClosedForWindow(userId, from, to);
    const measured = rows.filter((t) => usdPnl(t) != null);
    const byDay = dailyPnl(rows);
    const target = g.target != null ? Number(g.target) : null;
    let actual: number | null = null;
    let progress: number | null = null;
    let status = "manual";
    let note = "";

    switch (g.kind as GoalKind) {
      case "PNL": {
        actual = r2(Array.from(byDay.values()).reduce((a, b) => a + b, 0));
        if (target && target !== 0) {
          progress = Math.max(0, Math.min(1, actual / target));
          status = actual >= target ? "achieved" : actual < 0 ? "at-risk" : "on-track";
        }
        note = `Realized USD across ${measured.length} closed trade(s) in window.`;
        break;
      }
      case "MAX_DAILY_LOSS": {
        // target = the loss LIMIT (positive magnitude). actual = worst day.
        let worstDay = 0;
        let worstKey = "";
        for (const [k, v] of Array.from(byDay.entries())) if (v < worstDay) (worstDay = v), (worstKey = k);
        actual = r2(Math.abs(Math.min(0, worstDay)));
        if (target && target > 0) {
          progress = Math.max(0, Math.min(1, actual / target));
          status = actual > target ? "breached" : actual >= target * 0.8 ? "at-risk" : "on-track";
        }
        note = worstKey ? `Worst day ${worstKey}: ${r2(worstDay)} USD.` : "No losing day in window.";
        break;
      }
      case "MAX_DRAWDOWN": {
        actual = r2(maxDrawdown(byDay));
        if (target && target > 0) {
          progress = Math.max(0, Math.min(1, actual / target));
          status = actual > target ? "breached" : actual >= target * 0.8 ? "at-risk" : "on-track";
        }
        note = "Peak-to-trough of the realized daily curve (closed trades only).";
        break;
      }
      case "WIN_RATE": {
        const wins = measured.filter((t) => (usdPnl(t) ?? 0) > 0).length;
        const decided = measured.filter((t) => (usdPnl(t) ?? 0) !== 0).length;
        actual = decided > 0 ? r2((wins / decided) * 100) : null;
        if (target && target > 0 && actual != null) {
          progress = Math.max(0, Math.min(1, actual / target));
          status = actual >= target ? "achieved" : "on-track";
        }
        note = `${wins}/${decided} decided trades won.`;
        break;
      }
      default: {
        // PROCESS goals are self-reported — tracked, never auto-scored.
        note = "Process goal — reviewed manually.";
      }
    }

    out.push({
      id: g.id,
      kind: g.kind,
      label: g.label,
      target,
      unit: g.unit,
      periodStart: g.periodStart ? dayKey(g.periodStart) : null,
      periodEnd: g.periodEnd ? dayKey(g.periodEnd) : null,
      actual,
      progress,
      status,
      note,
      measuredTrades: measured.length,
    });
  }
  return out;
}

export type Alert = {
  key: string;
  severity: "info" | "warn" | "danger";
  title: string;
  detail: string;
  /** Where the user should go to act on it. */
  href?: string;
};

/**
 * In-app alerts. Read-only evaluation over the caller's own data — no writes,
 * no delivery. Ordered danger → warn → info by the caller.
 */
export async function computeAlerts(userId: string): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const now = Date.now();
  const since = new Date(now - 30 * 86400000);
  const rows = await loadClosedForWindow(userId, since, null);
  const byDay = dailyPnl(rows);
  const today = dayKey(new Date());

  // 1) Daily-loss breach vs an active MAX_DAILY_LOSS goal (today only).
  const lossGoal = await prisma.goal.findFirst({
    where: { userId, active: true, kind: "MAX_DAILY_LOSS", target: { not: null } },
  });
  const todayPnl = byDay.get(today) ?? 0;
  if (lossGoal?.target != null) {
    const limit = Number(lossGoal.target);
    const lossToday = Math.abs(Math.min(0, todayPnl));
    if (limit > 0 && lossToday > limit) {
      alerts.push({
        key: "daily-loss-breach",
        severity: "danger",
        title: `Daily loss limit breached: −$${r2(lossToday)} vs $${r2(limit)}`,
        detail: "Your own rule says stop for the day. Close the laptop; tomorrow is a fresh session.",
        href: "/dashboard/journal",
      });
    } else if (limit > 0 && lossToday >= limit * 0.8) {
      alerts.push({
        key: "daily-loss-near",
        severity: "warn",
        title: `Approaching your daily loss limit (−$${r2(lossToday)} of $${r2(limit)})`,
        detail: "One more full-size loser breaches the rule. Size down or stop.",
        href: "/dashboard/journal",
      });
    }
  }

  // 2) Overtrading — today's closed count vs the 30-day daily average.
  const tradingDays = byDay.size || 1;
  const avgPerDay = rows.length / tradingDays;
  const todayCount = rows.filter((t) => {
    const w = t.tradeDate ?? t.executedAt;
    return w && dayKey(w) === today;
  }).length;
  if (todayCount >= 4 && avgPerDay > 0 && todayCount >= Math.max(4, avgPerDay * 2.5)) {
    alerts.push({
      key: "overtrading",
      severity: "warn",
      title: `Overtrading: ${todayCount} closed today vs ${r2(avgPerDay)}/day average`,
      detail: "Trade count spikes usually follow a loss. Check the plan before the next entry.",
      href: "/dashboard/trades",
    });
  }

  // 3) Bridge stale — token exists but no heartbeat recently.
  const token = await prisma.brokerBridgeToken.findUnique({
    where: { userId },
    select: { lastHeartbeat: true, revokedAt: true, label: true },
  });
  if (token && !token.revokedAt) {
    const hb = token.lastHeartbeat?.getTime() ?? 0;
    const hours = hb ? Math.round((now - hb) / 3600000) : null;
    if (hours == null || hours > 24) {
      alerts.push({
        key: "bridge-stale",
        severity: "info",
        title: hours == null ? "Broker bridge has never checked in" : `Broker bridge silent for ${hours}h`,
        detail: "Positions/prices fall back to the cloud feed until the local bridge runs again.",
        href: "/dashboard/settings/brokers",
      });
    }
  }

  // 4) Idea triggered — A-list picks whose entry trigger fired recently.
  const cutoff = new Date(now - 3 * 86400000);
  const triggered = await prisma.aListCandidate.findMany({
    where: { userId, status: "ACTIVE", triggerState: "TRIGGERED", triggerStateAt: { gte: cutoff } },
    select: { ticker: true, triggerStateAt: true },
    orderBy: { triggerStateAt: "desc" },
    take: 5,
  });
  if (triggered.length > 0) {
    alerts.push({
      key: "idea-triggered",
      severity: "info",
      title: `${triggered.length} A-list idea${triggered.length > 1 ? "s" : ""} triggered recently`,
      detail: triggered.map((t) => `${t.ticker} (${t.triggerStateAt?.toISOString().slice(0, 10)})`).join(", "),
      href: "/dashboard/a-list",
    });
  }

  // 5) Data quality — closed rows that money metrics must skip (gate #3/#7).
  const unconverted = rows.length - rows.filter((t) => usdPnl(t) != null).length;
  if (unconverted > 0) {
    alerts.push({
      key: "unconverted-pnl",
      severity: "warn",
      title: `${unconverted} closed trade(s) have no USD P&L`,
      detail: "They are excluded from every money metric until an FX rate is set (Settings → journal).",
      href: "/dashboard/settings",
    });
  }

  const rank = { danger: 0, warn: 1, info: 2 } as const;
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
