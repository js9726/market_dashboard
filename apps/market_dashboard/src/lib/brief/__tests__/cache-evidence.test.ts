import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StructuredBrief } from "@/types/structured-brief";

const mocks = vi.hoisted(() => ({ upsert: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { morningBriefCache: mocks } }));
vi.mock("@/lib/brief/snapshot", () => ({ composeSnapshot: vi.fn(), hashSnapshot: vi.fn() }));
vi.mock("@/server/brief-providers", () => ({ runProvider: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/fear-greed", () => ({ fetchFearGreed: vi.fn(), overlayFearGreed: (value: unknown) => value }));
import { ingestRow } from "@/server/brief-cache";
import { GET } from "@/app/api/morning-verdict/route";
import { selectFreshestBriefWithContent } from "../provider-selection";

const now = new Date("2026-10-05T14:50:00Z");
function payload(observedAt: string) {
  return { movers: [{ ticker: "VKTX", changePct: 35.67, why: "Old catalyst", traderLens: "Buy now" }],
    marketEvidence: { version: 1, status: "verified", symbols: { VKTX: {
      observedAt, source: "test", kind: "quote", price: 29, changePct: -2.34, rvol: null,
    } } } } as unknown as StructuredBrief;
}
function row(provider: string, structuredJson: unknown, errorMsg: string | null = null) {
  return { provider, structuredJson, verdictJson: structuredJson, generatedAt: now, errorMsg,
    htmlBody: "", generatedBy: "test", tokensIn: null, tokensOut: null };
}

describe("cache ingest and GET source evidence contract", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    mocks.auth.mockResolvedValue({ user: { id: "owner" } });
    mocks.findMany.mockResolvedValue([row("deepseek", null), row("gemini", null)]);
    mocks.findFirst.mockResolvedValue(null);
    mocks.upsert.mockImplementation(async (args) => row("gemini", args.update.structuredJson));
  });
  afterEach(() => vi.useRealTimers());

  it("a re-ingested old brief loses claimed verification in both create and update, then cannot become Live Ideas", async () => {
    const old = payload("2026-10-02T14:49:30Z");
    const saved = await ingestRow({ bucket: now, provider: "gemini", htmlBody: "",
      structuredJson: old, verdictJson: old, generatedBy: "external", inputHash: "old" });
    const write = mocks.upsert.mock.lastCall![0];
    for (const action of [write.create, write.update]) {
      expect(action.structuredJson.marketEvidence.status).toBe("unverified");
      expect(action.verdictJson.marketEvidence.status).toBe("unverified");
    }
    mocks.findMany.mockResolvedValue([row("deepseek", null), saved]);
    const body = await (await GET()).json();
    expect(body.providers.gemini.generatedAt).toBe(now.toISOString());
    expect(body.providers.gemini.liveIdeas).toBeNull();
    expect(selectFreshestBriefWithContent(body.providers, now)).toBeNull();
  });

  it("GET and selection use each observed quote, remove narrative, and expire without a new cache write", async () => {
    mocks.findMany.mockResolvedValue([row("deepseek", payload("2026-10-02T14:49:30Z")),
      row("gemini", payload("2026-10-05T14:49:30Z"))]);
    const body = await (await GET()).json();
    expect(body.providers.deepseek.liveIdeas).toBeNull();
    expect(body.providers.gemini.liveIdeas.movers[0]).toMatchObject({ changePct: -2.34, why: null, traderLens: null });
    expect(selectFreshestBriefWithContent(body.providers, now)?.provider).toBe("gemini");
    expect(selectFreshestBriefWithContent(body.providers, new Date("2026-10-05T14:52:00Z"))).toBeNull();
  });

  it("errored rows and stale fallback rows cannot bypass observation expiry", async () => {
    mocks.findMany.mockResolvedValue([row("deepseek", payload("2026-10-05T14:49:30Z"), "failed"), row("gemini", null)]);
    mocks.findFirst.mockResolvedValue(row("openai", payload("2026-10-02T14:49:30Z")));
    const body = await (await GET()).json();
    expect(body.providers.deepseek.liveIdeas).toBeNull();
    expect(body.providers.openai.stale).toBe(true);
    expect(body.providers.openai.liveIdeas).toBeNull();
  });

  it("preserves the explicit unauthorized response", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });
});
