import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getGoogleAccessToken } from "@/lib/token-refresh";
import { fetchSheetRows, parseTradeRows, DEFAULT_COL_MAP, ColMap } from "@/lib/google-sheets";
import { NextResponse } from "next/server";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const connection = await prisma.spreadsheetConnection.findUnique({
    where: { userId: session.user.id },
  });
  if (!connection) return NextResponse.json({ error: "No spreadsheet connected" }, { status: 400 });

  const accessToken = await getGoogleAccessToken(session.user.id);
  const colMap: ColMap = Object.keys(connection.colMap as object).length
    ? (connection.colMap as ColMap)
    : DEFAULT_COL_MAP;

  const rows = await fetchSheetRows(
    connection.spreadsheetId,
    connection.sheetTab,
    connection.headerRow,
    accessToken
  );

  const trades = parseTradeRows(rows, colMap);

  await prisma.$transaction([
    prisma.trade.deleteMany({ where: { connectionId: connection.id } }),
    prisma.trade.createMany({
      data: trades.map((t) => ({
        userId: session.user.id,
        connectionId: connection.id,
        ticker: t.ticker,
        tradeDate: t.tradeDate,
        buyPrice: t.buyPrice,
        quantity: t.quantity,
        pnl: t.pnl,
        exitPrice: t.exitPrice,
        side: t.side,
        fees: t.fees,
        notes: t.notes,
        rawRow: t.rawRow,
      })),
    }),
    prisma.spreadsheetConnection.update({
      where: { id: connection.id },
      data: { lastSyncedAt: new Date() },
    }),
  ]);

  const open = trades.filter((t) => t.pnl === null).length;
  const closed = trades.filter((t) => t.pnl !== null).length;
  return NextResponse.json({ synced: trades.length, open, closed });
}
