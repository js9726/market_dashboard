import { generateText, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

export type LLMTier = "fast" | "standard";

// Model IDs per provider per tier.
// fast   → cheap/quick for extraction, classification, simple structured output
// standard → capable for multi-step reasoning, persona scoring, analysis
const TIER_MODELS = {
  deepseek:  { fast: "deepseek-chat",             standard: "deepseek-chat" },
  anthropic: { fast: "claude-haiku-4-5-20251001", standard: "claude-sonnet-4-6" },
  openai:    { fast: "gpt-4o-mini",               standard: "gpt-4o" },
  gemini:    { fast: "gemini-2.0-flash",          standard: "gemini-2.5-pro" },
} as const;

interface LLMOptions {
  maxTokens?: number;
  provider?: string; // "deepseek" | "anthropic" | "openai" | "gemini"
  tier?: LLMTier;   // default: "standard"
}

// DeepSeek uses the OpenAI-compatible API
function deepseekModel(modelId: string): LanguageModel {
  return createOpenAI({
    baseURL: "https://api.deepseek.com/v1",
    apiKey: process.env.DEEPSEEK_API_KEY ?? "",
  })(modelId);
}

function resolveModel(provider?: string, tier: LLMTier = "standard"): LanguageModel {
  // Explicit provider selection (used by stock analysis tab)
  if (provider === "deepseek" && process.env.DEEPSEEK_API_KEY)
    return deepseekModel(TIER_MODELS.deepseek[tier]);
  if (provider === "anthropic" && process.env.ANTHROPIC_API_KEY)
    return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(TIER_MODELS.anthropic[tier]);
  if (provider === "openai" && process.env.OPENAI_API_KEY)
    return createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(TIER_MODELS.openai[tier]);
  if (provider === "gemini" && process.env.GEMINI_API_KEY)
    return createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY })(TIER_MODELS.gemini[tier]);

  // Priority fallback: DeepSeek → Anthropic → OpenAI → Gemini
  if (process.env.DEEPSEEK_API_KEY) return deepseekModel(TIER_MODELS.deepseek[tier]);
  if (process.env.ANTHROPIC_API_KEY)
    return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(TIER_MODELS.anthropic[tier]);
  if (process.env.OPENAI_API_KEY)
    return createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(TIER_MODELS.openai[tier]);
  if (process.env.GEMINI_API_KEY)
    return createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY })(TIER_MODELS.gemini[tier]);

  throw new Error(
    "No AI provider configured. Set DEEPSEEK_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY."
  );
}

export async function callLLM(
  userPrompt: string,
  systemPrompt: string,
  opts: LLMOptions = {}
): Promise<string> {
  const { maxTokens = 2048, provider, tier = "standard" } = opts;
  const { text } = await generateText({
    model: resolveModel(provider, tier),
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    maxTokens,
  });
  return text;
}
