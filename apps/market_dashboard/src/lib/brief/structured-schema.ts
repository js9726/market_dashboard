import { z } from "zod";

const nullableNumber = z.number().nullable();
const nullableString = z.string().nullable();

export const structuredBriefSchema = z.object({
  mood: z
    .object({
      label: nullableString,
      posture: z.enum(["GO", "WAIT", "PASS", "RAISE-THE-BAR"]).nullable(),
      summary: nullableString,
    })
    .nullable(),
  breadth: z
    .object({
      up: z.number().int().nullable(),
      down: z.number().int().nullable(),
    })
    .nullable(),
  fearGreed: z
    .object({
      score: nullableNumber,
      label: nullableString,
    })
    .nullable(),
  indices: z
    .array(
      z.object({
        symbol: z.string(),
        name: nullableString,
        level: nullableNumber,
        changePct: nullableNumber,
        note: nullableString,
        citation: nullableString,
      }),
    )
    .nullable(),
  indicesNarrative: nullableString,
  sectorsThemes: z
    .array(
      z.object({
        symbol: z.string(),
        name: nullableString,
        changePct: nullableNumber,
        rs: nullableNumber,
        note: nullableString,
      }),
    )
    .nullable(),
  sectorsNarrative: nullableString,
  industryNarrative: nullableString,
  industryMovers: z
    .array(
      z.object({
        industry: z.string(),
        sector: nullableString,
        changePct: nullableNumber,
        perf1W: nullableNumber,
        perf1M: nullableNumber,
        breadthPct: nullableNumber,
        deltaWow: nullableNumber,
        leaders: z
          .array(
            z.object({
              ticker: z.string(),
              changePct: nullableNumber,
              rvol: nullableNumber,
              source: nullableString,
            }),
          )
          .nullable(),
        note: nullableString,
      }),
    )
    .nullable(),
  movers: z
    .array(
      z.object({
        ticker: z.string(),
        side: z.enum(["LONG", "SHORT"]).nullable(),
        changePct: nullableNumber,
        why: nullableString,
        traderLens: nullableString,
      }),
    )
    .nullable(),
  watchlist: z
    .array(
      z.object({
        ticker: z.string(),
        level: nullableNumber,
        changePct: nullableNumber,
        abc: z.enum(["A", "B", "C"]).nullable(),
        note: nullableString,
      }),
    )
    .nullable(),
  traderLens: z
    .array(
      z.object({
        name: z.string(),
        view: z.string(),
      }),
    )
    .nullable(),
  standout: z
    .object({
      ticker: nullableString,
      side: z.enum(["LONG", "SHORT"]).nullable(),
      score: nullableNumber,
      sector: nullableString,
      rs: nullableNumber,
      grade: z.enum(["A", "B", "C"]).nullable(),
      thesis: nullableString,
      entry: nullableNumber,
      stop: nullableNumber,
      target: nullableNumber,
      rrr: nullableNumber,
      tags: z.array(z.string()).nullable(),
    })
    .nullable(),
  earnings: z
    .object({
      bmo: z
        .array(z.object({ ticker: z.string(), consensus: nullableString }))
        .nullable()
        .optional(),
      amc: z
        .array(z.object({ ticker: z.string(), consensus: nullableString }))
        .nullable()
        .optional(),
      yesterdayReactions: z
        .array(
          z.object({
            ticker: z.string(),
            result: nullableString,
            movePct: nullableNumber,
          }),
        )
        .nullable()
        .optional(),
    })
    .nullable(),
  calendar: z
    .array(
      z.object({
        time: nullableString,
        name: nullableString,
        consensus: nullableString,
      }),
    )
    .nullable(),
  ratings: z
    .object({
      upgrades: z
        .array(
          z.object({
            ticker: z.string(),
            firm: nullableString,
            rating: nullableString,
            pt: nullableNumber,
          }),
        )
        .nullable()
        .optional(),
      downgrades: z
        .array(
          z.object({
            ticker: z.string(),
            firm: nullableString,
            rating: nullableString,
            pt: nullableNumber,
          }),
        )
        .nullable()
        .optional(),
    })
    .nullable(),
  alert: nullableString,
  citations: z.array(z.string()).nullable(),
});

export type StructuredBriefFromSchema = z.infer<typeof structuredBriefSchema>;
