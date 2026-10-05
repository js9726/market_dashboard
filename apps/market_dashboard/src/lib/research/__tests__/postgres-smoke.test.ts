/** Opt-in, real PostgreSQL smoke. Never loads DATABASE_URL or applies migrations. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { researchJobs } from "@/server/research-jobs";
import { emptyReport, PROMPT_VERSION } from "../schema";

const injected = vi.hoisted(() => ({ db: null as PrismaClient | null }));
vi.mock("@/lib/prisma", () => ({ get prisma() { return injected.db; } }));

const databaseUrl = process.env.RESEARCH_SMOKE_DATABASE_URL;
if (databaseUrl) {
  const parsed = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    || !/^\/research_smoke[a-zA-Z0-9_]*$/.test(parsed.pathname)
    || Array.from(parsed.searchParams.keys()).some(key => !["schema", "connection_limit", "pool_timeout", "sslmode"].includes(key))
    || (parsed.searchParams.has("schema") && parsed.searchParams.get("schema") !== "public")) {
    throw new Error("Smoke database must be loopback PostgreSQL with a research_smoke* database and public schema");
  }
}

describe.skipIf(!databaseUrl)("research worker real PostgreSQL smoke", () => {
  let db: PrismaClient;
  let jobs: ReturnType<typeof researchJobs>;
  let owner: string;
  let operator: string;
  let server: Server | undefined;
  const repoRoot = path.resolve(process.cwd(), "../..");

  beforeAll(async () => {
    db = new PrismaClient({ datasourceUrl: databaseUrl! });
    injected.db = db;
    await db.$connect();
    const rows = await db.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
    expect(rows[0].current_database).toMatch(/^research_smoke[a-zA-Z0-9_]*$/);
    jobs = researchJobs(db);
  });
  beforeEach(async () => {
    operator = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
    const user = await db.user.create({ data: { email: `research-smoke-${randomUUID()}@example.invalid`, role: "owner" } });
    owner = user.id;
    await db.spreadsheetConnection.create({ data: { userId: owner, spreadsheetId: "smoke-no-external-sheet", sheetTab: `Smoke [${operator}]` } });
  });
  afterEach(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
      server = undefined;
    }
    vi.unstubAllEnvs();
    if (owner) {
      await db.wikiTradeVerdict.deleteMany({ where: { operatorLabel: operator } });
      await db.user.delete({ where: { id: owner } });
    }
  });
  afterAll(async () => { if (db) await db.$disconnect(); injected.db = null; });

  function input(overrides: Record<string, unknown> = {}) {
    return { ticker: "NTAP", provider: "claude", question: "Smoke: evaluate only supplied evidence and disclose every missing section.", horizon: "swing", requestKey: randomUUID(), ...overrides };
  }
  // The HTTP contract exposes these two conflicts as CONCURRENT_UPDATE_RETRY.
  // Model bounded client retries while keeping semantic errors non-retryable.
  async function enqueueWithRetry(request: ReturnType<typeof input>) {
    for (let attempt = 0; ; attempt++) {
      try { return await jobs.enqueue(owner, request); }
      catch (error) {
        const code = (error as { code?: string }).code;
        if (attempt >= 7 || !["P2034", "P2002"].includes(code ?? "")) throw error;
        await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
      }
    }
  }
  async function claim() {
    const job = await jobs.claim(owner, "claude");
    expect(job).not.toBeNull();
    return job!;
  }
  type Claimed = NonNullable<Awaited<ReturnType<typeof jobs.claim>>>;
  async function checkpoint(job: Claimed) {
    await jobs.checkpoint(owner, job.id, job.leaseToken, {
      jobId: job.id, userId: owner, threadId: job.threadId, ticker: job.ticker,
      provider: job.provider, asOf: job.asOf.toISOString(), promptVersion: PROMPT_VERSION,
      evidence: [], mandatory: Array.from({ length: 7 }, (_, i) => ({ path: `wiki/trading/concepts/smoke-rule-${i}.md`, text: "Smoke fixture doctrine" })),
      supplemental: [], retrieval: { mode: "lexical", status: "current" },
    });
  }
  async function finish(job: Claimed, summary = "Smoke: evidence unavailable", sessionId?: string) {
    await checkpoint(job);
    return jobs.complete(owner, job.id, job.leaseToken, { ...emptyReport(job), summary }, sessionId);
  }

  it("allows exactly one of concurrent claims to own a job", async () => {
    const queued = await jobs.enqueue(owner, input());
    const claims = await Promise.all(Array.from({ length: 6 }, () => jobs.claim(owner, "claude")));
    const winners = claims.filter(Boolean);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.id).toBe(queued.id);
    expect((await db.researchJob.findUniqueOrThrow({ where: { id: queued.id } })).attempt).toBe(1);
  });

  it("rolls back result and memory updates when an existing journal would collide", async () => {
    await jobs.enqueue(owner, input());
    const job = await claim();
    const journal = await db.wikiTradeVerdict.create({ data: {
      operatorLabel: operator, ticker: job.ticker, tradeDate: new Date(job.asOf.toISOString().slice(0, 10)),
      year: String(job.asOf.getUTCFullYear()), intent: "journal", day0Json: { protected: "journal evidence" },
    } });
    await checkpoint(job);
    await expect(jobs.complete(owner, job.id, job.leaseToken, emptyReport(job))).rejects.toThrow("VERDICT_COLLISION");
    const unchanged = await db.researchJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(unchanged.status).toBe("running");
    expect(unchanged.resultJson).toBeNull();
    expect(unchanged.verdictId).toBeNull();
    expect((await db.researchThread.findUniqueOrThrow({ where: { id: job.threadId } })).version).toBe(0);
    expect((await db.wikiTradeVerdict.findUniqueOrThrow({ where: { id: journal.id } })).day0Json).toEqual({ protected: "journal evidence" });
  });

  it("reclaims an expired lease and rejects the old worker", async () => {
    await jobs.enqueue(owner, input());
    const first = await claim();
    await db.researchJob.update({ where: { id: first.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
    const replacement = await claim();
    expect(replacement.id).toBe(first.id);
    expect(replacement.attempt).toBe(2);
    expect(replacement.leaseToken).not.toBe(first.leaseToken);
    await expect(jobs.heartbeat(owner, first.id, first.leaseToken)).rejects.toThrow("LEASE_LOST");
    await expect(jobs.complete(owner, first.id, first.leaseToken, emptyReport(first))).rejects.toThrow("LEASE_LOST");
    expect((await finish(replacement)).status).toBe("partial");
  });

  it("cancels a running job without accepting subsequent heartbeat or completion", async () => {
    await jobs.enqueue(owner, input());
    const job = await claim();
    await checkpoint(job);
    await jobs.cancel(owner, job.id);
    await expect(jobs.heartbeat(owner, job.id, job.leaseToken)).rejects.toThrow("LEASE_LOST");
    await expect(jobs.complete(owner, job.id, job.leaseToken, emptyReport(job))).rejects.toThrow("LEASE_LOST");
    expect((await jobs.get(owner, job.id))?.status).toBe("cancelled");
    expect(await db.wikiTradeVerdict.count({ where: { operatorLabel: operator } })).toBe(0);
  });

  it("completes idempotently and restores exact thread summary/session on follow-up", async () => {
    await jobs.enqueue(owner, input());
    const first = await claim();
    const sessionId = randomUUID();
    const receipt = await finish(first, "First accepted summary", sessionId);
    expect(await jobs.complete(owner, first.id, first.leaseToken, emptyReport(first), sessionId)).toEqual(receipt);
    expect((await db.researchThread.findUniqueOrThrow({ where: { id: first.threadId } })).version).toBe(1);
    await jobs.enqueue(owner, input({ threadId: first.threadId, question: "Continue the same research" }));
    const followup = await claim();
    expect(followup.thread).toMatchObject({ summary: "First accepted summary", previousResultId: first.id, sessionId, version: 1 });
    expect(await db.wikiTradeVerdict.count({ where: { operatorLabel: operator } })).toBe(1);
  });

  it("keeps old job receipts readable after a same-day analysis replacement", async () => {
    await jobs.enqueue(owner, input());
    const first = await claim();
    const firstReceipt = await finish(first, "First immutable job report");
    await jobs.enqueue(owner, input({ threadId: first.threadId }));
    const second = await claim();
    const secondReceipt = await finish(second, "Latest same-day report");
    expect(secondReceipt.verdictId).toBe(firstReceipt.verdictId);
    expect(await jobs.receipt(owner, first.id, first.leaseToken)).toMatchObject({ persisted: true, latestVerdict: false });
    expect(await jobs.receipt(owner, second.id, second.leaseToken)).toMatchObject({ persisted: true, latestVerdict: true });
    expect((await jobs.get(owner, first.id))?.resultJson).toMatchObject({ report: { summary: "First immutable job report" } });
  });

  it("enforces the three-job cap under concurrent enqueue", async () => {
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => enqueueWithRetry(input({ ticker: `T${i}` }))));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(3);
    const failures = results.filter(result => result.status === "rejected") as PromiseRejectedResult[];
    expect(failures.every(result => result.reason.message === "QUEUE_LIMIT")).toBe(true);
    expect(await db.researchJob.count({ where: { userId: owner } })).toBe(3);
    expect(await db.researchThread.count({ where: { userId: owner } })).toBe(3);
  });

  it("returns one stable job for concurrent identical idempotency keys", async () => {
    const request = input();
    const results = await Promise.all(Array.from({ length: 6 }, () => enqueueWithRetry(request)));
    expect(new Set(results.map(result => result.id)).size).toBe(1);
    expect(await db.researchJob.count({ where: { userId: owner } })).toBe(1);
    expect(await db.researchThread.count({ where: { userId: owner } })).toBe(1);
    await expect(jobs.enqueue(owner, { ...request, question: "Changed input" })).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });

  it("preserves both thread reports when separate threads complete the same verdict key concurrently", async () => {
    await jobs.enqueue(owner, input());
    await jobs.enqueue(owner, input());
    const first = await claim();
    const second = await claim();
    expect(first.threadId).not.toBe(second.threadId);
    await Promise.all([checkpoint(first), checkpoint(second)]);
    async function completeWithRetry(job: Claimed, summary: string) {
      for (let attempt = 0; ; attempt++) {
        try { return await jobs.complete(owner, job.id, job.leaseToken, { ...emptyReport(job), summary }); }
        catch (error) {
          if (attempt >= 7 || !["P2034", "P2002"].includes((error as { code?: string }).code ?? "")) throw error;
          await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
        }
      }
    }
    const receipts = await Promise.all([
      completeWithRetry(first, "Immutable first thread report"),
      completeWithRetry(second, "Immutable second thread report"),
    ]);
    expect(receipts[0].verdictId).toBe(receipts[1].verdictId);
    const readbacks = await Promise.all([first, second].map(job => jobs.receipt(owner, job.id, job.leaseToken)));
    expect(readbacks.every(receipt => receipt.persisted)).toBe(true);
    expect(readbacks.filter(receipt => receipt.latestVerdict)).toHaveLength(1);
    expect((await jobs.get(owner, first.id))?.resultJson).toMatchObject({ report: { summary: "Immutable first thread report" } });
    expect((await jobs.get(owner, second.id))?.resultJson).toMatchObject({ report: { summary: "Immutable second thread report" } });
    const threads = await db.researchThread.findMany({ where: { userId: owner } });
    expect(threads).toHaveLength(2);
    expect(threads.every(thread => thread.version === 1)).toBe(true);
    expect(await db.wikiTradeVerdict.count({ where: { operatorLabel: operator } })).toBe(1);
  });

  it("keeps cancellation versus completion races transactionally consistent", async () => {
    await jobs.enqueue(owner, input());
    const job = await claim();
    await checkpoint(job);
    const outcomes = await Promise.allSettled([
      jobs.cancel(owner, job.id), jobs.complete(owner, job.id, job.leaseToken, emptyReport(job)),
    ]);
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    const row = await db.researchJob.findUniqueOrThrow({ where: { id: job.id } });
    const thread = await db.researchThread.findUniqueOrThrow({ where: { id: job.threadId } });
    const verdictCount = await db.wikiTradeVerdict.count({ where: { operatorLabel: operator } });
    expect(["cancelled", "partial"]).toContain(row.status);
    if (row.status === "cancelled") {
      expect(row.resultJson).toBeNull();
      expect(row.verdictId).toBeNull();
      expect(thread.version).toBe(0);
      expect(verdictCount).toBe(0);
      await expect(jobs.receipt(owner, job.id, job.leaseToken)).rejects.toThrow("RECEIPT_UNAVAILABLE");
    } else {
      expect(row.resultJson).not.toBeNull();
      expect(row.verdictId).not.toBeNull();
      expect(thread.version).toBe(1);
      expect(verdictCount).toBe(1);
      expect(await jobs.receipt(owner, job.id, job.leaseToken)).toMatchObject({ persisted: true });
    }
  });

  it("expires a third exhausted attempt and queued jobs past their deadline", async () => {
    await jobs.enqueue(owner, input());
    const job = await claim();
    await db.researchJob.update({ where: { id: job.id }, data: { attempt: 3, leaseExpiresAt: new Date(Date.now() - 1000) } });
    expect(await jobs.claim(owner, "claude")).toBeNull();
    expect((await jobs.get(owner, job.id))?.status).toBe("expired");
    await expect(jobs.heartbeat(owner, job.id, job.leaseToken)).rejects.toThrow("LEASE_LOST");
    await expect(jobs.complete(owner, job.id, job.leaseToken, emptyReport(job))).rejects.toThrow("LEASE_LOST");
    const queued = await jobs.enqueue(owner, input());
    await db.researchJob.update({ where: { id: queued.id }, data: { deadlineAt: new Date(Date.now() - 1000) } });
    expect(await jobs.claim(owner, "claude")).toBeNull();
    expect((await jobs.get(owner, queued.id))?.status).toBe("expired");
    expect((await db.researchJob.findUniqueOrThrow({ where: { id: queued.id } })).attempt).toBe(0);
    expect(await db.wikiTradeVerdict.count({ where: { operatorLabel: operator } })).toBe(0);
  });

  it("blocks a foreign owner from thread reuse, job reads, cancellation and completion", async () => {
    const foreign = await db.user.create({ data: { email: `research-smoke-${randomUUID()}@example.invalid`, role: "owner" } });
    try {
      await db.spreadsheetConnection.create({ data: { userId: foreign.id, spreadsheetId: "smoke", sheetTab: "Smoke [OTHER]" } });
      const queued = await jobs.enqueue(owner, input());
      const job = await claim();
      await checkpoint(job);
      expect(await jobs.get(foreign.id, queued.id)).toBeNull();
      expect(await jobs.list(foreign.id)).toEqual([]);
      await expect(jobs.cancel(foreign.id, queued.id)).rejects.toThrow("JOB_NOT_ACTIVE");
      await expect(jobs.enqueue(foreign.id, input({ threadId: queued.threadId }))).rejects.toThrow("THREAD_NOT_FOUND");
      await expect(jobs.complete(foreign.id, job.id, job.leaseToken, emptyReport(job))).rejects.toThrow("LEASE_LOST");
      expect((await jobs.get(owner, job.id))?.status).toBe("running");
      expect(await db.researchJob.count({ where: { userId: foreign.id } })).toBe(0);
    } finally { await db.user.delete({ where: { id: foreign.id } }); }
  });

  it("enforces HTTP authorization, enablement, owner role and malformed body gates", async () => {
    const token = randomUUID() + randomUUID();
    vi.stubEnv("RESEARCH_WORKER_TOKEN", token);
    vi.stubEnv("RESEARCH_ENABLED", "true");
    vi.stubEnv("RESEARCH_WORKER_USER_ID", owner);
    const { POST } = await import("@/app/api/research/worker/route");
    const request = (body: string, authenticated = true) => new Request("http://127.0.0.1/api/research/worker", {
      method: "POST", headers: { "Content-Type": "application/json", ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) }, body,
    });
    const body = JSON.stringify({ operation: "claim", provider: "claude" });
    expect((await POST(request(body, false))).status).toBe(401);
    vi.stubEnv("RESEARCH_ENABLED", "false");
    expect((await POST(request(body))).status).toBe(503);
    vi.stubEnv("RESEARCH_ENABLED", "true");
    await db.user.update({ where: { id: owner }, data: { role: "member" } });
    expect((await POST(request(body))).status).toBe(403);
    await db.user.update({ where: { id: owner }, data: { role: "owner" } });
    const malformed = await POST(request("{"));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "INVALID_JSON" });
    const wrongShape = await POST(request(JSON.stringify({ operation: "claim", provider: "claude", userId: owner })));
    expect(wrongShape.status).toBe(400);
    expect((await wrongShape.json()).error).toBe("INVALID_RESEARCH_PAYLOAD");
    expect(await db.researchJob.count({ where: { userId: owner } })).toBe(0);
  });

  async function bridge(provider: "fixture" | "claude") {
    const diagnostics: Array<{ operation: string; status: number; error?: string; fields?: string[] }> = [];
    const token = randomUUID() + randomUUID();
    vi.stubEnv("RESEARCH_ENABLED", "true");
    vi.stubEnv("RESEARCH_WORKER_TOKEN", token);
    vi.stubEnv("RESEARCH_WORKER_USER_ID", owner);
    const { POST } = await import("@/app/api/research/worker/route");
    server = createServer(async (request, response) => {
      try {
        if (request.url !== "/api/research/worker" || request.method !== "POST") {
          response.writeHead(404).end(); return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of request) {
          size += Buffer.byteLength(chunk);
          if (size > 1_500_000) { response.writeHead(413).end(); return; }
          chunks.push(Buffer.from(chunk));
        }
        const headers = new Headers();
        for (const [key, value] of Object.entries(request.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(",") : value);
        const result = await POST(new Request("http://127.0.0.1/api/research/worker", { method: "POST", headers, body: Buffer.concat(chunks) }));
        if (result.status >= 400) {
          const failure = await result.clone().json().catch(() => ({}));
          let operation = "unknown";
          try {
            const supplied = JSON.parse(Buffer.concat(chunks).toString()).operation;
            if (["claim", "heartbeat", "checkpoint", "complete", "receipt", "fail"].includes(supplied)) operation = supplied;
          } catch { /* Only allowlisted metadata is exposed. */ }
          diagnostics.push({ operation, status: result.status,
            error: typeof failure.error === "string" && /^[A-Za-z0-9_]{1,80}$/.test(failure.error) ? failure.error : undefined,
            fields: Array.isArray(failure.fields) ? failure.fields.filter((field: unknown) => typeof field === "string" && /^[A-Za-z0-9_.]{1,160}$/.test(field)).slice(0, 30) : undefined,
          });
          if (diagnostics.length > 5) diagnostics.shift();
        }
        response.writeHead(result.status, Object.fromEntries(result.headers.entries()));
        response.end(Buffer.from(await result.arrayBuffer()));
      } catch { response.writeHead(500).end('{"error":"SMOKE_BRIDGE_FAILED"}'); }
    });
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Smoke bridge did not bind");
    const wikiRoot = process.env.RESEARCH_SMOKE_WIKI_ROOT ?? path.resolve(repoRoot, "../jie_wiki");
    const python = process.env.RESEARCH_SMOKE_PYTHON ?? path.join(wikiRoot, "scripts/retrieval/.venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const child = spawn(python, ["-B", path.join(repoRoot, "packages/research-worker/tests/smoke_http.py"), "--provider", provider], {
        cwd: repoRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, DASHBOARD_URL: `http://127.0.0.1:${address.port}`, RESEARCH_WORKER_TOKEN: token, JIE_WIKI_ROOT: wikiRoot },
      });
      let output = "";
      const timer = setTimeout(() => { child.kill(); reject(new Error("Smoke Python process timed out")); }, provider === "claude" ? 660_000 : 60_000);
      child.stdout.on("data", chunk => { output += chunk.toString(); if (output.length > 100_000) child.kill(); });
      // Provider bodies, credentials and diagnostics are never echoed by this test.
      child.stderr.resume();
      child.on("error", () => { clearTimeout(timer); reject(new Error("Smoke Python process failed to start")); });
      child.on("close", code => {
        clearTimeout(timer);
        if (code !== 0) {
          let failureCode = "UNKNOWN";
          try {
            const error = JSON.parse(output).error;
            if (typeof error === "string" && /^[A-Za-z0-9_]{1,80}$/.test(error)) failureCode = error;
          } catch { /* Never echo unparsed provider output. */ }
          reject(new Error(`Smoke Python exited ${code}: ${failureCode}; HTTP metadata ${JSON.stringify(diagnostics)}`)); return;
        }
        try { resolve(JSON.parse(output)); } catch { reject(new Error("Smoke helper did not return a JSON receipt")); }
      });
    });
  }

  it("persists and reads back a real Python worker through the actual HTTP handler", async () => {
    const queued = await jobs.enqueue(owner, input());
    const receipt = await bridge("fixture");
    expect(receipt).toMatchObject({ id: queued.id, status: "partial", persisted: true });
    const row = await db.researchJob.findUniqueOrThrow({ where: { id: queued.id } });
    expect(row.contextJson).toMatchObject({ retrieval: { mode: "lexical", status: "current" } });
    expect(row.resultJson).not.toBeNull();
    expect(row.verdictId).toBe(receipt.verdictId);
  }, 90_000);

  it.skipIf(process.env.RESEARCH_SMOKE_CLAUDE !== "1")("runs two explicitly opted-in Claude subscription turns with exact session restoration", async () => {
    const queued = await jobs.enqueue(owner, input());
    const receipt = await bridge("claude");
    expect(receipt).toMatchObject({ id: queued.id, status: "partial", persisted: true });
    const thread = await db.researchThread.findFirstOrThrow({ where: { userId: owner } });
    expect(thread.sessionId).toMatch(/^[a-f0-9-]{36}$/i);
    expect(thread.previousResultId).toBe(queued.id);
    server!.closeAllConnections();
    await new Promise<void>(resolve => server!.close(() => resolve()));
    server = undefined;
    const next = await jobs.enqueue(owner, input({ threadId: thread.id, question: "Continue using saved context; explicitly keep unavailable facts unavailable." }));
    expect(await bridge("claude")).toMatchObject({ id: next.id, status: "partial", persisted: true });
    const restored = await db.researchThread.findUniqueOrThrow({ where: { id: thread.id } });
    expect(restored.sessionId).toBe(thread.sessionId);
    expect(restored.previousResultId).toBe(next.id);
    expect(restored.version).toBe(2);
  }, 1_400_000);
});
