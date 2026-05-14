/**
 * GET /api/morning-verdict
 *
 * Returns the current 15-min bucket's brief rows (one per provider). If we're
 * inside the intraday window and DeepSeek/Gemini rows are missing, fires
 * background regen and returns what's already cached — frontend will pick up
 * the new rows on the next poll.
 *
 * Response shape:
 *   {
 *     bucketAt: ISO,
 *     intraday: bool,
 *     providers: {
 *       deepseek: { html, verdict, generatedAt, generatedBy, tokens, error? } | null,
 *       gemini:   ...,
 *       openai:   ...,
 *       claude:   ...,
 *     }
 *   }
 *
 * Auth: requires a signed-in user. The brief is gated content — same as the
 * rest of /dashboard.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ALL_PROVIDERS, isIntradayWindow, type BriefProvider } from "@/lib/brief/bucket";
import { readCurrentBucketWithLazyRegen, readLatestRow } from "@/server/brief-cache";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { bucket, rows } = await readCurrentBucketWithLazyRegen();
  const byProvider = new Map(rows.map((r) => [r.provider as BriefProvider, r]));

  const providers: Record<string, unknown> = {};
  for (const p of ALL_PROVIDERS) {
    const row = byProvider.get(p);
    if (row) {
      providers[p] = {
        html: row.htmlBody,
        structured: row.structuredJson,
        verdict: row.verdictJson,
        generatedAt: row.generatedAt.toISOString(),
        generatedBy: row.generatedBy,
        tokensIn: row.tokensIn,
        tokensOut: row.tokensOut,
        error: row.errorMsg,
        stale: false,
      };
    } else {
      // Cache miss for this bucket — fall back to the most recent row for this
      // provider so the UI can still render *something*. Mark stale=true.
      const latest = await readLatestRow(p);
      providers[p] = latest
        ? {
            html: latest.htmlBody,
            structured: latest.structuredJson,
            verdict: latest.verdictJson,
            generatedAt: latest.generatedAt.toISOString(),
            generatedBy: latest.generatedBy,
            tokensIn: latest.tokensIn,
            tokensOut: latest.tokensOut,
            error: latest.errorMsg,
            stale: true,
          }
        : null;
    }
  }

  return NextResponse.json(
    {
      bucketAt: bucket.toISOString(),
      intraday: isIntradayWindow(),
      providers,
    },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}
