import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_METERED_LLM_PROVIDER,
  PROVIDER_MODELS,
  isMeteredLLMProviderConfigured,
  requireMeteredLLMProvider,
  resolveMeteredLLMProvider,
} from "@/lib/ai/provider-policy";

const originalDeepSeekKey = process.env.DEEPSEEK_API_KEY;

afterEach(() => {
  if (originalDeepSeekKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = originalDeepSeekKey;
});

describe("metered provider policy", () => {
  it("defaults to DeepSeek V4 Flash", () => {
    expect(DEFAULT_METERED_LLM_PROVIDER).toBe("deepseek");
    expect(resolveMeteredLLMProvider()).toBe("deepseek");
    expect(PROVIDER_MODELS.deepseek.standard).toBe("deepseek-v4-flash");
  });

  it("rejects Anthropic instead of silently rerouting", () => {
    expect(() => resolveMeteredLLMProvider("anthropic")).toThrow(/subscription-only/);
  });

  it("honours an explicit supported provider", () => {
    expect(resolveMeteredLLMProvider("gemini")).toBe("gemini");
  });

  it("treats whitespace-only credentials as absent and names the exact key", () => {
    process.env.DEEPSEEK_API_KEY = "   ";
    expect(isMeteredLLMProviderConfigured("deepseek")).toBe(false);
    expect(() => requireMeteredLLMProvider("deepseek")).toThrow(/DEEPSEEK_API_KEY.*will not fall back/);
  });
});
