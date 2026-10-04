import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { emptyReport, PROMPT_VERSION, requestSchema, sourceSchema, validateReport, VERSION } from "@/lib/research/schema";

export class ResearchError extends Error {
  constructor(public code: string, public status = 409) { super(code); }
}
const json = (x: unknown) => JSON.parse(JSON.stringify(x)) as Prisma.InputJsonValue;
const LEASE_MS = 120_000;
const active = ["queued", "running"];
const publicSelect = { id: true, threadId: true, ticker: true, provider: true, horizon: true, question: true, asOf: true, status: true, attempt: true, deadlineAt: true, createdAt: true, updatedAt: true, resultJson: true, verdictId: true, errorCode: true } as const;
export const contextSchema = z.object({
  jobId: z.string(), userId: z.string(), threadId: z.string(), ticker: z.string(), provider: z.string(), asOf: z.string(),
  promptVersion: z.literal(PROMPT_VERSION), evidence: z.array(sourceSchema).max(100),
  mandatory: z.array(z.object({ path: z.string(), text: z.string().min(1) }).passthrough()).min(7).max(20),
  supplemental: z.array(z.object({ path: z.string(), text: z.string() }).passthrough()).max(6),
  retrieval: z.object({ mode: z.enum(["lexical", "hybrid"]), status: z.string() }).passthrough(),
}).passthrough();

