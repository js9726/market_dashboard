/**
 * GET /api/daily-screener/paper-signals
 *
 * SIMULATE-only bridge feed sourced exclusively from the latest persisted,
 * evidence-backed tradingview-daily-screener/v2 final GO list. Raw
 * AListCandidate rows are deliberately excluded from this execution boundary.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  dailyScreenerPayloadSchema,
  goListPayloadHash,
} from "@/lib/daily-screener/schema";
import {
  buildPaperSignals,
  finalRunFreshness,
  paperExecutionEligibility,
  PAPER_SIGNAL_AUTHORITY,
} from "@/server/daily-screener-paper";

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const expected =
    process.env.SCREENER_INGEST_KEY || process.env.BRIEF_INGEST_KEY;
  if (!expected) return false;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const row = await prisma.dailyScreenerRun.findFirst({
    where: { source: "tradingview-daily-screener" },
    orderBy: [{ runDate: "desc" }, { generatedAt: "desc" }],
    select: {
      id: true,
      runDate: true,
      generatedAt: true,
      payload: true,
      goListHash: true,
    },
  });

  if (!row) {
    return NextResponse.json({
      ok: true,
      authority: PAPER_SIGNAL_AUTHORITY,
      asOf: new Date().toISOString(),
      run: null,
      signals: [],
      reason: "no_final_run",
    });
  }

  const parsed = dailyScreenerPayloadSchema.safeParse(row.payload);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "stored_final_run_failed_schema_validation" },
      { status: 503 },
    );
  }

  const payload = parsed.data;
  if (
    row.runDate.toISOString().slice(0, 10) !== payload.runDate ||
    row.goListHash !== goListPayloadHash(payload)
  ) {
    return NextResponse.json(
      { ok: false, error: "stored_final_run_failed_integrity_check" },
      { status: 503 },
    );
  }
  const freshness = finalRunFreshness(
    payload.runDate,
    payload.generatedAt,
  );
  const run = {
    id: row.id,
    runDate: row.runDate.toISOString().slice(0, 10),
    generatedAt: row.generatedAt.toISOString(),
    goListHash: row.goListHash,
    ageHours: Number(freshness.ageHours.toFixed(2)),
    maxAgeHours: freshness.maxAgeHours,
  };

  if (!freshness.fresh) {
    return NextResponse.json({
      ok: true,
      authority: PAPER_SIGNAL_AUTHORITY,
      asOf: new Date().toISOString(),
      run,
      signals: [],
      reason: "stale_final_run",
    });
  }

  const execution = paperExecutionEligibility(payload.runDate, payload.generatedAt);
  if (!execution.eligible) {
    return NextResponse.json({
      ok: true,
      authority: PAPER_SIGNAL_AUTHORITY,
      asOf: new Date().toISOString(),
      run: { ...run, executionAgeMinutes: Number(execution.ageMinutes.toFixed(2)) },
      signals: [],
      reason: execution.reason,
    });
  }

  return NextResponse.json({
    ok: true,
    authority: PAPER_SIGNAL_AUTHORITY,
    asOf: new Date().toISOString(),
    run: { ...run, executionAgeMinutes: Number(execution.ageMinutes.toFixed(2)) },
    signals: buildPaperSignals(payload, row),
    reason: payload.candidates.goList.length === 0 ? "empty_final_go_list" : null,
  });
}
