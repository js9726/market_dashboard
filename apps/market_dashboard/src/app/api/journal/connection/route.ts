import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { DEFAULT_COL_MAP } from "@/lib/google-sheets";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json(null, { status: 401 });
  if (!canSeePersonalBook(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userScopeId = scopeUserId(session)!;

  const connection = await prisma.spreadsheetConnection.findUnique({
    where: { userId: userScopeId },
  });
  return NextResponse.json(connection);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canSeePersonalBook(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userScopeId = scopeUserId(session)!;

  const { spreadsheetId, sheetTab, headerRow, colMap } = await req.json() as {
    spreadsheetId: string;
    sheetTab: string;
    headerRow: number;
    colMap?: Record<string, number | null>;
  };

  const connection = await prisma.spreadsheetConnection.upsert({
    where: { userId: userScopeId },
    create: {
      userId: userScopeId,
      spreadsheetId,
      sheetTab,
      headerRow,
      colMap: colMap ?? DEFAULT_COL_MAP,
    },
    update: {
      spreadsheetId,
      sheetTab,
      headerRow,
      colMap: colMap ?? DEFAULT_COL_MAP,
    },
  });

  return NextResponse.json(connection);
}
