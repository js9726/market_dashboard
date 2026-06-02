import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { getGoogleAccessToken } from "@/lib/token-refresh";
import { appendTradeRow, DEFAULT_COL_MAP, ColMap } from "@/lib/google-sheets";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canSeePersonalBook(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userScopeId = scopeUserId(session)!;

  const connection = await prisma.spreadsheetConnection.findUnique({
    where: { userId: userScopeId },
  });
  if (!connection) return NextResponse.json({ error: "No spreadsheet connected" }, { status: 400 });

  const body = await req.json() as {
    ticker: string;
    tradeDate: string;
    side: string | null;
    buyPrice: string;
    quantity: string;
    exitPrice: string;
    pnl: string;
    fees: string;
    notes: string;
  };

  const colMap: ColMap = Object.keys(connection.colMap as object).length
    ? (connection.colMap as ColMap)
    : DEFAULT_COL_MAP;

  const accessToken = await getGoogleAccessToken(userScopeId);
  await appendTradeRow(connection.spreadsheetId, connection.sheetTab, colMap, body, accessToken);

  const trade = await prisma.tradeRecord.create({
    data: {
      userId: userScopeId,
      connectionId: connection.id,
      ticker: body.ticker,
      tradeDate: body.tradeDate ? new Date(body.tradeDate) : null,
      buyPrice: body.buyPrice ? parseFloat(body.buyPrice) : null,
      quantity: body.quantity ? parseFloat(body.quantity) : null,
      pnl: body.pnl ? parseFloat(body.pnl) : null,
      exitPrice: body.exitPrice ? parseFloat(body.exitPrice) : null,
      side: body.side || null,
      fees: body.fees ? parseFloat(body.fees) : null,
      notes: body.notes || null,
      rawRow: [],
    },
  });

  return NextResponse.json({ success: true, trade });
}
