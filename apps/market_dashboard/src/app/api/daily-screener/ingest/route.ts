/**
 * POST /api/daily-screener/ingest
 *
 * Machine-authenticated handoff for the FINAL evidence-backed daily screener
 * artifact. Unlike AListCandidate, this payload has already passed the
 * freshness, authenticated daily/weekly chart, catalyst, risk, and timing
 * gates. A successful ingest then attempts one idempotent Telegram delivery.
 *
 * Auth: Authorization: Bearer <SCREENER_INGEST_KEY>, falling back to the
 * existing BRIEF_INGEST_KEY when a dedicated key is not configured.
 */
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  dailyScreenerPayloadSchema,
  goListPayloadHash,
} from "@/lib/daily-screener/schema";
import { deliverTelegramGoList } from "@/server/telegram-go";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const expected =
    process.env.SCREENER_INGEST_KEY || process.env.BRIEF_INGEST_KEY;
  if (!expected) return false;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = dailyScreenerPayloadSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid daily screener payload",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  const payload = parsed.data;
  const runDate = new Date(`${payload.runDate}T00:00:00.000Z`);
  const generatedAt = new Date(payload.generatedAt);
  const goListHash = goListPayloadHash(payload);

  const row = await prisma.$transaction(async (tx) => {
    const run = await tx.dailyScreenerRun.upsert({
      where: {
        runDate_source: { runDate, source: payload.source },
      },
      create: {
        runDate,
        source: payload.source,
        schemaVersion: payload.schemaVersion,
        generatedBy: payload.generatedBy,
        generatedAt,
        reportMarkdown: payload.reportMarkdown,
        payload: payload as unknown as Prisma.InputJsonValue,
        goListHash,
      },
      update: {
        schemaVersion: payload.schemaVersion,
        generatedBy: payload.generatedBy,
        generatedAt,
        reportMarkdown: payload.reportMarkdown,
        payload: payload as unknown as Prisma.InputJsonValue,
        goListHash,
      },
    });

    await tx.dailyScreenerChunk.deleteMany({ where: { runId: run.id } });
    if (payload.chunks.length > 0) {
      await tx.dailyScreenerChunk.createMany({
        data: payload.chunks.map((chunk) => ({
          runId: run.id,
          chunkKey: chunk.chunkKey,
          kind: chunk.kind,
          ticker: chunk.ticker ?? null,
          grade: chunk.grade ?? null,
          title: chunk.title,
          text: chunk.text,
          data:
            chunk.data == null
              ? Prisma.JsonNull
              : (chunk.data as Prisma.InputJsonValue),
          ordinal: chunk.ordinal,
        })),
      });
    }
    return run;
  });

  const telegram = await deliverTelegramGoList(payload);

  return NextResponse.json({
    ok: true,
    run: {
      id: row.id,
      runDate: payload.runDate,
      generatedBy: payload.generatedBy,
      goTickers: payload.candidates.goList.map((candidate) => candidate.ticker),
      goListHash,
      chunks: payload.chunks.length,
    },
    telegram,
  });
}
