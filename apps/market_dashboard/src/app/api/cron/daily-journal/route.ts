/**
 * /api/cron/daily-journal
 *
 * Daily cron (add to vercel.json `crons` to schedule, e.g. after US close).
 *
 * For every user with JournalPref.autoWrite = true AND a dailyDocUrl set:
 *   - composes today's journal markdown (composeDailyJournal)
 *   - appends a dated section to their Google Doc (appendMarkdownSection)
 *
 * Idempotent: appendMarkdownSection skips when a `## YYYY-MM-DD` header for
 * today already exists in the doc, so re-running the cron the same day is a
 * no-op write.
 *
 * Auth (mirrors /api/cron/rescore-day14):
 *   - Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set
 *   - Manual triggers must include the same header
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appendMarkdownSection } from "@/lib/google-docs";
import { composeDailyJournal } from "../../journal/daily/route";

export const dynamic = "force-dynamic";

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function run(request: Request) {
  // Auth: reject if CRON_SECRET set and header mismatches.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const dateIso = todayIso();
  const targets = await prisma.journalPref.findMany({
    where: { autoWrite: true, NOT: { dailyDocUrl: null } },
    select: { userId: true, dailyDocUrl: true },
  });

  type RunResult =
    | { userId: string; status: "written"; requests: number }
    | { userId: string; status: "skipped"; reason: string }
    | { userId: string; status: "error"; reason: string };

  const results: RunResult[] = [];
  let written = 0;
  let skipped = 0;
  let errored = 0;

  for (const t of targets) {
    if (!t.dailyDocUrl) {
      results.push({ userId: t.userId, status: "skipped", reason: "no_doc_url" });
      skipped++;
      continue;
    }
    try {
      const composed = await composeDailyJournal(t.userId, dateIso, { fillVerdicts: true });
      const res = await appendMarkdownSection(t.dailyDocUrl, composed.markdown, {
        userId: t.userId,
        dateLabel: dateIso,
        title: "Daily Journal",
      });
      if (res.ok && res.skipped) {
        results.push({ userId: t.userId, status: "skipped", reason: res.reason ?? "already_present" });
        skipped++;
      } else if (res.ok) {
        results.push({ userId: t.userId, status: "written", requests: res.requests ?? 0 });
        written++;
      } else {
        results.push({ userId: t.userId, status: "error", reason: res.reason ?? "write_failed" });
        errored++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ userId: t.userId, status: "error", reason: msg });
      errored++;
    }
  }

  return NextResponse.json({
    date: dateIso,
    targets: targets.length,
    written,
    skipped,
    errored,
    results,
    runAt: new Date().toISOString(),
  });
}

export async function GET(request: Request) {
  return run(request);
}

// Vercel Cron uses GET; POST kept for manual / GH Actions parity.
export async function POST(request: Request) {
  return run(request);
}
