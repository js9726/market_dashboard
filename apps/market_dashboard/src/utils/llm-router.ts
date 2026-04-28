import { generateText, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

export type LLMTier = "fast" | "standard";

// Model IDs per provider per tier.
// fast     → cheap/quick for extraction, classification, simple structured output
// standard → capable for multi-step reasoning, persona scoring, analysis
const TIER_MODELS = {
  deepseek:  { fast: "deepseek-chat",             standard: "deepseek-chat" },
  anthropic: { fast: "claude-haiku-4-5-20251001", standard: "claude-sonnet-4-6" },
  openai:    { fast: "gpt-4o-mini",               standard: "gpt-4o" },
  gemini:    { fast: "gemini-2.0-flash",          standard: "gemini-2.5-pro" },
} as const;

const PROVIDER_ORDER = ["deepseek", "anthropic", "openai", "gemini"] as const;
type Provider = (typeof PROVIDER_ORDER)[number];

interface LLMOptions {
  maxTokens?: number;
  provider?: string; // explicit selection: "deepseek" | "anthropic" | "openai" | "gemini"
  tier?: LLMTier;   // default: "standard"
}

function hasKey(p: Provider): boolean {
  switch (p) {
    case "deepseek":  return !!process.env.DEEPSEEK_API_KEY;
    case "anthropic": return !!process.env.ANTHROPIC_API_KEY;
    case "openai":    return !!process.env.OPENAI_API_KEY;
    case "gemini":    return !!process.env.GEMINI_API_KEY;
  }
}

function makeModel(p: Provider, tier: LLMTier): LanguageModel {
  const modelId = TIER_MODELS[p][tier];
  switch (p) {
    case "deepseek":
      return createOpenAI({ baseURL: "https://api.deepseek.com/v1", apiKey: process.env.DEEPSEEK_API_KEY ?? "" })(modelId);
    case "anthropic":
      return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" })(modelId);
    case "openai":
      return createOpenAI({ apiKey: process.env.OPENAI_API_KEY ?? "" })(modelId);
    case "gemini":
      return createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY ?? "" })(modelId);
  }
}

// Build ordered list of providers to try.
// Explicit provider goes first (if key present); remaining fill in priority order.
function buildQueue(requested?: string, tier: LLMTier = "standard"): Provider[] {
  const queue: Provider[] = [];
  if (requested && PROVIDER_ORDER.includes(requested as Provider) && hasKey(requested as Provider)) {
    queue.push(requested as Provider);
  }
  for (const p of PROVIDER_ORDER) {
    if (!queue.includes(p) && hasKey(p)) queue.push(p);
  }
  return queue;
}

// out is an optional mutable object; callers that need fallback info pass one in.
export async function callLLM(
  userPrompt: string,
  systemPrompt: string,
  opts: LLMOptions = {},
  out?: { providerUsed?: string; modelUsed?: string; note?: string }
): Promise<string> {
  const { maxTokens = 2048, provider, tier = "standard" } = opts;
  const queue = buildQueue(provider, tier);

  if (queue.length === 0) {
    throw new Error(
      "No AI provider configured. Set DEEPSEEK_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY."
    );
  }

  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    try {
      const { text } = await generateText({
        model: makeModel(p, tier),
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        maxTokens,
      });
      if (out) {
        out.providerUsed = p;
        out.modelUsed = TIER_MODELS[p][tier];
        if (i > 0) out.note = `${queue[0]} unavailable — used ${p} instead`;
      }
      return text;
    } catch {
      // Try next provider
    }
  }

  throw new Error("All AI providers failed. Check your API keys and credit balances.");
}
