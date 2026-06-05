/**
 * POST /api/analysis/deep-dive
 *
 * Catalyst-first deep-dive scorecard for a ticker (the "further detail" view that
 * augments the 7-trader rubric). Grounded in yahoo-finance2 facts, synthesized by
 * callLLM into the 8-section DeepDiveResult contract.
 *
 * Body: { ticker: string; tradeId?: string; force?: boolean; provider?: string }
 * Returns: DeepDiveResult (+ _meta).
 *
 * Caching: when a tradeId is supplied, the result is cached onto the trade's
 * `verdict` JSON under a `deep_dive` key so it's reusable like other verdicts.
 * A non-forced request with a cached deep_dive returns it without an LLM call
 * (and without charging quota).
 *
 * Auth: requireUserIdAndQuota — personal LLM scan, same gate as trade-review.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserIdAndQuota, incrementScanCount } from "@/lib/auth-helpers";
import { callLLM } from "@/utils/llm-router";
import { Prisma } from "@prisma/client";
import {
  SYSTEM_PROMPT,
  buildPrompt,
  type DeepDiveResult,
} from "@/lib/trade-deep-dive/prompt";
import { fetchDeepDiveData } from "../../../../../agents/fundamental/tools/deep-dive-data";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const guard = await requireUserIdAndQuota();
    if (guard.error) return guard.error;
    const userId = guard.userId;

    const body = await request.json().catch(() => ({}));
    const tickerRaw: string | undefined = body.ticker;
    const tradeId: string | undefined = body.tradeId;
    const force: boolean = body.force === true;
    const provider: string | undefined = body.provider;

    // tradeId path: resolve ticker from the (owned) trade + use it for caching.
    let dbTrade: Awaited<ReturnType<typeof prisma.tradeRecord.findUnique>> = null;
    if (tradeId) {
      dbTrade = await prisma.tradeRecord.findUnique({ where: { id: tradeId, userId } });
      if (!dbTrade) {
        return NextResponse.json({ error: "Trade not found" }, { status: 404 });
      }
    }

    const ticker = (tickerRaw ?? dbTrade?.ticker ?? "").trim().toUpperCase();
    if (!ticker) {
      return NextResponse.json({ error: "ticker is required" }, { status: 400 });
    }

    // ── Cache hit (tradeId only): reuse stored deep_dive unless force ─────────
    if (dbTrade && !force) {
      const verdict = (dbTrade.verdict ?? null) as Record<string, unknown> | null;
      const cached = verdict?.deep_dive as DeepDiveResult | undefined;
      if (cached && cached.ticker) {
        return NextResponse.json({ ...cached, _meta: { cached: true } });
      }
    }

    // ── Fetch grounding (never throws) ───────────────────────────────────────
    const grounding = await fetchDeepDiveData(ticker);

    const prompt = buildPrompt({
      grounding,
      trade: dbTrade
        ? {
            tradeDate: dbTrade.tradeDate?.toISOString() ?? null,
            side: dbTrade.side,
            buyPrice: dbTrade.buyPrice?.toString() ?? null,
            notes: dbTrade.notes,
          }
        : null,
    });

    const out: { providerUsed?: string; modelUsed?: string; note?: string } = {};
    const raw = await callLLM(prompt, SYSTEM_PROMPT, { maxTokens: 6000, provider }, out);

    let result: DeepDiveResult;
    try {
      const cleaned = raw
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
      result = JSON.parse(cleaned) as DeepDiveResult;
    } catch (parseErr) {
      console.error(
        "[/api/analysis/deep-dive] LLM returned invalid JSON for ticker=%s. Error: %s. Raw (first 500): %s",
        ticker,
        parseErr instanceof Error ? parseErr.message : String(parseErr),
        raw.slice(0, 500),
      );
      return NextResponse.json({ error: "AI returned invalid JSON. Please try again." }, { status: 500 });
    }

    // Stamp identity fields server-side so the UI always has them.
    result.ticker = ticker;
    result.generatedAt = new Date().toISOString();

    // ── Cache onto the trade's verdict JSON under deep_dive ──────────────────
    if (dbTrade) {
      const verdict = (dbTrade.verdict ?? {}) as Record<string, unknown>;
      const nextVerdict = { ...verdict, deep_dive: result } as unknown as Prisma.InputJsonValue;
      await prisma.tradeRecord.update({
        where: { id: dbTrade.id },
        data: { verdict: nextVerdict },
      });
    }

    // Successful LLM run → charge quota.
    await incrementScanCount(userId);

    return NextResponse.json({
      ...result,
      _meta: {
        cached: false,
        providerUsed: out.providerUsed,
        modelUsed: out.modelUsed,
        providerNote: out.note,
        grounding: {
          availability: grounding.availability,
          errors: grounding.errors,
        },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
