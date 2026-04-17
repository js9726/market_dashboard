import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { DEFAULT_COL_MAP } from "@/lib/google-sheets";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json(null, { status: 401 });

  const connection = await prisma.spreadsheetConnection.findUnique({
    where: { userId: session.user.id },
  });
  return NextResponse.json(connection);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { spreadsheetId, sheetTab, headerRow, colMap } = await req.json() as {
    spreadsheetId: string;
    sheetTab: string;
    headerRow: number;
    colMap?: Record<string, number | null>;
  };

  const connection = await prisma.spreadsheetConnection.upsert({
    where: { userId: session.user.id },
    create: {
      userId: session.user.id,
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
