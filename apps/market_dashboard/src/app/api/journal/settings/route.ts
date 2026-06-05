import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canSeePersonalBook(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = scopeUserId(session)!;

  const connection = await prisma.spreadsheetConnection.findUnique({
    where: { userId },
    select: {
      spreadsheetId: true,
      sheetTab: true,
      headerRow: true,
      lastSyncedAt: true,
      fixedFxRate: true,
    },
  });

  return NextResponse.json({
    connection: connection
      ? {
          ...connection,
          fixedFxRate: connection.fixedFxRate != null ? Number(connection.fixedFxRate) : null,
        }
      : null,
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canSeePersonalBook(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = scopeUserId(session)!;

  const body = (await req.json().catch(() => ({}))) as { fixedFxRate?: unknown };
  let fixedFxRate: number | null = null;
  if (body.fixedFxRate !== null && body.fixedFxRate !== undefined && body.fixedFxRate !== "") {
    const n = Number(body.fixedFxRate);
    if (!Number.isFinite(n) || n <= 0 || n > 20) {
      return NextResponse.json({ error: "fixedFxRate must be a positive number under 20" }, { status: 400 });
    }
    fixedFxRate = Math.round(n * 1_000_000) / 1_000_000;
  }

  const connection = await prisma.spreadsheetConnection.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!connection) {
    return NextResponse.json({ error: "Connect a journal sheet before setting the fixed FX rate" }, { status: 400 });
  }

  const updated = await prisma.spreadsheetConnection.update({
    where: { id: connection.id },
    data: { fixedFxRate },
    select: { fixedFxRate: true },
  });

  return NextResponse.json({
    fixedFxRate: updated.fixedFxRate != null ? Number(updated.fixedFxRate) : null,
  });
}
