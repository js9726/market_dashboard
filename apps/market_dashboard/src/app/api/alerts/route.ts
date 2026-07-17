/**
 * GET /api/alerts — in-app trading alerts for the caller (TradesViz-platform
 * P4-🄺). Read-only evaluation; no writes, no external delivery.
 *
 * Telegram push is ON HOLD (operator, 2026-07-17) — this response is the exact
 * payload a future channel would send, so wiring it later is delivery-only.
 *
 * Covers: daily-loss breach/near (vs the user's own MAX_DAILY_LOSS goal),
 * overtrading, stale broker bridge, recently-triggered A-list ideas, and
 * unconverted-P&L data quality. Educational signals — never auto-execution.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { computeAlerts } from "@/server/goals-alerts";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canSeePersonalBook(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const alerts = await computeAlerts(scopeUserId(session)!);
  return NextResponse.json({ alerts, count: alerts.length });
}
