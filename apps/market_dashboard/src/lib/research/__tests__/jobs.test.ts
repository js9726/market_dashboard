import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { researchJobs } from "@/server/research-jobs";
import { emptyReport, PROMPT_VERSION } from "../schema";

const now = new Date("2026-10-04T10:00:00.000Z");
const context = { jobId: "job", userId: "owner", threadId: "thread", ticker: "NTAP", provider: "claude", asOf: now.toISOString(), promptVersion: PROMPT_VERSION, evidence: [], mandatory: Array.from({ length: 7 }, (_, i) => ({ path: `wiki/trading/concepts/rule${i}.md`, text: "Rule" })), supplemental: [], retrieval: { mode: "lexical", status: "current" } };
const row = () => ({ id: "job", userId: "owner", threadId: "thread", ticker: "NTAP", provider: "claude", asOf: now, status: "running", attempt: 1, leaseToken: "token", leaseExpiresAt: new Date(now.getTime() + 60_000), deadlineAt: new Date(now.getTime() + 600_000), contextJson: context, operatorLabel: "JS", verdictId: null });
function fixture() {
  const db = {
    researchJob: { findFirst: vi.fn().mockResolvedValue(row()), findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), create: vi.fn().mockResolvedValue({ id: "job" }), updateMany: vi.fn().mockResolvedValue({ count: 1 }), update: vi.fn().mockResolvedValue({}) },
    researchThread: { findFirst: vi.fn().mockResolvedValue(null), findFirstOrThrow: vi.fn().mockResolvedValue({ id: "thread", summary: "Prior research", promptVersion: PROMPT_VERSION, sessionProvider: "deepseek", sessionId: "private-session" }), create: vi.fn().mockResolvedValue({ id: "thread" }), update: vi.fn().mockResolvedValue({}) },
    spreadsheetConnection: { findUnique: vi.fn().mockResolvedValue({ sheetTab: "Trades [JS]" }) },
    wikiTradeVerdict: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "verdict" }), update: vi.fn().mockResolvedValue({ id: "verdict" }) },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(async fn => fn(db));
  return { db, service: researchJobs(db as unknown as PrismaClient) };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
describe("leased research jobs (mocked database)", () => {
  it("keeps owner scoping in reads and cancellation", async () => {
    const { db, service } = fixture();
    await service.get("other", "job"); await service.cancel("other", "job");
    expect(db.researchJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "job", userId: "other" } }));
    expect(db.researchJob.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: "other", status: { in: ["queued", "running"] } }) }));
  });
  it("requires explicit operator mapping before creating a job", async () => {
    const { db, service } = fixture(); db.spreadsheetConnection.findUnique.mockResolvedValue(null);
    await expect(service.enqueue("owner", { ticker: "NTAP", provider: "claude", question: "Review", requestKey: "00000000-0000-4000-8000-000000000001" })).rejects.toThrow("OPERATOR_MAPPING_REQUIRED");
    expect(db.researchJob.create).not.toHaveBeenCalled();
  });
  it("rejects reuse of a request key with different input", async () => {
    const { db, service } = fixture(); db.researchJob.findUnique.mockResolvedValue({ inputHash: "different" });
    await expect(service.enqueue("owner", { ticker: "NTAP", provider: "claude", question: "Review", requestKey: "00000000-0000-4000-8000-000000000001" })).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });
  it("rejects another user's thread without creating one", async () => {
    const { db, service } = fixture();
    await expect(service.enqueue("owner", { ticker: "NTAP", provider: "claude", question: "Review", threadId: "cm000000000000000000000001", requestKey: "00000000-0000-4000-8000-000000000001" })).rejects.toThrow("THREAD_NOT_FOUND");
    expect(db.researchThread.create).not.toHaveBeenCalled();
  });
  it("claims with compare-and-swap and never resumes a different provider session", async () => {
    const { db, service } = fixture();
    const job = await service.claim("owner", "claude");
    expect(job?.thread.sessionId).toBeNull();
    expect(db.researchJob.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "job", userId: "owner", provider: "claude", attempt: 1 }), data: expect.objectContaining({ attempt: { increment: 1 }, status: "running" }) }));
    db.researchJob.updateMany.mockResolvedValue({ count: 0 });
    expect(await service.claim("owner", "claude")).toBeNull();
  });
  it("refuses a lost heartbeat lease", async () => {
    const { db, service } = fixture(); db.researchJob.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.heartbeat("owner", "job", "old")).rejects.toThrow("LEASE_LOST");
    expect(db.researchJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ leaseToken: "old", leaseExpiresAt: { gt: now }, deadlineAt: { gt: now } }) }));
  });
  it("rejects cross-thread checkpoint context", async () => {
    const { db, service } = fixture();
    await expect(service.checkpoint("owner", "job", "token", { ...context, threadId: "foreign" })).rejects.toThrow("CONTEXT_BINDING_MISMATCH");
    expect(db.researchJob.updateMany).not.toHaveBeenCalled();
  });
  it("rejects stale/replaced/cancelled completion leases", async () => {
    for (const patch of [{ leaseToken: "new-token" }, { leaseExpiresAt: now }, { status: "cancelled" }, { deadlineAt: now }]) {
      const { db, service } = fixture(); db.researchJob.findFirst.mockResolvedValue({ ...row(), ...patch });
      await expect(service.complete("owner", "job", "token", emptyReport(row()))).rejects.toThrow("LEASE_LOST");
      expect(db.wikiTradeVerdict.create).not.toHaveBeenCalled();
    }
  });
  it("stores analysis, thread memory and a final receipt in one transaction", async () => {
    const { db, service } = fixture();
    expect(await service.complete("owner", "job", "token", emptyReport(row()))).toEqual({ id: "job", status: "partial", verdictId: "verdict" });
    expect(db.wikiTradeVerdict.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ intent: "analysis", operatorLabel: "JS", day0Json: expect.objectContaining({ userId: "owner", researchJobId: "job" }) }) }));
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(db.researchThread.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ previousResultId: "job", version: { increment: 1 } }) }));
  });
  it("does not overwrite a journal verdict or another user's analysis", async () => {
    for (const existing of [{ id: "existing", intent: "journal" }, { id: "existing", intent: "analysis", day0Json: { userId: "other" } }]) {
      const { db, service } = fixture(); db.wikiTradeVerdict.findUnique.mockResolvedValue(existing);
      await expect(service.complete("owner", "job", "token", emptyReport(row()))).rejects.toThrow("VERDICT_COLLISION");
      expect(db.wikiTradeVerdict.update).not.toHaveBeenCalled();
      expect(db.researchThread.update).not.toHaveBeenCalled();
    }
  });
  it("replays a successful completion without creating another verdict", async () => {
    const { db, service } = fixture(); db.researchJob.findFirst.mockResolvedValue({ ...row(), status: "partial", verdictId: "saved" });
    expect(await service.complete("owner", "job", "token", emptyReport(row()))).toMatchObject({ verdictId: "saved" });
    expect(db.wikiTradeVerdict.create).not.toHaveBeenCalled();
  });
  it("does not claim a read-back receipt when persistence is absent", async () => {
    const { service } = fixture();
    await expect(service.receipt("owner", "job", "token")).rejects.toThrow("RECEIPT_UNAVAILABLE");
  });
});
