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
import {
  ALL_PROVIDERS,
  bucketOf,
  isApiBriefProvider,
  type BriefProvider,
} from "@/lib/brief/bucket";
import { regenAndStore, readBucket } from "@/server/brief-cache";
import {
  dispatchBriefRefresh,
  dispatchCodexSelfHosted,
  isCodexRunnerOnline,
  isDispatchConfigured,
} from "@/lib/github-dispatch";

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

  // Claude and Codex are subscription-only lanes. They must never fall through
  // to a metered serverless API when dispatch or the local runner is absent.
  if (p === "claude" || p === "openai") {
    if (!isDispatchConfigured()) {
      lastRerunAt.delete(p);
      return NextResponse.json(
        { error: `${p === "claude" ? "Claude" : "Codex"} subscription dispatch is not configured; no API fallback was used` },
        { status: 503 },
      );
    }

    const codexOnline = p === "openai" ? await isCodexRunnerOnline() : false;
    if (p === "openai" && !codexOnline) {
      lastRerunAt.delete(p);
      return NextResponse.json(
        { error: "Codex subscription runner is offline; no OpenAI API fallback was used" },
        { status: 503 },
      );
    }

    const dispatched = p === "openai"
      ? await dispatchCodexSelfHosted()
      : await dispatchBriefRefresh("claude");
    if (!dispatched.ok) {
      lastRerunAt.delete(p); // dispatch failed — let the user retry immediately
      return NextResponse.json(
        { error: `Dispatch failed: ${dispatched.error}` },
        { status: 502 },
      );
    }
    const lane = p === "openai" ? "Codex (subscription)" : "Claude (subscription)";
    return NextResponse.json({
      ok: true,
      dispatched: true,
      provider: p,
      message: `${lane} refresh queued — the wiki brief runs in CI and lands in a few minutes.`,
    });
  }

  if (!isApiBriefProvider(p)) {
    lastRerunAt.delete(p);
    return NextResponse.json({ error: "Provider has no permitted execution lane" }, { status: 503 });
  }

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
