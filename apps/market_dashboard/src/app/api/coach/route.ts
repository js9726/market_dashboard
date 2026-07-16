/**
 * /api/coach — AI coach over the caller's OWN journal (TradesViz-platform P3-🄺,
 * TraderSync-Cypher-style).
 *
 *   POST { question, mode? } → data-grounded answer, persisted as CoachInsight.
 *   GET  ?limit=5            → recent insights (newest first).
 *
 * Design decisions (per the approved plan §C P3 + Codex audit pillar 5):
 *   - EVIDENCE-FIRST, not tool-loop: the server computes deterministic
 *     aggregates via src/server/journal-pivot.ts — the SAME core the Explore
 *     screen uses — and hands the LLM that JSON. The model interprets numbers;
 *     it never invents them, and the exact evidence is persisted alongside the
 *     answer so it stays auditable after the fact.
 *   - PERSISTED: every answer lands in CoachInsight ("AI output must persist
 *     through dashboard schemas, not remain chat-only").
 *   - USER-SCOPED: strictly the caller's own trades (multi-tenant rule).
 *   - QUOTA-GUARDED: reuses the dailyScans quota; incremented only after a
 *     successful LLM call.
 *   - Cypher-style modes flavor the system prompt: performance | risk |
 *     pattern | accountability.
 */
import { NextResponse } from "next/server";
import { requireUserIdAndQuota, incrementScanCount } from "@/lib/auth-helpers";
import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { callLLM } from "@/utils/llm-router";
import { computePivot, loadClosedTrades, usdPnl } from "@/server/journal-pivot";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODES: Record<string, string> = {
  performance:
    "You are a PERFORMANCE ANALYST: quantify edge — where the P&L actually comes from and where it leaks.",
  risk: "You are a RISK & PLANNING COACH: focus on loss sizes, drawdown behaviour, position discipline, and rule adherence.",
  pattern:
    "You are a PATTERN DETECTOR: hunt for recurring conditions (day, setup, tag, market) that separate the trader's winners from losers.",
  accountability:
    "You are an ACCOUNTABILITY COACH: compare what the trader SAID they'd do (rules, plans) against what the data shows they DID; be direct.",
};

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canSeePersonalBook(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = scopeUserId(session)!;
  const limit = Math.min(20, Math.max(1, parseInt(new URL(req.url).searchParams.get("limit") ?? "5", 10) || 5));
  const insights = await prisma.coachInsight.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, mode: true, question: true, answer: true, model: true, createdAt: true },
  });
  return NextResponse.json({ insights });
}

export async function POST(req: Request) {
  // Quota + auth in one step (owner exempt from quota, members capped).
  const authRes = await requireUserIdAndQuota();
  if ("error" in authRes && authRes.error) return authRes.error;
  const userId = (authRes as { userId: string }).userId;

  const body = (await req.json().catch(() => ({}))) as { question?: unknown; mode?: unknown };
  const question = typeof body.question === "string" ? body.question.trim().slice(0, 500) : "";
  if (question.length < 5) {
    return NextResponse.json({ error: "Ask a real question (min 5 chars, max 500)." }, { status: 400 });
  }
  const mode = typeof body.mode === "string" && MODES[body.mode] ? body.mode : "performance";

  // ── Deterministic evidence (same math as the Explore screen) ────────────
  const trades = await loadClosedTrades(userId);
  if (trades.length === 0) {
    return NextResponse.json({
      answer:
        "You have no closed trades yet, so there is nothing to analyse. Log or import trades first — then ask me again.",
      persisted: false,
    });
  }
  const dims = ["dow", "strategy", "tag", "mistake", "month", "side", "platform"] as const;
  const pivots: Record<string, unknown> = {};
  for (const d of dims) {
    const p = computePivot(trades, d);
    // Trim to what an LLM needs: top 12 groups by |totalPnl|.
    pivots[d] = p.rows
      .sort((a, b) => Math.abs(b.totalPnl) - Math.abs(a.totalPnl))
      .slice(0, 12)
      .map(({ key, count, winRate, totalPnl, expectancy, profitFactor, avgRrr }) => ({ key, count, winRate, totalPnl, expectancy, profitFactor, avgRrr }));
  }
  const overall = computePivot(trades, "side").totals;
  const recent = trades
    .filter((t) => usdPnl(t) != null)
    .sort((a, b) => ((b.tradeDate ?? b.executedAt)?.getTime() ?? 0) - ((a.tradeDate ?? a.executedAt)?.getTime() ?? 0))
    .slice(0, 15)
    .map((t) => ({
      ticker: t.ticker,
      date: (t.tradeDate ?? t.executedAt)?.toISOString().slice(0, 10),
      pnlUsd: usdPnl(t),
      strategy: t.strategy,
      side: t.side,
    }));
  const evidence = { overall, pivots, recentClosed: recent };

  const system = `${MODES[mode]}
You coach a swing trader using ONLY the evidence JSON provided (aggregates over THEIR own closed trades, USD).
Hard rules:
- Every number you state must come from the evidence. If the evidence can't answer the question, say exactly what's missing.
- Small samples (n < 15) get an explicit caution, not a confident claim.
- Weekend-dated trades are source-sheet date errors, not real sessions.
- Be specific and practical: end with ONE actionable adjustment, framed as a testable rule.
- Keep it under 250 words. No preamble.
House exit doctrine for reference: trim 1/3 at 2R then trail the 21dma, or 4-tranche 25% at resistance/8EMA/21EMA/50EMA. Known operator calibration (2026-07-13): winners entered Tue/Wed were historically cut at ~half the holding time of other days; midweek entries must be planned, not chased.`;

  const user = `QUESTION: ${question}\n\nEVIDENCE:\n${JSON.stringify(evidence)}`;

  const out: { providerUsed?: string; modelUsed?: string } = {};
  let answer: string;
  try {
    answer = await callLLM(user, system, { maxTokens: 900, tier: "standard" }, out);
  } catch (e) {
    return NextResponse.json(
      { error: `Coach unavailable: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }
  await incrementScanCount(userId);

  const insight = await prisma.coachInsight.create({
    data: {
      userId,
      mode,
      question,
      answer,
      evidence: evidence as unknown as Prisma.InputJsonValue,
      model: out.modelUsed ?? out.providerUsed ?? null,
    },
    select: { id: true, createdAt: true },
  });

  return NextResponse.json({
    id: insight.id,
    mode,
    question,
    answer,
    model: out.modelUsed ?? out.providerUsed ?? null,
    createdAt: insight.createdAt,
    persisted: true,
  });
}
