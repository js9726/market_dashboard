import { auth } from "@/auth";
import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import type { AuditReport, AuditSuggestion, WikiManifest } from "@/lib/wiki/audits";

export const dynamic = "force-dynamic";

interface DriftSuggestionRow extends AuditSuggestion {
  operatorLabel: string;
  period: string;
  /** Extracted from "... (trade: TICKER YYYY-MM-DD)" suffix if present. */
  ticker?: string;
  tradeDate?: string;
}

function extractTradeContext(reason: string): { ticker?: string; date?: string; cleaned: string } {
  // "Predicted stop $575 would have whipsawed ... (trade: SNDK 2026-03-04)"
  const m = reason.match(/^(.*)\s*\(trade:\s*([A-Z0-9.-]{1,16})\s+(\d{4}-\d{2}-\d{2})\)\s*$/);
  if (!m) return { cleaned: reason };
  return { cleaned: m[1].trimEnd(), ticker: m[2], date: m[3] };
}

function aggregateSuggestions(
  audits: Array<{ operatorLabel: string; period: string; parsedJson: unknown }>,
): { rows: DriftSuggestionRow[]; byRubric: Record<string, number> } {
  const rows: DriftSuggestionRow[] = [];
  const byRubric: Record<string, number> = {};
  for (const audit of audits) {
    const report = audit.parsedJson as Partial<AuditReport> | null;
    const suggestions = report?.suggestions ?? [];
    for (const s of suggestions) {
      const ctx = extractTradeContext(s.reason);
      rows.push({
        rubric: s.rubric,
        reason: ctx.cleaned || s.reason,
        operatorLabel: audit.operatorLabel,
        period: audit.period,
        ticker: ctx.ticker,
        tradeDate: ctx.date,
      });
      byRubric[s.rubric] = (byRubric[s.rubric] ?? 0) + 1;
    }
  }
  // Newest period first, then by rubric for deterministic ordering
  rows.sort(
    (a, b) =>
      b.period.localeCompare(a.period) ||
      a.operatorLabel.localeCompare(b.operatorLabel) ||
      a.rubric.localeCompare(b.rubric),
  );
  return { rows, byRubric };
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [audits, trades] = await Promise.all([
      prisma.wikiAudit.findMany({
        orderBy: [{ period: "desc" }, { operatorLabel: "asc" }],
      }),
      prisma.wikiTradeVerdict.findMany({
        orderBy: [{ tradeDate: "desc" }, { operatorLabel: "asc" }, { ticker: "asc" }],
      }),
    ]);

    if (audits.length > 0 || trades.length > 0) {
      const operatorSet = new Set<string>();
      for (const a of audits) operatorSet.add(a.operatorLabel);
      for (const t of trades) operatorSet.add(t.operatorLabel);

      const drift = aggregateSuggestions(audits);

      const manifest: WikiManifest = {
        generated_at: new Date().toISOString(),
        source: "postgres:WikiAudit/WikiTradeVerdict",
        operators: Array.from(operatorSet).sort(),
        audits_count: audits.length,
        trades_count: trades.length,
        audits: audits.map((audit) => ({
          operatorLabel: audit.operatorLabel,
          period: audit.period,
          url: `/api/wiki/audits/${audit.period}?operator=${encodeURIComponent(audit.operatorLabel)}`,
          size_bytes: audit.sizeBytes ?? audit.markdown.length,
        })),
        trades: trades.map((trade) => {
          const date = trade.tradeDate.toISOString().slice(0, 10);
          const op = encodeURIComponent(trade.operatorLabel);
          // Pull pnl_user + intent out of day14 (freshest) falling back to day0.
          // The JSON fields are loose unknown so coerce defensively.
          const d14 = (trade.day14Json ?? {}) as Record<string, unknown>;
          const d0 = (trade.day0Json ?? {}) as Record<string, unknown>;
          const pnlRaw = d14.pnl_user ?? d0.pnl_user ?? null;
          const pnl = typeof pnlRaw === "number" ? pnlRaw : null;
          const intentRaw = (d14.intent ?? d0.intent ?? "journal") as string;
          const intent =
            intentRaw === "analysis" || intentRaw === "screener" ? intentRaw : "journal";
          return {
            operatorLabel: trade.operatorLabel,
            intent,
            date,
            ticker: trade.ticker,
            year: trade.year,
            pnl_user: pnl,
            day0_url: trade.day0Json
              ? `/api/wiki/trades/${date}/${trade.ticker}/day0?operator=${op}`
              : undefined,
            day14_url: trade.day14Json
              ? `/api/wiki/trades/${date}/${trade.ticker}/day14?operator=${op}`
              : undefined,
          };
        }),
        drift_suggestions: drift.rows,
        drift_by_rubric: drift.byRubric,
      };
      return NextResponse.json(manifest);
    }
  } catch {
    // Local dev fallback below. Production should have the Prisma tables.
  }

  const manifestPath = path.join(process.cwd(), "public", "wiki", "index.json");
  try {
    const raw = await fs.readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(raw) as WikiManifest;
    return NextResponse.json(manifest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json(
        {
          error: "Wiki audits missing. Run `npm run sync:wiki -- --post` to ingest them.",
          operators: [],
          audits: [],
          trades: [],
          audits_count: 0,
          trades_count: 0,
        },
        { status: 503 },
      );
    }
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: `Manifest read failed: ${msg}` }, { status: 500 });
  }
}
