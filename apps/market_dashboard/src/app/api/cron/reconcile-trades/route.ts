/**
 * /api/cron/reconcile-trades
 *
 * Nightly backstop + on-demand repair for fill→trade reconciliation (the
 * primary trigger is /api/bridge/sync after each fill batch). Closes journal
 * rows whose broker position has been exited, links fills, merges stopgap
 * duplicates. `?dry=1` reports planned actions without writing.
 *
 * Health contract: `staleOpenAfter` must be empty after a non-dry run — a
 * non-empty list means an open journal row has no live broker position and
 * no closing fills, which deserves investigation.
 */
import { NextResponse } from "next/server";
import { reconcileBrokerTrades } from "@/server/trade-reconciler";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const url = new URL(request.url);
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}` && url.searchParams.get("secret") !== cronSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const dryRun = url.searchParams.get("dry") === "1";
  try {
    const report = await reconcileBrokerTrades({ dryRun });
    return NextResponse.json({ ok: true, ...report });
  } catch (e) {
    console.error("[cron/reconcile-trades] failed:", e);
    return NextResponse.json(
      { error: "reconcile failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
