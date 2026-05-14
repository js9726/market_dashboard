/**
 * GET /api/trader-verdict
 *
 * Returns just the structured verdict JSON (mood, posture, standout, traders[])
 * for the current bucket — used by the spotlight/standout cards on the
 * Conviction Desk. We prefer the DeepSeek row; if missing, fall back to any
 * provider that has a verdictJson populated.
 *
 * This shares the same MorningBriefCache table as /api/morning-verdict — no
 * separate write path. The verdict is generated alongside the HTML in the
 * same provider call.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import type { BriefProvider } from "@/lib/brief/bucket";
import { readCurrentBucketWithLazyRegen, readLatestRow } from "@/server/brief-cache";

export const dynamic = "force-dynamic";

const PREFERENCE: BriefProvider[] = ["deepseek", "gemini", "openai", "claude"];

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { bucket, rows } = await readCurrentBucketWithLazyRegen();
  const byProvider = new Map(rows.map((r) => [r.provider as BriefProvider, r]));

  for (const p of PREFERENCE) {
    const row = byProvider.get(p);
    if (row?.verdictJson) {
      return NextResponse.json(
        {
          bucketAt: bucket.toISOString(),
          provider: p,
          generatedAt: row.generatedAt.toISOString(),
          stale: false,
          verdict: row.verdictJson,
        },
        { headers: { "Cache-Control": "private, max-age=60" } },
      );
    }
  }

  // No row for current bucket — fall back to most recent verdict from any provider.
  for (const p of PREFERENCE) {
    const latest = await readLatestRow(p);
    if (latest?.verdictJson) {
      return NextResponse.json(
        {
          bucketAt: bucket.toISOString(),
          provider: p,
          generatedAt: latest.generatedAt.toISOString(),
          stale: true,
          verdict: latest.verdictJson,
        },
        { headers: { "Cache-Control": "private, max-age=60" } },
      );
    }
  }

  return NextResponse.json({ bucketAt: bucket.toISOString(), verdict: null, stale: true });
}
