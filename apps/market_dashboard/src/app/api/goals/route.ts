/**
 * /api/goals — trading goals with live progress (TradesViz-platform P4-🄺).
 *
 *   GET               → active goals + measured progress (server-computed).
 *   POST { kind, label, target?, unit?, periodStart?, periodEnd? } → create.
 *   PATCH { id, ...fields | active:false } → update / archive.
 *   DELETE ?id=...    → hard delete (the user's own goal only).
 *
 * Progress math lives in server/goals-alerts.ts and flows through the canonical
 * `closedTradesWhere()` so goals count exactly what the calendar/pivot count
 * (integrity gates #2/#3/#4). Session-authed; strictly the caller's own goals.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { computeGoalProgress, GOAL_KINDS } from "@/server/goals-alerts";

export const dynamic = "force-dynamic";

async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!canSeePersonalBook(session)) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { userId: scopeUserId(session)! };
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const date = (v: unknown): Date | null => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

export async function GET() {
  const a = await requireUser();
  if ("error" in a) return a.error;
  const goals = await computeGoalProgress(a.userId);
  return NextResponse.json({ goals, kinds: GOAL_KINDS });
}

export async function POST(req: Request) {
  const a = await requireUser();
  if ("error" in a) return a.error;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = typeof b.kind === "string" ? b.kind.toUpperCase() : "";
  if (!(GOAL_KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: `kind must be one of ${GOAL_KINDS.join(", ")}` }, { status: 400 });
  }
  const label = typeof b.label === "string" ? b.label.trim().slice(0, 120) : "";
  if (label.length < 2) return NextResponse.json({ error: "label required" }, { status: 400 });
  const target = num(b.target);
  // Loss/drawdown limits are stored as POSITIVE magnitudes — the engine compares
  // |loss| against them. Accepting a negative here would silently never breach.
  if ((kind === "MAX_DAILY_LOSS" || kind === "MAX_DRAWDOWN") && target != null && target <= 0) {
    return NextResponse.json({ error: "loss/drawdown targets are positive magnitudes (e.g. 200 = -$200)" }, { status: 400 });
  }
  const goal = await prisma.goal.create({
    data: {
      userId: a.userId,
      kind,
      label,
      target: target != null ? new Prisma.Decimal(target) : null,
      unit: typeof b.unit === "string" ? b.unit.slice(0, 8) : kind === "WIN_RATE" ? "%" : "USD",
      periodStart: date(b.periodStart),
      periodEnd: date(b.periodEnd),
    },
    select: { id: true },
  });
  return NextResponse.json({ ok: true, id: goal.id });
}

export async function PATCH(req: Request) {
  const a = await requireUser();
  if ("error" in a) return a.error;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof b.id === "string" ? b.id : "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const owned = await prisma.goal.findFirst({ where: { id, userId: a.userId }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: Prisma.GoalUpdateInput = {};
  if (typeof b.label === "string") data.label = b.label.trim().slice(0, 120);
  if ("target" in b) {
    const t = num(b.target);
    data.target = t != null ? new Prisma.Decimal(t) : null;
  }
  if (typeof b.active === "boolean") data.active = b.active;
  if ("periodStart" in b) data.periodStart = date(b.periodStart);
  if ("periodEnd" in b) data.periodEnd = date(b.periodEnd);
  await prisma.goal.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const a = await requireUser();
  if ("error" in a) return a.error;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const owned = await prisma.goal.findFirst({ where: { id, userId: a.userId }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await prisma.goal.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
