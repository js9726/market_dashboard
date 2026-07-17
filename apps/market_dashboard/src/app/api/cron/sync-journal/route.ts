/**
 * GET /api/cron/sync-journal — nightly sheet→journal auto-sync (2026-07-16,
 * operator-requested).
 *
 * For EVERY user with a SpreadsheetConnection:
 *   1. syncUserJournal(userId)          — wipe-and-recreate from the sheet
 *      (write-time FX + weekend-roll normalization), then
 *   2. reconcileBrokerTrades({userId})  — IMMEDIATELY re-link fills and re-mark
 *      duplicate bridge episodes (":dup"). Ordering matters: a bare re-sync
 *      resurrects sheet twins of bridge episodes and they double-count on the
 *      calendar until a reconcile runs (seen 2026-07-16: GFS/TWLO 06-30).
 *
 * Per-user isolation: one user's failed sync (e.g. REAUTH_REQUIRED) never
 * blocks the rest. Skips LLM verdict generation (cost) — the manual Sync
 * button keeps that.
 *
 * Auth: Vercel cron Bearer <CRON_SECRET>, x-vercel-cron-signature, or
 * ?secret=<BRIEF_INGEST_KEY> for manual trigger (same pattern as track-positions).
 * Schedule (vercel.json): 21:30 UTC weekdays — after US close, before the
 * 21:50 reconcile-trades backstop.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncUserJournal, JournalSyncError } from "@/server/journal-sync";
import { reconcileBrokerTrades } from "@/server/trade-reconciler";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const ingestKey = process.env.BRIEF_INGEST_KEY;
  const authHeader = req.headers.get("authorization") ?? "";
  const urlSecret = new URL(req.url).searchParams.get("secret");
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;
  if (ingestKey && urlSecret === ingestKey) return true;
  if (req.headers.get("x-vercel-cron-signature")) return true;
  return false;
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const startedAt = Date.now();

  const connections = await prisma.spreadsheetConnection.findMany({ select: { userId: true } });
  const results: Array<Record<string, unknown>> = [];

  for (const { userId } of connections) {
    const entry: Record<string, unknown> = { userId: userId.slice(0, 8) };
    try {
      const sync = await syncUserJournal(userId);
      entry.synced = sync.synced;
      entry.weekendRolled = sync.weekendRolled;
    } catch (e) {
      entry.syncError = e instanceof JournalSyncError ? e.code : e instanceof Error ? e.message : String(e);
      results.push(entry);
      continue; // no reconcile without a sync
    }
    try {
      const rec = await reconcileBrokerTrades({ userId });
      entry.recordsClosed = rec.recordsClosed;
      entry.fillsLinked = rec.fillsLinked;
      entry.duplicatesDeleted = rec.duplicatesDeleted;
    } catch (e) {
      entry.reconcileError = e instanceof Error ? e.message : String(e);
    }
    results.push(entry);
  }

  return NextResponse.json({
    ok: true,
    connections: connections.length,
    results,
    durationMs: Date.now() - startedAt,
  });
}
