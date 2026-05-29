import { describe, expect, it } from "vitest";
import {
  normalizeBriefProvider,
  selectBriefProvider,
  selectFreshestBriefWithContent,
  selectFreshestBriefProvider,
  type BriefProviderMap,
} from "@/lib/brief/provider-selection";

function entry(
  generatedAt: string,
  opts: { error?: string | null; stale?: boolean; ideas?: boolean } = {},
) {
  return {
    structured: opts.ideas
      ? { mood: { label: "test" }, movers: [{ ticker: "NVDA" }] }
      : { mood: { label: "test" } },
    generatedAt,
    error: opts.error ?? null,
    stale: opts.stale,
  };
}

describe("brief provider selection", () => {
  it("chooses the newest successful structured provider", () => {
    const providers: BriefProviderMap = {
      deepseek: entry("2026-05-20T15:00:00.000Z"),
      gemini: entry("2026-05-20T16:00:00.000Z"),
      openai: null,
      claude: entry("2026-05-20T14:00:00.000Z"),
    };

    expect(selectFreshestBriefProvider(providers)?.provider).toBe("gemini");
  });

  it("ignores errored rows even when they are newer", () => {
    const providers: BriefProviderMap = {
      deepseek: entry("2026-05-20T15:00:00.000Z"),
      gemini: entry("2026-05-20T16:00:00.000Z", { error: "No object generated" }),
      openai: null,
      claude: null,
    };

    expect(selectFreshestBriefProvider(providers)?.provider).toBe("deepseek");
  });

  it("allows stale rows if they are the newest successful structured row", () => {
    const providers: BriefProviderMap = {
      deepseek: null,
      gemini: null,
      openai: null,
      claude: entry("2026-05-19T10:00:00.000Z", { stale: true }),
    };

    const selected = selectFreshestBriefProvider(providers);
    expect(selected?.provider).toBe("claude");
    expect(selected?.entry.stale).toBe(true);
  });

  it("honors manual provider selection when that provider is usable", () => {
    const providers: BriefProviderMap = {
      deepseek: entry("2026-05-20T16:00:00.000Z"),
      gemini: entry("2026-05-20T15:00:00.000Z"),
      openai: null,
      claude: null,
    };

    expect(selectBriefProvider(providers, "gemini")?.provider).toBe("gemini");
  });

  it("falls back to freshest when manual provider is errored or empty", () => {
    const providers: BriefProviderMap = {
      deepseek: entry("2026-05-20T16:00:00.000Z"),
      gemini: entry("2026-05-20T17:00:00.000Z", { error: "bad json" }),
      openai: null,
      claude: null,
    };

    expect(selectBriefProvider(providers, "gemini")?.provider).toBe("deepseek");
  });

  it("normalizes deepseek-search to the stored deepseek provider", () => {
    expect(normalizeBriefProvider("deepseek-search")).toBe("deepseek");
    expect(normalizeBriefProvider("gemini")).toBe("gemini");
    expect(normalizeBriefProvider("unknown")).toBeNull();
  });

  it("keeps Live Ideas on the current bucket before stale fallback ideas", () => {
    const providers: BriefProviderMap = {
      deepseek: entry("2026-05-20T13:00:00.000Z", { stale: true, ideas: true }),
      gemini: entry("2026-05-20T14:00:00.000Z"),
      openai: null,
      claude: null,
    };

    const selected = selectFreshestBriefWithContent(providers);
    expect(selected?.provider).toBe("gemini");
    expect(selected?.entry.stale).not.toBe(true);
  });
});
