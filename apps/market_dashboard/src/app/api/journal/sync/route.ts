import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { getGoogleAccessToken } from "@/lib/token-refresh";
import { fetchSheetRows, parseTradeRows, DEFAULT_COL_MAP, ColMap } from "@/lib/google-sheets";
import { generateTradeVerdict } from "@/lib/generate-trade-verdict";
import { NextResponse, after } from "next/server";

// Allow up to 60 s for the background verdict generation after response is sent
export const maxDuration = 60;

export async function POST() {
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

  let accessToken: string;
  try {
    accessToken = await getGoogleAccessToken(userScopeId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "REAUTH_REQUIRED") {
      return NextResponse.json({ error: "REAUTH_REQUIRED" }, { status: 401 });
    }
    return NextResponse.json({ error: `Google auth failed: ${msg}` }, { status: 500 });
  }

  const colMap: ColMap = Object.keys(connection.colMap as object).length
    ? (connection.colMap as ColMap)
    : DEFAULT_COL_MAP;

  let rows: string[][];
  try {
    rows = await fetchSheetRows(
      connection.spreadsheetId,
      connection.sheetTab,
      connection.headerRow,
      accessToken
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Sheets fetch failed: ${msg}` }, { status: 500 });
  }

  const trades = parseTradeRows(rows, colMap);

  try {
  await prisma.$transaction([
    prisma.tradeRecord.deleteMany({ where: { connectionId: connection.id } }),
    prisma.tradeRecord.createMany({
      data: trades.map((t) => ({
        userId: userScopeId,
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
        proposedEntry: t.proposedEntry,
        proposedSL: t.proposedSL,
        proposedTP: t.proposedTP,
        rrr: t.rrr,
        riskPct: t.riskPct,
        rewardPct: t.rewardPct,
        positionPct: t.positionPct,
        currency: t.currency,
        platform: t.platform,
        industry: t.industry,
        strategy: t.strategy,
        state: t.state,
      })),
    }),
    prisma.spreadsheetConnection.update({
      where: { id: connection.id },
      data: { lastSyncedAt: new Date() },
    }),
  ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `DB write failed: ${msg}` }, { status: 500 });
  }

  const OPEN_STATES = ["OPEN", "SEMI-OPEN", "PLANNING"];
  const open = trades.filter((t) => t.state ? OPEN_STATES.includes(t.state.toUpperCase()) : t.pnl === null).length;
  const closed = trades.length - open;
  const datesResolved = trades.filter((t) => t.tradeDate !== null).length;
  const sampleRawDates = rows.slice(1, 4).map((r) => r[colMap.date]);

  // Generate verdicts after response is sent — after() keeps the function alive on Vercel
  const userId = userScopeId;
  const connectionId = connection.id;
  after(async () => {
    try {
      const unscored = await prisma.tradeRecord.findMany({
        where: { userId, connectionId, verdictScore: null, buyPrice: { not: null } },
        take: 20,
        select: { id: true },
      });
      for (const { id } of unscored) {
        try {
          await generateTradeVerdict(id, userId, { tier: "fast" });
        } catch { /* non-fatal */ }
      }
    } catch { /* non-fatal */ }
  });

  return NextResponse.json({ synced: trades.length, open, closed, datesResolved, sampleRawDates });
}
