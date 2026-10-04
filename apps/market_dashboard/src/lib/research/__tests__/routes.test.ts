import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), user: vi.fn(), enqueue: vi.fn(), get: vi.fn(), claim: vi.fn(), complete: vi.fn(), list: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.user } } }));
vi.mock("@/server/research-jobs", async original => {
  const real = await original<typeof import("@/server/research-jobs")>();
  return { ...real, researchJobs: () => mocks };
});
import { POST as submit } from "@/app/api/research/jobs/route";
import { GET as getJob } from "@/app/api/research/jobs/[id]/route";
import { POST as worker } from "@/app/api/research/worker/route";
const token = "test-worker-secret-with-more-than-32-chars";
const request = (body: unknown, auth?: string) => new Request("http://localhost/api/research/worker", { method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("RESEARCH_ENABLED", "true"); vi.stubEnv("RESEARCH_WORKER_TOKEN", token); vi.stubEnv("RESEARCH_WORKER_USER_ID", "configured-owner");
  mocks.auth.mockResolvedValue({ user: { id: "configured-owner" } }); mocks.user.mockResolvedValue({ role: "owner" });
  mocks.enqueue.mockResolvedValue({ id: "job", status: "queued" }); mocks.get.mockResolvedValue(null); mocks.claim.mockResolvedValue(null);
});
describe("owner-only research routes", () => {
  it("returns JSON401 without a session and rejects pending/member roles", async () => {
    mocks.auth.mockResolvedValue(null); expect((await submit(request({}))).status).toBe(401);
    mocks.auth.mockResolvedValue({ user: { id: "member" } }); mocks.user.mockResolvedValue({ role: "allowed" });
    expect((await submit(request({}))).status).toBe(403); expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("is disabled unless explicitly enabled", async () => {
    vi.stubEnv("RESEARCH_ENABLED", "false"); expect((await submit(request({}))).status).toBe(503);
    expect((await worker(request({ operation: "claim", provider: "claude" }, token))).status).toBe(503);
  });
  it("binds reads to the session user and returns404 for absent/foreign jobs", async () => {
    expect((await getJob(request({}), { params: Promise.resolve({ id: "foreign" }) })).status).toBe(404);
    expect(mocks.get).toHaveBeenCalledWith("configured-owner", "foreign");
  });
  it("rejects missing/wrong worker tokens before accessing the database", async () => {
    expect((await worker(request({ operation: "claim", provider: "claude" }))).status).toBe(401);
    expect((await worker(request({ operation: "claim", provider: "claude" }, "wrong"))).status).toBe(401);
    expect(mocks.user).not.toHaveBeenCalled();
  });
  it("binds worker claims to configured owner, not request identity", async () => {
    expect((await worker(request({ operation: "claim", provider: "claude", userId: "other" }, token))).status).toBe(400);
    expect((await worker(request({ operation: "claim", provider: "claude" }, token))).status).toBe(200);
    expect(mocks.claim).toHaveBeenCalledWith("configured-owner", "claude");
  });
  it("rejects a revoked worker owner", async () => {
    mocks.user.mockResolvedValue({ role: "denied" });
    expect((await worker(request({ operation: "claim", provider: "claude" }, token))).status).toBe(403);
    expect(mocks.claim).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON without leaking error details", async () => {
    const r = new Request("http://localhost", { method: "POST", body: "{" });
    const response = await submit(r);
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "INVALID_JSON" });
  });
});
