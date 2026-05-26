/**
 * GET /api/wiki/analytics
 *
 * Aggregates WikiTradeVerdict rows (intent=journal only) into the four panels
 * the Analytics page renders:
 *
 *   1. Score-vs-outcome scatter — composite_technical_score (x) vs actual 14d % (y)
 *   2. Setup-grade distribution — A/B/C count per setup_classification
 *   3. Drift over time — monthly drift count + drift %
 *   4. Trader calibration — for each of the 7 traders, hit rate of "would_enter=Y"
 *      on grade-A trades vs all trades
 *
 * Query params:
 *   ?operator=JS|XX|...   filter to one operator (defaults to all)
 */
import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const OPERATOR_RE = /^[A-Z]{2,8}$/;
const TRADERS = [
  "@markminervini",
  "@Clement_Ang17",
  "@jfsrev",
  "@TedHZhang",
  "@SRxTrades",
  "@PrimeTrading_",
  "@Qullamaggie",
] as const;

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
  winRate: number;  // % of trades with positive 14d return
}

interface MonthlyDrift {
  period: string;
  total: number;
  drift: number;
  driftPct: number;
}

interface TraderCalibration {
  trader: string;
  yEnterCount: number;        // "would_enter=Y" rows
  yEnterGradeA: number;       // of those, how many were grade A
  nEnterCount: number;        // "would_enter=N"
  nEnterGradeC: number;       // of those, how many were grade C (avoided badly)
  // hitRate = how often "would_enter=Y" correlates with positive outcome
  yEnterPositive: number;     // of "Y" rows, count with actual_pct_move_14d > 0
  yEnterRate: number;         // yEnterPositive / yEnterCount as percentage
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const operatorRaw = url.searchParams.get("operator");
  const operatorLabel = operatorRaw && OPERATOR_RE.test(operatorRaw.toUpperCase())
    ? operatorRaw.toUpperCase()
    : undefined;

  try {
    const rows = await prisma.wikiTradeVerdict.findMany({
      where: {
        intent: "journal",
        ...(operatorLabel ? { operatorLabel } : {}),
        day14Json: { not: null as never },
      },
      orderBy: [{ tradeDate: "asc" }],
    });

    const scatter: ScatterPoint[] = [];
    const setupMap = new Map<string, SetupBucket>();
    const monthMap = new Map<string, MonthlyDrift>();
    const traderInit = (): TraderCalibration => ({
      trader: "",
      yEnterCount: 0,
      yEnterGradeA: 0,
      nEnterCount: 0,
      nEnterGradeC: 0,
      yEnterPositive: 0,
      yEnterRate: 0,
    });
    const traderMap = new Map<string, TraderCalibration>();
    for (const t of TRADERS) traderMap.set(t, { ...traderInit(), trader: t });

    const operators = new Set<string>();
    let totalTrades = 0;
    let totalDrift = 0;
    let totalPositive = 0;

    for (const row of rows) {
      const d0 = (row.day0Json ?? {}) as Record<string, unknown>;
      const d14 = (row.day14Json ?? {}) as Record<string, unknown>;
      const composite = typeof d0.composite_technical_score === "number" ? d0.composite_technical_score : null;
      const actualPct = typeof d14.actual_pct_move_14d === "number" ? d14.actual_pct_move_14d : null;
      const grade = (d14.predicted_vs_actual_match_grade as string | undefined) as "A" | "B" | "C" | undefined;
      const setup = (d0.setup_classification as string | undefined) ?? "OTHER";
      const drift = Boolean(d14.rubric_drift_detected);
      if (composite == null || actualPct == null || !grade) continue;

      operators.add(row.operatorLabel);
      totalTrades += 1;
      if (drift) totalDrift += 1;
      if (actualPct > 0) totalPositive += 1;

      // 1. scatter
      const date = row.tradeDate.toISOString().slice(0, 10);
      scatter.push({
        ticker: row.ticker,
        date,
        operator: row.operatorLabel,
        composite,
        actualPct,
        grade,
        setup,
        drift,
      });

      // 2. setup bucket
      let bucket = setupMap.get(setup);
      if (!bucket) {
        bucket = {
          setup, total: 0, gradeA: 0, gradeB: 0, gradeC: 0,
          driftCount: 0, avgReturn: 0, winRate: 0,
        };
        setupMap.set(setup, bucket);
      }
      bucket.total += 1;
      if (grade === "A") bucket.gradeA += 1;
      if (grade === "B") bucket.gradeB += 1;
      if (grade === "C") bucket.gradeC += 1;
      if (drift) bucket.driftCount += 1;
      // Welford-ish running mean
      bucket.avgReturn = bucket.avgReturn + (actualPct - bucket.avgReturn) / bucket.total;
      if (actualPct > 0) bucket.winRate = (bucket.winRate * (bucket.total - 1) + 100) / bucket.total;
      else bucket.winRate = (bucket.winRate * (bucket.total - 1)) / bucket.total;

      // 3. monthly drift
      const period = date.slice(0, 7);
      let m = monthMap.get(period);
      if (!m) {
        m = { period, total: 0, drift: 0, driftPct: 0 };
        monthMap.set(period, m);
      }
      m.total += 1;
      if (drift) m.drift += 1;

      // 4. trader calibration
      const traderScores = (d0.trader_scores ?? {}) as Record<string, Record<string, unknown>>;
      for (const trader of TRADERS) {
        const ts = traderScores[trader];
        if (!ts) continue;
        const wouldEnter = ts.would_enter as string | undefined;
        const cal = traderMap.get(trader)!;
        if (wouldEnter === "Y") {
          cal.yEnterCount += 1;
          if (grade === "A") cal.yEnterGradeA += 1;
          if (actualPct > 0) cal.yEnterPositive += 1;
        } else if (wouldEnter === "N") {
          cal.nEnterCount += 1;
          if (grade === "C") cal.nEnterGradeC += 1;
        }
      }
    }

    // Finalize derived fields. Materialize iterators to arrays for ES5 compat.
    const monthRows = Array.from(monthMap.values());
    for (const m of monthRows) {
      m.driftPct = m.total > 0 ? Math.round((m.drift / m.total) * 1000) / 10 : 0;
    }
    const traderRows = Array.from(traderMap.values());
    for (const cal of traderRows) {
      cal.yEnterRate = cal.yEnterCount > 0
        ? Math.round((cal.yEnterPositive / cal.yEnterCount) * 1000) / 10
        : 0;
    }

    return NextResponse.json({
      operators: Array.from(operators).sort(),
      totals: {
        trades: totalTrades,
        drift: totalDrift,
        driftPct: totalTrades > 0 ? Math.round((totalDrift / totalTrades) * 1000) / 10 : 0,
        winRate: totalTrades > 0 ? Math.round((totalPositive / totalTrades) * 1000) / 10 : 0,
      },
      scatter,
      setups: Array.from(setupMap.values())
        .map((b) => ({ ...b, avgReturn: Math.round(b.avgReturn * 10) / 10, winRate: Math.round(b.winRate * 10) / 10 }))
        .sort((a, b) => b.total - a.total),
      drift: monthRows.sort((a, b) => a.period.localeCompare(b.period)),
      traders: traderRows,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: `analytics query failed: ${msg}` }, { status: 500 });
  }
}
