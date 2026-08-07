import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  evaluateTradingSession,
  renderTradingSessionMarkdown,
} from "@/lib/trading-journal/session";

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const expected = process.env.TRADING_JOURNAL_INGEST_KEY || process.env.BRIEF_INGEST_KEY;
  return Boolean(expected) && req.headers.get("authorization") === `Bearer ${expected}`;
}

async function ownerUser() {
  const email = process.env.OWNER_EMAIL;
  if (!email) throw new Error("OWNER_EMAIL not set");
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new Error("OWNER_EMAIL user not found");
  return user;
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const date = new URL(req.url).searchParams.get("date");
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ ok: false, error: "date must be YYYY-MM-DD" }, { status: 400 });
  }
  try {
    const user = await ownerUser();
    if (!date) {
      const rows = await prisma.tradingJournalSession.findMany({
        where: { userId: user.id },
        orderBy: { sessionDate: "asc" },
      });
      return NextResponse.json({
        ok: true,
        schemaVersion: "trading-journal/v2",
        sessions: rows.map((row) => row.payload),
        syncState: rows.map((row) => ({
          sessionDate: row.sessionDate.toISOString().slice(0, 10),
          docSyncStatus: row.docSyncStatus,
          docSyncedAt: row.docSyncedAt,
          docSyncError: row.docSyncError,
        })),
      });
    }
    const row = await prisma.tradingJournalSession.findUnique({
      where: { userId_sessionDate: { userId: user.id, sessionDate: new Date(`${date}T00:00:00.000Z`) } },
    });
    return NextResponse.json({ ok: true, session: row });
  } catch (error) {
    const message = error instanceof Error ? error.message : "owner resolution failed";
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}

export async function PATCH(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  let body: { sessionDates?: unknown; status?: unknown; error?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const dates = Array.isArray(body.sessionDates) ? body.sessionDates : [];
  const status = body.status;
  if (
    dates.length === 0 || dates.length > 400 ||
    !dates.every((date) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) ||
    (status !== "SYNCED" && status !== "ERROR") ||
    (body.error != null && typeof body.error !== "string")
  ) {
    return NextResponse.json({ ok: false, error: "invalid_sync_receipt" }, { status: 400 });
  }
  try {
    const user = await ownerUser();
    const result = await prisma.tradingJournalSession.updateMany({
      where: {
        userId: user.id,
        sessionDate: { in: dates.map((date) => new Date(`${date}T00:00:00.000Z`)) },
      },
      data: {
        docSyncStatus: status,
        docSyncedAt: status === "SYNCED" ? new Date() : null,
        docSyncError: status === "ERROR" ? (body.error || "Google Doc sync failed").slice(0, 2000) : null,
      },
    });
    return NextResponse.json({ ok: true, updated: result.count, status });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "sync_receipt_failed" }, { status: 503 });
  }
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  let evaluation;
  try {
    evaluation = evaluateTradingSession(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_session";
    return NextResponse.json({ ok: false, error: "invalid_session", detail: message }, { status: 400 });
  }

  try {
    const user = await ownerUser();
    const { session } = evaluation;
    const renderedMarkdown = renderTradingSessionMarkdown(evaluation);
    const data = {
      schemaVersion: session.schemaVersion,
      source: session.source,
      ownerProvider: session.owner.provider,
      ownerVerdict: session.owner.verdict,
      validatorProvider: session.validator?.provider ?? null,
      validatorStatus: session.validator?.status ?? null,
      payload: session as unknown as Prisma.InputJsonValue,
      renderedMarkdown,
      riskBlocked: evaluation.riskBlocked,
      docSyncStatus: "PENDING",
      docSyncedAt: null,
      docSyncError: null,
    };
    const row = await prisma.tradingJournalSession.upsert({
      where: { userId_sessionDate: { userId: user.id, sessionDate: new Date(`${session.sessionDate}T00:00:00.000Z`) } },
      create: { userId: user.id, sessionDate: new Date(`${session.sessionDate}T00:00:00.000Z`), ...data },
      update: data,
    });
    return NextResponse.json({
      ok: true,
      id: row.id,
      sessionDate: session.sessionDate,
      riskBlocked: evaluation.riskBlocked,
      violations: evaluation.violations,
      counts: evaluation.counts,
      docSyncStatus: row.docSyncStatus,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "session persistence failed";
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}
