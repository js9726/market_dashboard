import { auth } from "@/auth";
import { getGoogleAccessToken } from "@/lib/token-refresh";
import { fetchSheetRows, listSpreadsheetTabs } from "@/lib/google-sheets";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { spreadsheetId, sheetTab, headerRow = 14 } = await req.json() as {
    spreadsheetId: string;
    sheetTab?: string;
    headerRow?: number;
  };

  let accessToken: string;
  try {
    accessToken = await getGoogleAccessToken(session.user.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "REAUTH_REQUIRED") {
      return NextResponse.json({ error: "REAUTH_REQUIRED" }, { status: 401 });
    }
    return NextResponse.json({ error: `Google auth failed: ${msg}` }, { status: 500 });
  }

  try {
    const tabs = await listSpreadsheetTabs(spreadsheetId, accessToken);
    const targetTab = sheetTab ?? tabs[0]?.title ?? "Sheet1";
    const rows = await fetchSheetRows(spreadsheetId, targetTab, headerRow, accessToken);
    const headers: string[] = rows[0] ?? [];
    return NextResponse.json({ tabs, headers, resolvedTab: targetTab });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Sheets API failed: ${msg}` }, { status: 500 });
  }
}
