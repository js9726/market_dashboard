/**
 * POST /api/a-list/ingest
 *
 * Machine-only endpoint. Called by the pre-open CI workflow (or any
 * brief-generation pipeline) to persist A-list candidates identified
 * for a given pick date.
 *
 * A-list filter (currently — tunable in cli_run.py):
 *   - score >= 80
 *   - verdict == "GO"
 *   - rvol >= 1.5x
 *
 * Auth: `Authorization: Bearer <BRIEF_INGEST_KEY>` (re-uses the morning-brief
 * ingest secret since both are cron-driven).
 *
 * Body:
 *   {
 *     pickDate: "YYYY-MM-DD",       // date the candidate was promoted
 *     candidates: [
 *       {
 *         ticker: "JOYY",
 *         setupClassification: "EP-FRESH",
 *         screenSource: "best-winners",
 *         sector: "Technology Services",
 *         industry: "Data Processing Services",
 *         entryZone: 64.50,
 *         stop: 60.50,
 *         target: 75.00,
 *         rrr: 2.6,
 *         day0Score: 85,
 *         day0Verdict: "GO",
 *         day0Rvol: 3.07,
 *         day0Thesis: "...",
 *         day0TraderLens: "@Qullamaggie",
 *         day0BriefBucketAt: "2026-05-27T13:00:00Z",
 *         day0BriefProvider: "claude",
 *         day0Price: 64.09,
 *         tags: ["EP-FRESH", "2x-confluence"]
 *       },
 *       ...
 *     ]
 *   }
 *
 * Behaviour:
 *   - Upserts on (operatorLabel, pickDate, ticker) — re-runs of the same
 *     pre-open are idempotent.
 *   - Preserves existing day-14 fields on upsert (only overwrites day-0).
 *   - Returns { inserted, updated, candidates: [...] }.
 */
import { NextResponse } from "next/server";
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const expected = process.env.BRIEF_INGEST_KEY;
  if (!expected) return false;
  const got = req.headers.get("authorization");
  return got === `Bearer ${expected}`;
}

type CandidateInput = {
  ticker: string;
  setupClassification?: string | null;
  screenSource?: string | null;
  sector?: string | null;
  industry?: string | null;
  entryZone?: number | null;
  stop?: number | null;
  target?: number | null;
  rrr?: number | null;
  day0Score?: number | null;
  day0Verdict?: string | null;
  day0Rvol?: number | null;
  day0Thesis?: string | null;
  day0TraderLens?: string | null;
  day0BriefBucketAt?: string | null;
  day0BriefProvider?: string | null;
  day0Price?: number | null;
  tags?: unknown;
};

function dec(v: number | null | undefined): Prisma.Decimal | null {
  return v == null || Number.isNaN(v) ? null : new Prisma.Decimal(v);
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { pickDate?: string; candidates?: CandidateInput[]; operatorLabel?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.pickDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.pickDate)) {
    return NextResponse.json({ error: "pickDate (YYYY-MM-DD) required" }, { status: 400 });
  }
  if (!Array.isArray(body.candidates) || body.candidates.length === 0) {
    return NextResponse.json({ error: "candidates[] required" }, { status: 400 });
  }

  const operatorLabel = body.operatorLabel ?? "JS";
  const pickDate = new Date(`${body.pickDate}T00:00:00.000Z`);

  let inserted = 0;
  let updated = 0;
  const results = [];

  for (const c of body.candidates) {
    if (!c.ticker || typeof c.ticker !== "string") {
      results.push({ ticker: c.ticker, error: "ticker required" });
      continue;
    }

    const ticker = c.ticker.trim().toUpperCase();
    const existing = await prisma.aListCandidate.findUnique({
      where: {
        operatorLabel_pickDate_ticker: { operatorLabel, pickDate, ticker },
      },
    });

    const data = {
      operatorLabel,
      pickDate,
      ticker,
      setupClassification: c.setupClassification ?? null,
      screenSource: c.screenSource ?? null,
      sector: c.sector ?? null,
      industry: c.industry ?? null,
      entryZone: dec(c.entryZone),
      stop: dec(c.stop),
      target: dec(c.target),
      rrr: dec(c.rrr),
      day0Score: c.day0Score ?? null,
      day0Verdict: c.day0Verdict ?? null,
      day0Rvol: dec(c.day0Rvol),
      day0Thesis: c.day0Thesis ?? null,
      day0TraderLens: c.day0TraderLens ?? null,
      day0BriefBucketAt: c.day0BriefBucketAt ? new Date(c.day0BriefBucketAt) : null,
      day0BriefProvider: c.day0BriefProvider ?? null,
      day0Price: dec(c.day0Price),
      tags: c.tags ?? Prisma.JsonNull,
    };

    if (existing) {
      // Update day-0 fields only; preserve day-14 and status if already set.
      const row = await prisma.aListCandidate.update({
        where: { id: existing.id },
        data,
      });
      updated++;
      results.push({ ticker, id: row.id, action: "updated" });
    } else {
      const row = await prisma.aListCandidate.create({ data });
      inserted++;
      results.push({ ticker, id: row.id, action: "inserted" });
    }
  }

  return NextResponse.json({
    ok: true,
    pickDate: body.pickDate,
    inserted,
    updated,
    results,
  });
}
