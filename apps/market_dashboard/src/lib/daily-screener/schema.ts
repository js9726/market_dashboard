import { createHash } from "node:crypto";
import { z } from "zod";

const requiredText = z.string().trim().min(1);
const sourceUrl = z
  .string()
  .trim()
  .url()
  .refine((value) => value.startsWith("https://") || value.startsWith("http://"), {
    message: "Catalyst sources must use HTTP(S)",
  });
const ticker = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9.-]{0,14}$/));

export const finalGoCandidateSchema = z.object({
  ticker,
  decision: z.literal("GO"),
  source: requiredText,
  setup: requiredText,
  score: z.number().min(0).max(100).nullable(),
  entry: requiredText,
  stop: requiredText,
  target: requiredText,
  execution: z
    .object({
      entry: z.number().positive(),
      stop: z.number().positive(),
      target: z.number().positive(),
    })
    .refine((levels) => levels.stop < levels.entry, {
      message: "Execution stop must be below entry",
      path: ["stop"],
    })
    .refine((levels) => levels.target > levels.entry, {
      message: "Execution target must be above entry",
      path: ["target"],
    }),
  trigger: requiredText,
  cancel: requiredText,
  whyGo: requiredText,
  evidence: z.object({
    dailyChart: requiredText,
    weeklyChart: requiredText,
    catalystSources: z.array(sourceUrl).min(1),
    freshnessAsOf: requiredText,
  }),
});

const watchCandidateSchema = z
  .object({
    ticker,
    missing: requiredText,
    levelToWatch: requiredText,
  })
  .passthrough();

const chunkSchema = z.object({
  runDate: requiredText,
  chunkKey: requiredText,
  kind: requiredText,
  ticker: z.string().nullable().optional(),
  grade: z.string().nullable().optional(),
  title: requiredText,
  text: z.string(),
  data: z.unknown().nullable().optional(),
  ordinal: z.number().int().nonnegative(),
  source: requiredText,
  generatedBy: requiredText,
  requiresSaasGeneration: z.boolean(),
  excludedFromSaasRerun: z.boolean(),
});

export const dailyScreenerPayloadSchema = z
  .object({
    schemaVersion: z.literal("tradingview-daily-screener/v2"),
    source: z.literal("tradingview-daily-screener"),
    generatedBy: requiredText,
    requiresSaasGeneration: z.literal(false),
    excludedFromSaasRerun: z.literal(true),
    runDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    generatedAt: z.string().datetime({ offset: true }),
    reportMarkdown: requiredText,
    sections: z.array(
      z.object({
        title: requiredText,
        text: z.string(),
      }),
    ),
    candidates: z.object({
      goList: z.array(finalGoCandidateSchema),
      watchList: z.array(watchCandidateSchema),
      technicals: z.unknown().optional(),
    }),
    evidence: z
      .object({
        runDir: z.string(),
        screenshots: z.array(z.string()),
        screeners: z.array(z.unknown()),
      })
      .passthrough(),
    chunks: z.array(chunkSchema),
  })
  .superRefine((payload, ctx) => {
    const parsedDate = new Date(`${payload.runDate}T00:00:00.000Z`);
    if (
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== payload.runDate
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["runDate"],
        message: "runDate must be a real calendar date",
      });
    }

    const seen = new Set<string>();
    payload.candidates.goList.forEach((candidate, index) => {
      if (seen.has(candidate.ticker)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["candidates", "goList", index, "ticker"],
          message: "GO ticker is duplicated",
        });
      }
      seen.add(candidate.ticker);
    });
  });

export type DailyScreenerPayload = z.infer<typeof dailyScreenerPayloadSchema>;
export type FinalGoCandidate = z.infer<typeof finalGoCandidateSchema>;

export function goListPayloadHash(payload: DailyScreenerPayload): string {
  const canonical = {
    runDate: payload.runDate,
    goList: [...payload.candidates.goList].sort((a, b) =>
      a.ticker.localeCompare(b.ticker),
    ),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function formatTelegramGoList(
  payload: DailyScreenerPayload,
  dashboardUrl?: string,
): string {
  const candidates = payload.candidates.goList;
  const lines = [
    `🚦 <b>Final GO List · ${escapeHtml(payload.runDate)}</b>`,
    `<i>Evidence-backed ${escapeHtml(payload.generatedBy)} run</i>`,
    "",
  ];
  let shown = 0;

  if (candidates.length === 0) {
    lines.push(
      "<b>No GO tickers.</b>",
      "No name cleared every freshness, daily/weekly chart, catalyst, risk, and timing gate.",
    );
  } else {
    for (const candidate of candidates) {
      const block = [
        `<b>$${escapeHtml(candidate.ticker)}</b>${candidate.score == null ? "" : ` · ${candidate.score}/100`}`,
        `${escapeHtml(candidate.setup)} · ${escapeHtml(candidate.source)}`,
        `Entry ${escapeHtml(candidate.entry)} · Stop ${escapeHtml(candidate.stop)} · Target ${escapeHtml(candidate.target)}`,
        `Trigger: ${escapeHtml(candidate.trigger)}`,
        `Cancel: ${escapeHtml(candidate.cancel)}`,
        escapeHtml(candidate.whyGo),
        "",
      ];
      if ([...lines, ...block].join("\n").length > 3800) {
        lines.push(
          `<i>${candidates.length - shown} more GO ticker(s) omitted; open the dashboard for the full list.</i>`,
        );
        break;
      }
      lines.push(...block);
      shown += 1;
    }
  }

  if (dashboardUrl) {
    lines.push("", `<a href="${escapeHtml(dashboardUrl)}">Open Market Dashboard</a>`);
  }
  lines.push("", "Paper execution is separate · live broker untouched");
  return lines.join("\n");
}
