import { z } from "zod";

export const tradingRuleSchema = z.object({
  ruleKey: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  statement: z.string().min(1),
  stage: z.enum(["OBSERVATION", "EXPERIMENT", "CONDITIONAL_PLAYBOOK", "HARD_SAFETY_RULE"]),
  status: z.enum(["PROPOSED", "APPROVED", "EXPERIMENT", "REJECTED", "SUPERSEDED"]),
  evidence: z.array(z.string()).default([]),
  sourceRefs: z.array(z.string()).default([]),
  approvedAt: z.string().datetime().nullable().default(null),
});

export const tradingRulesPayloadSchema = z.object({
  schemaVersion: z.literal("trading-rules/v2"),
  rules: z.array(tradingRuleSchema),
});

export type TradingRuleInput = z.input<typeof tradingRuleSchema>;