/** DB transitions are transactional; worker-provided identity never selects an owner. */
export function researchJobs(db: PrismaClient) {
  async function sweep(userId: string, now: Date) {
    await db.researchJob.updateMany({ where: { userId, status: { in: active }, OR: [{ deadlineAt: { lte: now } }, { status: "running", attempt: { gte: 3 }, leaseExpiresAt: { lte: now } }] }, data: { status: "expired", errorCode: "DEADLINE_OR_RETRY_LIMIT" } });
  }
  return {
    async enqueue(userId: string, raw: unknown) {
      const input = requestSchema.parse(raw);
      const inputHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
      const now = new Date();
      await sweep(userId, now);
      return db.$transaction(async tx => {
        const prior = await tx.researchJob.findUnique({ where: { userId_requestKey: { userId, requestKey: input.requestKey } } });
        if (prior) {
          if (prior.inputHash !== inputHash) throw new ResearchError("IDEMPOTENCY_CONFLICT");
          return { id: prior.id, threadId: prior.threadId, status: prior.status };
        }
        const connection = await tx.spreadsheetConnection.findUnique({ where: { userId }, select: { sheetTab: true } });
        const operatorLabel = connection?.sheetTab?.match(/\[([A-Za-z0-9]{2,8})\]/)?.[1]?.toUpperCase();
        if (!operatorLabel) throw new ResearchError("OPERATOR_MAPPING_REQUIRED");
        if (await tx.researchJob.count({ where: { userId, status: { in: active } } }) >= 3) throw new ResearchError("QUEUE_LIMIT", 429);
        let thread = input.threadId ? await tx.researchThread.findFirst({ where: { id: input.threadId, userId, ticker: input.ticker, horizon: input.horizon } }) : null;
        if (input.threadId && !thread) throw new ResearchError("THREAD_NOT_FOUND", 404);
        if (thread && await tx.researchJob.count({ where: { threadId: thread.id, status: { in: active } } })) throw new ResearchError("THREAD_BUSY");
        if (!thread) thread = await tx.researchThread.create({ data: { userId, ticker: input.ticker, horizon: input.horizon, promptVersion: PROMPT_VERSION } });
        return tx.researchJob.create({ data: { userId, threadId: thread.id, requestKey: input.requestKey, inputHash, ticker: input.ticker, provider: input.provider, horizon: input.horizon, question: input.question, operatorLabel, asOf: now, deadlineAt: new Date(now.getTime() + 30 * 60_000), schemaVersion: VERSION, promptVersion: PROMPT_VERSION }, select: { id: true, threadId: true, status: true } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    },
    async list(userId: string) {
      await sweep(userId, new Date());
      return db.researchJob.findMany({ where: { userId }, select: publicSelect, orderBy: { createdAt: "desc" }, take: 20 });
    },
    async get(userId: string, id: string) {
      await sweep(userId, new Date());
      return db.researchJob.findFirst({ where: { id, userId }, select: publicSelect });
    },
    async cancel(userId: string, id: string) {
      const result = await db.researchJob.updateMany({ where: { id, userId, status: { in: active } }, data: { status: "cancelled", errorCode: "CANCELLED_BY_OWNER", leaseExpiresAt: new Date(0) } });
      if (!result.count) throw new ResearchError("JOB_NOT_ACTIVE");
    },
    async claim(userId: string, provider: "claude" | "deepseek") {
      const now = new Date();
      await sweep(userId, now);
      return db.$transaction(async tx => {
        const eligible = { userId, provider, deadlineAt: { gt: now }, attempt: { lt: 3 }, OR: [{ status: "queued" }, { status: "running", leaseExpiresAt: { lte: now } }] };
        const job = await tx.researchJob.findFirst({ where: eligible, orderBy: { createdAt: "asc" } });
        if (!job) return null;
        const leaseToken = randomUUID();
        const changed = await tx.researchJob.updateMany({ where: { ...eligible, id: job.id, attempt: job.attempt }, data: { status: "running", asOf: now, attempt: { increment: 1 }, leaseToken, leaseExpiresAt: new Date(now.getTime() + LEASE_MS), heartbeatAt: now, contextJson: Prisma.DbNull } });
        if (!changed.count) return null;
        const thread = await tx.researchThread.findFirstOrThrow({ where: { id: job.threadId, userId } });
        return { ...job, asOf: now, status: "running", attempt: job.attempt + 1, leaseToken, contextJson: undefined, template: emptyReport({ ...job, asOf: now }), thread: { userId, threadId: thread.id, summary: thread.summary, previousResultId: thread.previousResultId, version: thread.version, sessionId: thread.sessionProvider === provider && thread.promptVersion === PROMPT_VERSION ? thread.sessionId : null } };
      });
    },
    async heartbeat(userId: string, id: string, leaseToken: string) {
      const now = new Date();
      const changed = await db.researchJob.updateMany({ where: { id, userId, status: "running", leaseToken, leaseExpiresAt: { gt: now }, deadlineAt: { gt: now } }, data: { heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) } });
      if (!changed.count) throw new ResearchError("LEASE_LOST");
    },
    async checkpoint(userId: string, id: string, leaseToken: string, raw: unknown) {
      const context = contextSchema.parse(raw);
      const now = new Date();
      const job = await db.researchJob.findFirst({ where: { id, userId, status: "running", leaseToken, leaseExpiresAt: { gt: now }, deadlineAt: { gt: now } } });
      if (!job) throw new ResearchError("LEASE_LOST");
      if (context.jobId !== id || context.userId !== userId || context.threadId !== job.threadId || context.ticker !== job.ticker || context.provider !== job.provider || context.asOf !== job.asOf.toISOString()) throw new ResearchError("CONTEXT_BINDING_MISMATCH", 400);
      const allowed = /^(wiki\/trading\/(concepts|traders|risk|routines)\/|skills\/trade-analyser\/references\/)[a-zA-Z0-9_./-]+\.md$/;
      if ([...context.mandatory, ...context.supplemental].some(s => !allowed.test(s.path) || s.path.split("/").includes(".."))) throw new ResearchError("CONTEXT_SCOPE", 400);
      const changed = await db.researchJob.updateMany({ where: { id, userId, status: "running", leaseToken, leaseExpiresAt: { gt: new Date() }, deadlineAt: { gt: new Date() } }, data: { contextJson: json(context) } });
      if (!changed.count) throw new ResearchError("LEASE_LOST");
    },
    async fail(userId: string, id: string, leaseToken: string) {
      const now = new Date();
      const changed = await db.researchJob.updateMany({ where: { id, userId, status: "running", leaseToken, leaseExpiresAt: { gt: now }, deadlineAt: { gt: now } }, data: { status: "failed", errorCode: "WORKER_FAILED" } });
      if (!changed.count) throw new ResearchError("LEASE_LOST");
    },
    async receipt(userId: string, id: string, leaseToken: string) {
      const job = await db.researchJob.findFirst({ where: { id, userId, leaseToken, status: { in: ["succeeded", "partial"] } } });
      if (!job?.verdictId || !job.resultJson) throw new ResearchError("RECEIPT_UNAVAILABLE");
      const verdict = await db.wikiTradeVerdict.findUnique({ where: { id: job.verdictId } });
      if (verdict?.intent !== "analysis") throw new ResearchError("RECEIPT_UNAVAILABLE");
      return { id, status: job.status, verdictId: job.verdictId, persisted: true, latestVerdict: (verdict.day0Json as Record<string, unknown>)?.researchJobId === id };
    },
    async complete(userId: string, id: string, leaseToken: string, raw: unknown, sessionId?: string) {
      return db.$transaction(async tx => {
        const job = await tx.researchJob.findFirst({ where: { id, userId } });
        if (!job || job.leaseToken !== leaseToken) throw new ResearchError("LEASE_LOST");
        if (["succeeded", "partial"].includes(job.status) && job.verdictId) return { id, status: job.status, verdictId: job.verdictId };
        const now = new Date();
        if (job.status !== "running" || !job.leaseExpiresAt || job.leaseExpiresAt <= now || job.deadlineAt <= now) throw new ResearchError("LEASE_LOST");
        const context = contextSchema.parse(job.contextJson);
        const validated = validateReport(raw, job, context.evidence, now);
        const { report, total, status } = validated;
        const changed = await tx.researchJob.updateMany({ where: { id, userId, status: "running", leaseToken, leaseExpiresAt: { gt: now }, deadlineAt: { gt: now } }, data: { status, resultJson: json({ report, sources: context.evidence.map(({ text: _text, ...source }) => source) }) } });
        if (!changed.count) throw new ResearchError("LEASE_LOST");
        const tradeDate = new Date(job.asOf.toISOString().slice(0, 10) + "T00:00:00Z");
        const key = { operatorLabel: job.operatorLabel, tradeDate, ticker: job.ticker };
        const existing = await tx.wikiTradeVerdict.findUnique({ where: { operatorLabel_tradeDate_ticker: key } });
        const prior = existing?.day0Json as Record<string, unknown> | null;
        if (existing && (existing.intent !== "analysis" || (prior?.userId && prior.userId !== userId))) throw new ResearchError("VERDICT_COLLISION");
        const day0Json = json({ intent: "analysis", userId, ticker: job.ticker, entry_date: job.asOf.toISOString().slice(0, 10), provider: job.provider, setup_classification: "STATEFUL-RESEARCH", composite_technical_score: total, predicted_outcome: report.summary, predicted_stop_price: report.action.stop, predicted_exit_price: report.action.target, verdict_timestamp: now.toISOString(), researchJobId: id, research: report, sources: context.evidence });
        const verdict = existing ? await tx.wikiTradeVerdict.update({ where: { id: existing.id }, data: { day0Json, ingestedAt: now } }) : await tx.wikiTradeVerdict.create({ data: { ...key, intent: "analysis", year: job.asOf.toISOString().slice(0, 4), day0Json } });
        await tx.researchJob.update({ where: { id }, data: { verdictId: verdict.id } });
        await tx.researchThread.update({ where: { id: job.threadId }, data: { summary: report.summary, previousResultId: id, version: { increment: 1 }, sessionId: sessionId ?? null, sessionProvider: job.provider, promptVersion: PROMPT_VERSION } });
        return { id, status, verdictId: verdict.id };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    },
  };
}
