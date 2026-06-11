/**
 * /api/cron/refresh-brief
 *
 * Serverless backstop for the morning brief. The GH Actions premarket cron
 * (13:03 UTC) has fired hours late or not at all (2026-06-09..11), leaving the
 * DeepSeek/Gemini tabs stale for whole sessions. This Vercel cron regenerates
 * the snapshot-fed providers directly — same redundant-trigger pattern as
 * breadth/screeners. Claude/OpenAI stay on the GH-subscription / on-demand
 * paths per the daily cost cap.
 *
 * Skips providers whose latest row is fresh (no double-spend when the GH
 * workflow already posted), unless that row is an error row.
 */
import { NextResponse } from "next/server";
import { INTRADAY_PROVIDERS, bucketOf, type BriefProvider } from "@/lib/brief/bucket";
import { readLatestRow, regenAndStore } from "@/server/brief-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const FRESH_SKIP_MS = 90 * 60 * 1000; // GH posted within 90 min → skip

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    const keyParam = new URL(request.url).searchParams.get("secret");
    if (authHeader !== `Bearer ${cronSecret}` && keyParam !== cronSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const bucket = bucketOf();
  const results: Record<string, string> = {};

  await Promise.all(
    INTRADAY_PROVIDERS.map(async (provider: BriefProvider) => {
      try {
        const latest = await readLatestRow(provider);
        const ageMs = latest ? Date.now() - latest.generatedAt.getTime() : Infinity;
        if (latest && !latest.errorMsg && ageMs < FRESH_SKIP_MS) {
          results[provider] = `fresh (${Math.round(ageMs / 60000)}m old) — skipped`;
          return;
        }
        await regenAndStore({ bucket, provider, generatedBy: "cron-backstop" });
        const row = await readLatestRow(provider);
        results[provider] = row?.errorMsg ? `error: ${row.errorMsg}` : "regenerated";
      } catch (e) {
        results[provider] = `failed: ${e instanceof Error ? e.message : String(e)}`;
      }
    }),
  );

  return NextResponse.json({ ok: true, bucketAt: bucket.toISOString(), results });
}
