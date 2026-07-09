/**
 * /api/user/disclaimer — read + record the caller's disclaimer acceptance
 * (client-beta Phase 0.3).
 *
 *   GET  → { acceptedAt: string | null }
 *   POST → sets disclaimerAcceptedAt = now (idempotent; keeps the first
 *          acceptance timestamp), returns { acceptedAt }.
 *
 * Session-authed (explicit check — middleware 302 is wrong for AJAX).
 * The Ideas tab (Phase 1) gates on acceptedAt != null.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { disclaimerAcceptedAt: true },
  });
  return NextResponse.json({ acceptedAt: user?.disclaimerAcceptedAt?.toISOString() ?? null });
}

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const existing = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { disclaimerAcceptedAt: true },
  });
  if (existing?.disclaimerAcceptedAt) {
    return NextResponse.json({ acceptedAt: existing.disclaimerAcceptedAt.toISOString() });
  }
  const updated = await prisma.user.update({
    where: { id: session.user.id },
    data: { disclaimerAcceptedAt: new Date() },
    select: { disclaimerAcceptedAt: true },
  });
  return NextResponse.json({ acceptedAt: updated.disclaimerAcceptedAt?.toISOString() ?? null });
}
