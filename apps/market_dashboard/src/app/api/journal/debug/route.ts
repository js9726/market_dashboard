import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getGoogleAccessToken } from "@/lib/token-refresh";
import { fetchSheetRows } from "@/lib/google-sheets";
import type { ColMap } from "@/lib/col-map";
import { NextResponse } from "next/server";

// Temporary debug endpoint — shows raw sheet values for the date column
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const connection = await prisma.spreadsheetConnection.findUnique({
    where: { userId: session.user.id },
  });
  if (!connection) return NextResponse.json({ error: "No connection" }, { status: 400 });

  const colMap = connection.colMap as ColMap;
  const accessToken = await getGoogleAccessToken(session.user.id);

  const rows = await fetchSheetRows(
    connection.spreadsheetId,
    connection.sheetTab,
    connection.headerRow,
    accessToken
  );

  const header = rows[0] ?? [];
  const sample = rows.slice(1, 6); // first 5 data rows

  return NextResponse.json({
    headerRow: connection.headerRow,
    colMap,
    dateColIndex: colMap.date,
    dateColHeader: header[colMap.date],
    totalRows: rows.length,
    sampleDateValues: sample.map((row, i) => ({
      rowIndex: i + 1,
      rawDateValue: row[colMap.date],
      rowLength: row.length,
      ticker: row[colMap.ticker],
    })),
  });
}
