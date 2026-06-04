/**
 * Automated Daily Journal — compose + write (WS4).
 *
 * GET  /api/journal/daily?date=YYYY-MM-DD
 *   Composes (but does NOT persist/write) the day's journal markdown from:
 *     - MorningBriefCache for that day  (market briefing + high-impact news)
 *     - each of that day's trades' AI briefings (Trade.verdict → latest
 *       TradeVerdictHistory → WikiTradeVerdict, in that order)
 *     - the operator's DailyReflection (mood / sleep / conditions / notes)
 *   honouring the user's JournalPref.widgetPrefs toggles (or a default set).
 *   Returns { markdown, sections, prefs }.
 *
 * POST /api/journal/daily   { date?, force? }
 *   "Generate today": composes the day, optionally fills missing trade verdicts
 *   via generateTradeVerdict(..., { tier: "fast" }), writes to the user's
 *   JournalPref.dailyDocUrl Google Doc (if set), and persists the composed
 *   markdown into DailyReflection.notes (via the same upsert the manual form
 *   uses). Returns the composed markdown + doc-write result.
 *
 * Auth: signed-in + canSeePersonalBook (owner/member). Personal data is scoped
 * to the caller via scopeUserId.
 */
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { appendMarkdownSection } from "@/lib/google-docs";
import { generateTradeVerdict } from "@/lib/generate-trade-verdict";
import { moodLabel } from "@/lib/journal/mood";
import type { StructuredBrief, BriefNewsItem } from "@/types/structured-brief";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── Widget prefs ──────────────────────────────────────────────────────────

export interface WidgetPrefs {
  morningBrief: boolean; // mood/posture line + index/sector read
  marketBrief: boolean; // alias kept for the config panel toggle (market summary block)
  highImpactNews: boolean; // structuredJson.news (HIGH impact filtered)
  tradeEntries: boolean; // per-trade AI briefings for the day
  reflection: boolean; // operator DailyReflection
}

export const DEFAULT_WIDGET_PREFS: WidgetPrefs = {
  morningBrief: true,
  marketBrief: true,
  highImpactNews: true,
  tradeEntries: true,
  reflection: true,
};

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

// ── Date helpers ────────────────────────────────────────────────────────────

function parseIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !DATE_RE.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : value;
}

