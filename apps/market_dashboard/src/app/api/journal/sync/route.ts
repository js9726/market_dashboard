import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { generateTradeVerdict } from "@/lib/generate-trade-verdict";
import { syncUserJournal, JournalSyncError } from "@/server/journal-sync";
import { NextResponse, after } from "next/server";

// Thin session wrapper over server/journal-sync.ts (shared with the nightly
// /api/cron/sync-journal). Verdict generation stays on THIS path only — the
// cron path skips LLM spend.
export const maxDuration = 60;

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canSeePersonalBook(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userScopeId = scopeUserId(session)!;

  let result;
  try {
    result = await syncUserJournal(userScopeId);
  } catch (e) {
    if (e instanceof JournalSyncError) {
      if (e.code === "NO_CONNECTION") return NextResponse.json({ error: "No spreadsheet connected" }, { status: 400 });
      if (e.code === "REAUTH_REQUIRED") return NextResponse.json({ error: "REAUTH_REQUIRED" }, { status: 401 });
      if (e.code === "GOOGLE_AUTH") return NextResponse.json({ error: `Google auth failed: ${e.message}` }, { status: 500 });
      if (e.code === "SHEETS_FETCH") return NextResponse.json({ error: `Sheets fetch failed: ${e.message}` }, { status: 500 });
      return NextResponse.json({ error: `DB write failed: ${e.message}` }, { status: 500 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  // Generate verdicts after response is sent — after() keeps the function alive on Vercel
  const userId = userScopeId;
  const connectionId = result.connectionId;
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
        } catch {
          /* non-fatal */
        }
      }
    } catch {
      /* non-fatal */
    }
  });

  const { connectionId: _omit, ...body } = result;
  return NextResponse.json(body);
}
