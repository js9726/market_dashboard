/**
 * GET /api/alist/actionable — machine-readable feed of currently actionable
 * A-list signals for the operator-local paper-trading bridge (SIMULATE only).
 *
 * A signal is actionable when the row is ACTIVE, its trigger has FIRED, and the
 * multi-agent verdict is ENTER (which, since 2026-07-16, requires the hard
 * pre-gates — risk ceiling / extension / pivot — to have passed in code).
 *
 * Auth: Authorization: Bearer <BRIEF_INGEST_KEY> (same key as the ingest
 * routes; this is read-only and returns no account or user data).
 *
 * Response: { ok, asOf, signals: [{ ticker, setup, entryZone, stop, target,
 *             stopSource, conviction, triggeredAt, analyzedAt }] }
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: Request) {
  const key = process.env.BRIEF_INGEST_KEY;
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!key || bearer !== key) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const rows = await prisma.aListCandidate.findMany({
    where: { status: "ACTIVE", triggerState: "TRIGGERED", agentVerdict: "ENTER" },
    orderBy: { agentConvictionAt: "desc" },
    take: 20,
  });

  const signals = rows.flatMap((r) => {
    const entryZone = num(r.entryZone);
    // Effective stop mirrors alist-serialize: logged stop, else the ATR-floor
    // (ceiling-clamped since 2026-07-16) stop. No stop => not actionable —
    // fail-closed; the bridge must never invent one.
    const stop = num(r.stop) ?? num(r.atrFloorStop);
    const conv = r.agentConviction as { conviction?: number; gate?: { ok?: boolean } } | null;
    if (entryZone == null || stop == null || stop >= entryZone) return [];
    // Defence in depth: never emit a signal whose stored gate failed.
    if (conv?.gate && conv.gate.ok === false) return [];
    return [{
      ticker: r.ticker,
      setup: r.setupClassification,
      entryZone,
      stop,
      target: num(r.target),
      stopSource: r.stop != null ? "logged" : "atr",
      conviction: conv?.conviction ?? null,
      triggeredAt: r.triggerStateAt?.toISOString() ?? null,
      analyzedAt: r.agentConvictionAt?.toISOString() ?? null,
    }];
  });

  return NextResponse.json({ ok: true, asOf: new Date().toISOString(), signals });
}
