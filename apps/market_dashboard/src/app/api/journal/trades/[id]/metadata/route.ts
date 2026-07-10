import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const MAX_ITEMS = 24;
const MAX_TEXT_LEN = 80;
const MAX_URL_LEN = 500;

function sanitizeTextArray(value: unknown, field: string): string[] | NextResponse {
  if (!Array.isArray(value)) {
    return NextResponse.json({ error: `${field} must be an array` }, { status: 400 });
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      return NextResponse.json({ error: `${field} items must be strings` }, { status: 400 });
    }
    const clean = item.trim().slice(0, MAX_TEXT_LEN);
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    out.push(clean);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

function sanitizeScreenshotUrls(value: unknown): string[] | NextResponse {
  if (!Array.isArray(value)) {
    return NextResponse.json({ error: "screenshots must be an array" }, { status: 400 });
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      return NextResponse.json({ error: "screenshots items must be strings" }, { status: 400 });
    }
    const clean = item.trim().slice(0, MAX_URL_LEN);
    if (!clean) continue;
    let parsed: URL;
    try {
      parsed = new URL(clean);
    } catch {
      return NextResponse.json({ error: `Invalid screenshot URL: ${clean}` }, { status: 400 });
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return NextResponse.json({ error: "Screenshot URLs must be http(s)" }, { status: 400 });
    }
    if (seen.has(parsed.href)) continue;
    seen.add(parsed.href);
    out.push(parsed.href);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

export async function PATCH(req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canSeePersonalBook(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userScopeId = scopeUserId(session)!;
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const tags = sanitizeTextArray(body.tags ?? [], "tags");
  if (tags instanceof NextResponse) return tags;
  const mistakes = sanitizeTextArray(body.mistakes ?? [], "mistakes");
  if (mistakes instanceof NextResponse) return mistakes;
  const screenshots = sanitizeScreenshotUrls(body.screenshots ?? []);
  if (screenshots instanceof NextResponse) return screenshots;

  const trade = await prisma.tradeRecord.findFirst({
    where: { id, userId: userScopeId },
    select: { id: true },
  });
  if (!trade) return NextResponse.json({ error: "Trade not found" }, { status: 404 });

  const updated = await prisma.tradeRecord.update({
    where: { id },
    data: {
      tags: tags as Prisma.InputJsonValue,
      screenshots: screenshots as Prisma.InputJsonValue,
      mistakes: mistakes as Prisma.InputJsonValue,
    },
    select: {
      id: true,
      tags: true,
      screenshots: true,
      mistakes: true,
    },
  });

  return NextResponse.json({ ok: true, trade: updated });
}
