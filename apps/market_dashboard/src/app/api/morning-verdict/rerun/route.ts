/**
 * POST /api/morning-verdict/rerun?provider=deepseek|gemini|openai|claude
 *
 * Owner-only manual re-trigger. Used by the "Re-run <provider>" buttons in
 * the Conviction Desk hero. Awaits the provider call (so the UI can show a
 * spinner) and returns the new row.
 *
 * Rate limit: 1 rerun per provider per 5 minutes (in-memory; resets on cold
 * start, which is fine — Vercel cold starts are themselves rate-limiting).
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ALL_PROVIDERS, bucketOf, type BriefProvider } from "@/lib/brief/bucket";
import { regenAndStore, readBucket } from "@/server/brief-cache";

export const dynamic = "force-dynamic";

const FIVE_MIN_MS = 5 * 60 * 1000;
const lastRerunAt = new Map<BriefProvider, number>();

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "owner") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const provider = searchParams.get("provider");
  if (!provider || !ALL_PROVIDERS.includes(provider as BriefProvider)) {
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
  }
  const p = provider as BriefProvider;

  const now = Date.now();
  const last = lastRerunAt.get(p) ?? 0;
  if (now - last < FIVE_MIN_MS) {
    const retryInSec = Math.ceil((FIVE_MIN_MS - (now - last)) / 1000);
    return NextResponse.json(
      { error: "Rate limited", retryInSec },
      { status: 429, headers: { "Retry-After": String(retryInSec) } },
    );
  }
  lastRerunAt.set(p, now);

  const bucket = bucketOf();
  await regenAndStore({
    bucket,
    provider: p,
    generatedBy: `owner-rerun:${session.user.email ?? session.user.id}`,
  });

  const rows = await readBucket(bucket);
  const row = rows.find((r) => r.provider === p);
  if (!row) {
    return NextResponse.json({ error: "Regen produced no row" }, { status: 500 });
  }

  return NextResponse.json({
    bucketAt: bucket.toISOString(),
    provider: p,
    html: row.htmlBody,
    structured: row.structuredJson,
    verdict: row.verdictJson,
    generatedAt: row.generatedAt.toISOString(),
    generatedBy: row.generatedBy,
    error: row.errorMsg,
  });
}
