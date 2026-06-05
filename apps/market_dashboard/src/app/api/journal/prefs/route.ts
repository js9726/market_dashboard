/**
 * Per-user Daily Journal preferences (WS4).
 *
 * GET  /api/journal/prefs  -> { dailyDocUrl, widgetPrefs, defaultTemplate, autoWrite }
 * POST /api/journal/prefs  -> upsert the same fields (partial updates allowed)
 *
 * Backed by the JournalPref model (userId @unique). Auth-gated to the signed-in
 * owner/member; scoped to the caller's own row.
 */
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { DEFAULT_WIDGET_PREFS, type WidgetPrefs } from "../daily/route";
import { parseDocId } from "@/lib/google-docs";

export const dynamic = "force-dynamic";

function coerceWidgetPrefs(raw: unknown): WidgetPrefs {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = (k: keyof WidgetPrefs) =>
    typeof obj[k] === "boolean" ? (obj[k] as boolean) : DEFAULT_WIDGET_PREFS[k];
  return {
    morningBrief: pick("morningBrief"),
    marketBrief: pick("marketBrief"),
    highImpactNews: pick("highImpactNews"),
    tradeEntries: pick("tradeEntries"),
    reflection: pick("reflection"),
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canSeePersonalBook(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userScopeId = scopeUserId(session)!;

  const pref = await prisma.journalPref.findUnique({ where: { userId: userScopeId } });
  return NextResponse.json({
    dailyDocUrl: pref?.dailyDocUrl ?? null,
    widgetPrefs: coerceWidgetPrefs(pref?.widgetPrefs),
    defaultTemplate: pref?.defaultTemplate ?? null,
    autoWrite: pref?.autoWrite ?? false,
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canSeePersonalBook(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userScopeId = scopeUserId(session)!;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // dailyDocUrl: accept a URL or bare id; validate it parses to a doc id when
  // non-empty. An empty string clears it.
  let dailyDocUrl: string | null | undefined;
  if (body.dailyDocUrl !== undefined) {
    const raw = typeof body.dailyDocUrl === "string" ? body.dailyDocUrl.trim() : "";
    if (raw === "") {
      dailyDocUrl = null;
    } else if (!parseDocId(raw)) {
      return NextResponse.json(
        { error: "dailyDocUrl is not a recognisable Google Doc URL or id" },
        { status: 400 },
      );
    } else {
      dailyDocUrl = raw;
    }
  }

  const widgetPrefs =
    body.widgetPrefs !== undefined ? coerceWidgetPrefs(body.widgetPrefs) : undefined;

  let defaultTemplate: string | null | undefined;
  if (body.defaultTemplate !== undefined) {
    const raw = typeof body.defaultTemplate === "string" ? body.defaultTemplate : "";
    if (raw.length > 8192) {
      return NextResponse.json({ error: "defaultTemplate exceeds 8 KB" }, { status: 400 });
    }
    defaultTemplate = raw.length > 0 ? raw : null;
  }

  const autoWrite = typeof body.autoWrite === "boolean" ? body.autoWrite : undefined;

  const updateData: Prisma.JournalPrefUpdateInput = {};
  if (dailyDocUrl !== undefined) updateData.dailyDocUrl = dailyDocUrl;
  if (widgetPrefs !== undefined) updateData.widgetPrefs = widgetPrefs as unknown as Prisma.InputJsonValue;
  if (defaultTemplate !== undefined) updateData.defaultTemplate = defaultTemplate;
  if (autoWrite !== undefined) updateData.autoWrite = autoWrite;

  const pref = await prisma.journalPref.upsert({
    where: { userId: userScopeId },
    create: {
      userId: userScopeId,
      dailyDocUrl: dailyDocUrl ?? null,
      widgetPrefs: (widgetPrefs ?? DEFAULT_WIDGET_PREFS) as unknown as Prisma.InputJsonValue,
      defaultTemplate: defaultTemplate ?? null,
      autoWrite: autoWrite ?? false,
    },
    update: updateData,
  });

  return NextResponse.json({
    dailyDocUrl: pref.dailyDocUrl,
    widgetPrefs: coerceWidgetPrefs(pref.widgetPrefs),
    defaultTemplate: pref.defaultTemplate,
    autoWrite: pref.autoWrite,
  });
}
