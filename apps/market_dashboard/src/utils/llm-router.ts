import { generateText, type LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  PROVIDER_MODELS,
  requireMeteredLLMProvider,
  resolveMeteredLLMProvider,
  type MeteredLLMProvider,
} from "@/lib/ai/provider-policy";

export type LLMTier = "fast" | "standard";

// Model IDs per provider per tier.
// fast     → cheap/quick for extraction, classification, simple structured output
// standard → capable for multi-step reasoning, persona scoring, analysis
interface LLMOptions {
  maxTokens?: number;
  provider?: string; // explicit selection: "deepseek" | "openai" | "gemini"
  tier?: LLMTier;   // default: "standard"
}

function makeModel(p: MeteredLLMProvider, tier: LLMTier): LanguageModel {
  const modelId = PROVIDER_MODELS[p][tier];
  switch (p) {
    case "deepseek":
      return createOpenAI({ baseURL: "https://api.deepseek.com/v1", apiKey: process.env.DEEPSEEK_API_KEY ?? "" })(modelId);
    case "openai":
      return createOpenAI({ apiKey: process.env.OPENAI_API_KEY ?? "" })(modelId);
    case "gemini":
      return createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY ?? "" })(modelId);
  }
}

// out is an optional mutable object; callers can record the exact provider/model.
export async function callLLM(
  userPrompt: string,
  systemPrompt: string,
  opts: LLMOptions = {},
  out?: { providerUsed?: string; modelUsed?: string; note?: string }
): Promise<string> {
  const { maxTokens = 2048, provider, tier = "standard" } = opts;
  const selected = resolveMeteredLLMProvider(provider);
  requireMeteredLLMProvider(selected);

  const { text } = await generateText({
    model: makeModel(selected, tier),
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    maxTokens,
  });
  if (out) {
    out.providerUsed = selected;
    out.modelUsed = PROVIDER_MODELS[selected][tier];
  }
  return text;
}
