/**
 * POST /api/morning-verdict/ingest
 *
 * Machine-only endpoint. Used by the GH Actions pre-market cron and by the
 * Python morning_brief.py to push provider results (HTML body + verdict JSON)
 * into the Postgres cache.
 *
 * Auth: `Authorization: Bearer <BRIEF_INGEST_KEY>`. Returns 401 on mismatch.
 *
 * Body:
 *   {
 *     bucketAt?: ISO,            // optional — defaults to floor(now, 15m) UTC
 *     provider: "deepseek" | "gemini" | "openai" | "claude",
 *     htmlBody: string,          // legacy — empty for new pre-market runs
 *     structuredJson?: unknown,  // PRIMARY: full StructuredBrief shape
 *     verdictJson?: unknown,     // legacy — same as structuredJson
 *     generatedBy: string,       // e.g. "cron-premarket"
 *     inputHash: string,         // sha256 of the snapshot fed to the provider
 *     tokensIn?: number,
 *     tokensOut?: number,
 *     costUsd?: number,
 *   }
 */
import { NextResponse } from "next/server";
import { ALL_PROVIDERS, bucketOf, type BriefProvider } from "@/lib/brief/bucket";
import { ingestRow } from "@/server/brief-cache";
import { normalizeBriefProvider } from "@/lib/brief/provider-selection";

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const expected = process.env.BRIEF_INGEST_KEY;
  if (!expected) return false;
  const got = req.headers.get("authorization");
  return got === `Bearer ${expected}`;
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const provider = normalizeBriefProvider(body.provider as string | undefined);
  const htmlBody = body.htmlBody as string | undefined;
  const generatedBy = body.generatedBy as string | undefined;
  const inputHash = body.inputHash as string | undefined;

  if (!provider || !ALL_PROVIDERS.includes(provider as BriefProvider)) {
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
  }
  const hasBriefPayload = body.structuredJson !== undefined || body.verdictJson !== undefined;
  if (typeof htmlBody !== "string") {
    return NextResponse.json({ error: "htmlBody must be a string" }, { status: 400 });
  }
  if (!htmlBody && !hasBriefPayload) {
    return NextResponse.json({ error: "htmlBody or structuredJson required" }, { status: 400 });
  }
  if (!generatedBy || typeof generatedBy !== "string") {
    return NextResponse.json({ error: "generatedBy required" }, { status: 400 });
  }
  if (!inputHash || typeof inputHash !== "string") {
    return NextResponse.json({ error: "inputHash required" }, { status: 400 });
  }

  const bucket = body.bucketAt ? bucketOf(new Date(String(body.bucketAt))) : bucketOf();

  // structuredJson is the new primary payload. Fall back to verdictJson when
  // a legacy producer only sends the old shape.
  const structuredJson = body.structuredJson ?? body.verdictJson ?? null;

  const row = await ingestRow({
    bucket,
    provider: provider as BriefProvider,
    htmlBody,
    verdictJson: body.verdictJson ?? structuredJson,
    structuredJson,
    generatedBy,
    inputHash,
    tokensIn: typeof body.tokensIn === "number" ? body.tokensIn : null,
    tokensOut: typeof body.tokensOut === "number" ? body.tokensOut : null,
    costUsd: typeof body.costUsd === "number" ? body.costUsd : null,
  });

  return NextResponse.json({
    ok: true,
    id: row.id,
    provider,
    bucketAt: row.bucketAt.toISOString(),
    generatedBy,
    hasStructuredJson: structuredJson != null,
  });
}