function dayStartUtc(dateIso: string): Date {
  return new Date(`${dateIso}T00:00:00.000Z`);
}
function dayEndUtc(dateIso: string): Date {
  return new Date(`${dateIso}T23:59:59.999Z`);
}
function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function plainTicker(t: string): string {
  return t.replace(/^[A-Za-z]{2}\./, "").toUpperCase();
}
function num(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// ── Brief preference (Claude → openai → gemini → deepseek) ───────────────────

const BRIEF_PROVIDER_ORDER = ["claude", "openai", "gemini", "deepseek"] as const;

// ── Section composers ─────────────────────────────────────────────────────

export interface ComposedSection {
  key: string;
  title: string;
  markdown: string;
}

function composeMarketBrief(brief: StructuredBrief | null, prefs: WidgetPrefs): ComposedSection | null {
  if (!prefs.morningBrief && !prefs.marketBrief) return null;
  if (!brief) {
    return { key: "market", title: "Market Briefing", markdown: "_No morning brief cached for this date._" };
  }
  const lines: string[] = [];
  const mood = brief.mood;
  if (mood && (mood.label || mood.posture || mood.summary)) {
    const tag = [mood.label, mood.posture].filter(Boolean).join(" · ");
    if (tag) lines.push(`**Mood:** ${tag}`);
    if (mood.summary) lines.push(mood.summary);
  }
  if (brief.indicesNarrative) lines.push(`**Indices:** ${brief.indicesNarrative}`);
  if (brief.sectorsNarrative) lines.push(`**Sectors:** ${brief.sectorsNarrative}`);
  if (brief.breadth && (brief.breadth.up != null || brief.breadth.down != null)) {
    lines.push(`**Breadth:** ${brief.breadth.up ?? "—"} up / ${brief.breadth.down ?? "—"} down`);
  }
  if (brief.standout?.ticker) {
    const s = brief.standout;
    const bits = [
      `**Standout:** ${s.ticker}${s.side ? ` (${s.side})` : ""}`,
      s.thesis ? `— ${s.thesis}` : null,
    ].filter(Boolean);
    lines.push(bits.join(" "));
    const plan = [
      s.entry != null ? `entry ${s.entry}` : null,
      s.stop != null ? `stop ${s.stop}` : null,
      s.target != null ? `target ${s.target}` : null,
      s.rrr != null ? `R:R ${s.rrr}` : null,
    ].filter(Boolean);
    if (plan.length) lines.push(`  - ${plan.join(" · ")}`);
  }
  if (brief.alert) lines.push(`**Alert:** ${brief.alert}`);
  if (lines.length === 0) lines.push("_Brief cached but no narrative fields populated._");
  return { key: "market", title: "Market Briefing", markdown: lines.join("\n\n") };
}

function composeNews(brief: StructuredBrief | null, prefs: WidgetPrefs): ComposedSection | null {
  if (!prefs.highImpactNews) return null;
  const news: BriefNewsItem[] = Array.isArray(brief?.news) ? brief!.news! : [];
  const high = news.filter((n) => n && n.headline && (n.impact == null || n.impact === "HIGH" || n.impact === "MED"));
  // Prefer HIGH; if any HIGH exist, only show those.
  const highOnly = high.filter((n) => n.impact === "HIGH");
  const show = highOnly.length > 0 ? highOnly : high;
  if (show.length === 0) return null;
  const lines = show.map((n) => {
    const tags = Array.isArray(n.tickers) && n.tickers.length ? ` [${n.tickers.join(", ")}]` : "";
    const src = n.source ? ` (${n.source})` : "";
    const impact = n.impact ? `**${n.impact}** ` : "";
    return `- ${impact}${n.headline}${tags}${src}`;
  });
  return { key: "news", title: "High-Impact News", markdown: lines.join("\n") };
}

type TradeRow = {
  id: string;
  ticker: string;
  side: string | null;
  buyPrice: Prisma.Decimal | null;
  quantity: Prisma.Decimal | null;
  pnl: Prisma.Decimal | null;
  strategy: string | null;
  notes: string | null;
  verdict: Prisma.JsonValue | null;
  verdictScore: number | null;
};

/** One-line briefing per trade, pulling whatever verdict source exists. */
function tradeBriefingLine(
  row: TradeRow,
  wikiVerdict: { score: number | null; setup: string | null; thesis: string | null } | null,
  histVerdict: { score: number | null; summary: string | null } | null,
): string[] {
  const out: string[] = [];
  const head = [
    `**${plainTicker(row.ticker)}**`,
    row.side ? `(${row.side})` : null,
    row.buyPrice != null ? `@ ${num(row.buyPrice)}` : null,
    row.strategy ? `· ${row.strategy}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  out.push(`- ${head}`);

  // Verdict precedence: TradeRecord.verdict → TradeVerdictHistory → WikiTradeVerdict.
  const v = (row.verdict ?? null) as Record<string, unknown> | null;
  if (v && (v.overall_verdict || v.overall_score != null || v.lesson)) {
    const score = num(row.verdictScore) ?? num(v.overall_score);
    const verdict = str(v.overall_verdict);
    if (verdict || score != null) {
      out.push(`  - Verdict: ${verdict ?? "—"}${score != null ? ` (score ${score})` : ""}`);
    }
    const lesson = str(v.lesson);
    if (lesson) out.push(`  - ${lesson}`);
  } else if (histVerdict && (histVerdict.summary || histVerdict.score != null)) {
    out.push(
      `  - Verdict: ${histVerdict.summary ?? "—"}${histVerdict.score != null ? ` (score ${histVerdict.score})` : ""}`,
    );
  } else if (wikiVerdict && (wikiVerdict.setup || wikiVerdict.thesis || wikiVerdict.score != null)) {
    const tag = [wikiVerdict.setup, wikiVerdict.score != null ? `score ${wikiVerdict.score}` : null]
      .filter(Boolean)
      .join(" · ");
    if (tag) out.push(`  - Wiki: ${tag}`);
    if (wikiVerdict.thesis) out.push(`  - ${wikiVerdict.thesis}`);
  } else {
    out.push("  - No AI briefing yet.");
  }
  if (row.notes) out.push(`  - Note: ${row.notes}`);
  return out;
}

function composeReflection(
  reflection: {
    moodEmoji: string | null;
    sleepHours: Prisma.Decimal | null;
    marketConditions: string | null;
    notes: string | null;
  } | null,
  prefs: WidgetPrefs,
): ComposedSection | null {
  if (!prefs.reflection) return null;
  if (!reflection) return null;
  const lines: string[] = [];
  const moodTxt = moodLabel(reflection.moodEmoji);
  if (reflection.moodEmoji || moodTxt) {
    lines.push(`**Mood:** ${reflection.moodEmoji ?? ""} ${moodTxt ?? ""}`.trim());
  }
  if (reflection.sleepHours != null) lines.push(`**Sleep:** ${num(reflection.sleepHours)} hrs`);
  if (reflection.marketConditions) lines.push(`**Conditions:** ${reflection.marketConditions}`);
  if (reflection.notes) lines.push(reflection.notes);
  if (lines.length === 0) return null;
  return { key: "reflection", title: "Reflection", markdown: lines.join("\n\n") };
}

// ── Core compose (shared by GET, POST, and the cron route) ───────────────────

export interface ComposeResult {
  date: string;
  markdown: string;
  sections: ComposedSection[];
  prefs: WidgetPrefs;
  tradeCount: number;
  hasBrief: boolean;
}

/**
 * Compose the full day's journal markdown for `userScopeId` + `dateIso`.
 * Pure read (no writes). Optionally fills missing trade verdicts when
 * `opts.fillVerdicts` is set (only used by POST / cron).
 */
export async function composeDailyJournal(
  userScopeId: string,
  dateIso: string,
  opts: { fillVerdicts?: boolean } = {},
): Promise<ComposeResult> {
  const pref = await prisma.journalPref.findUnique({ where: { userId: userScopeId } });
  const prefs = coerceWidgetPrefs(pref?.widgetPrefs);

  const start = dayStartUtc(dateIso);
  const end = dayEndUtc(dateIso);

  // ── Morning brief for the day (prefer claude, fall back through providers) ──
  const briefRows = await prisma.morningBriefCache.findMany({
    where: { bucketAt: { gte: start, lte: end }, errorMsg: null },
    orderBy: { generatedAt: "desc" },
    select: { provider: true, structuredJson: true, verdictJson: true },
  });
  let brief: StructuredBrief | null = null;
  for (const provider of BRIEF_PROVIDER_ORDER) {
    const row = briefRows.find((r) => r.provider === provider);
    const payload = (row?.structuredJson ?? row?.verdictJson) as StructuredBrief | null | undefined;
    if (payload) {
      brief = payload;
      break;
    }
  }
  if (!brief && briefRows.length > 0) {
    const fallback = (briefRows[0].structuredJson ?? briefRows[0].verdictJson) as StructuredBrief | null;
    brief = fallback ?? null;
  }

  // ── That day's trades ──────────────────────────────────────────────────────
  let trades = await prisma.tradeRecord.findMany({
    where: { userId: userScopeId, tradeDate: { gte: start, lte: end } },
    orderBy: { tradeDate: "asc" },
    select: {
      id: true, ticker: true, side: true, buyPrice: true, quantity: true,
      pnl: true, strategy: true, notes: true, verdict: true, verdictScore: true,
    },
  });

  // Optionally fill missing verdicts (fast tier) — POST / cron only.
  if (opts.fillVerdicts && prefs.tradeEntries) {
    for (const t of trades) {
      if (t.verdict || t.buyPrice == null) continue;
      try {
        await generateTradeVerdict(t.id, userScopeId, { tier: "fast" });
      } catch (err) {
        console.warn(`[journal/daily] verdict fill failed for ${t.ticker}:`, err);
      }
    }
    // Re-read so freshly-generated verdicts appear in the composed output.
    trades = await prisma.tradeRecord.findMany({
      where: { userId: userScopeId, tradeDate: { gte: start, lte: end } },
      orderBy: { tradeDate: "asc" },
      select: {
        id: true, ticker: true, side: true, buyPrice: true, quantity: true,
        pnl: true, strategy: true, notes: true, verdict: true, verdictScore: true,
      },
    });
  }

  // History + wiki fallbacks for trades that lack an inline verdict.
  const tradeIds = trades.map((t) => t.id);
  const histByTrade = new Map<string, { score: number | null; summary: string | null }>();
  if (tradeIds.length) {
    const hist = await prisma.tradeVerdictHistory.findMany({
      where: { tradeId: { in: tradeIds }, kind: "day-0" },
      orderBy: { createdAt: "desc" },
      select: { tradeId: true, score: true, verdict: true },
    });
    for (const h of hist) {
      if (histByTrade.has(h.tradeId)) continue; // newest wins
      const v = (h.verdict ?? {}) as Record<string, unknown>;
      histByTrade.set(h.tradeId, {
        score: num(h.score),
        summary: str(v.overall_verdict) ?? str(v.lesson),
      });
    }
  }

  const connection = await prisma.spreadsheetConnection.findUnique({
    where: { userId: userScopeId },
    select: { sheetTab: true },
  });
  const opLabel = (connection?.sheetTab ?? "").match(/\[([A-Za-z0-9]{2,8})\]/)?.[1]?.toUpperCase() ?? null;
  const wikiByTicker = new Map<string, { score: number | null; setup: string | null; thesis: string | null }>();
  if (opLabel && trades.length) {
    const tickers = Array.from(new Set(trades.map((t) => plainTicker(t.ticker))));
    const wiki = await prisma.wikiTradeVerdict.findMany({
      where: { operatorLabel: opLabel, ticker: { in: tickers }, tradeDate: start },
      select: { ticker: true, day0Json: true },
    });
    for (const w of wiki) {
      const d0 = (w.day0Json ?? {}) as Record<string, unknown>;
      wikiByTicker.set(plainTicker(w.ticker), {
        score: num(d0.composite_technical_score),
        setup: str(d0.setup_classification),
        thesis: str(d0.setup_justification) ?? str(d0.predicted_outcome),
      });
    }
  }

  // ── Operator reflection ─────────────────────────────────────────────────────
  const reflection = await prisma.dailyReflection.findUnique({
    where: { userId_entryDate: { userId: userScopeId, entryDate: start } },
    select: { moodEmoji: true, sleepHours: true, marketConditions: true, notes: true },
  });

  // ── Assemble sections in display order ──────────────────────────────────────
  const sections: ComposedSection[] = [];
  const marketSection = composeMarketBrief(brief, prefs);
  if (marketSection) sections.push(marketSection);
  const newsSection = composeNews(brief, prefs);
  if (newsSection) sections.push(newsSection);

  if (prefs.tradeEntries) {
    if (trades.length > 0) {
      const lines: string[] = [];
      for (const t of trades) {
        lines.push(
          ...tradeBriefingLine(
            t,
            wikiByTicker.get(plainTicker(t.ticker)) ?? null,
            histByTrade.get(t.id) ?? null,
          ),
        );
      }
      sections.push({ key: "trades", title: "Trade Entries", markdown: lines.join("\n") });
    } else {
      sections.push({ key: "trades", title: "Trade Entries", markdown: "_No trades recorded for this date._" });
    }
  }

  const reflectionSection = composeReflection(reflection, prefs);
  if (reflectionSection) sections.push(reflectionSection);

  const markdown = sections
    .map((s) => `### ${s.title}\n\n${s.markdown}`)
    .join("\n\n");

  return {
    date: dateIso,
    markdown,
    sections,
    prefs,
    tradeCount: trades.length,
    hasBrief: brief != null,
  };
}

// ── HTTP handlers ────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canSeePersonalBook(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userScopeId = scopeUserId(session)!;

  const url = new URL(req.url);
  const dateIso = parseIsoDate(url.searchParams.get("date") ?? todayIso());
  if (!dateIso) {
    return NextResponse.json({ error: "Invalid or missing ?date=YYYY-MM-DD" }, { status: 400 });
  }

  const composed = await composeDailyJournal(userScopeId, dateIso);
  return NextResponse.json(composed);
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

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // empty body is fine — defaults to today
  }

  const dateIso = parseIsoDate(body.date ?? todayIso());
  if (!dateIso) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }
  const force = body.force === true;

  const composed = await composeDailyJournal(userScopeId, dateIso, { fillVerdicts: true });

  // ── Persist the composed reflection (same upsert the manual form uses) ──────
  // We write the composed markdown into DailyReflection.notes so the day's
  // generated journal is visible in the dashboard. We DON'T clobber the
  // operator's own mood/sleep/conditions — those are merged in if present.
  const start = dayStartUtc(dateIso);
  const existingReflection = await prisma.dailyReflection.findUnique({
    where: { userId_entryDate: { userId: userScopeId, entryDate: start } },
  });
  const composedNote = composed.markdown.slice(0, 4096);
  await prisma.dailyReflection.upsert({
    where: { userId_entryDate: { userId: userScopeId, entryDate: start } },
    create: { userId: userScopeId, entryDate: start, notes: composedNote },
    update: {
      // Keep operator notes if they already wrote some; otherwise store composed.
      notes: existingReflection?.notes && existingReflection.notes.trim().length > 0
        ? existingReflection.notes
        : composedNote,
    },
  });

  // ── Optional Google Doc write ───────────────────────────────────────────────
  const pref = await prisma.journalPref.findUnique({ where: { userId: userScopeId } });
  let docResult: Awaited<ReturnType<typeof appendMarkdownSection>> | { ok: false; reason: string } | null = null;
  if (pref?.dailyDocUrl) {
    docResult = await appendMarkdownSection(pref.dailyDocUrl, composed.markdown, {
      userId: userScopeId,
      dateLabel: dateIso,
      title: "Daily Journal",
      force,
    });
  } else {
    docResult = { ok: false, reason: "no_doc_url_configured" };
  }

  return NextResponse.json({
    ok: true,
    date: dateIso,
    markdown: composed.markdown,
    sections: composed.sections,
    tradeCount: composed.tradeCount,
    hasBrief: composed.hasBrief,
    doc: docResult,
  });
}
