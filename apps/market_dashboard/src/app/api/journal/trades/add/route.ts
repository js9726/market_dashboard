import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getGoogleAccessToken } from "@/lib/token-refresh";
import { appendTradeRow, DEFAULT_COL_MAP, ColMap } from "@/lib/google-sheets";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const connection = await prisma.spreadsheetConnection.findUnique({
    where: { userId: session.user.id },
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

  const accessToken = await getGoogleAccessToken(session.user.id);
  await appendTradeRow(connection.spreadsheetId, connection.sheetTab, colMap, body, accessToken);

  const trade = await prisma.trade.create({
    data: {
      userId: session.user.id,
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
