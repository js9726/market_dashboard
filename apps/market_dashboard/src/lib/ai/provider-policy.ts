/**
 * One contract for metered dashboard LLM calls.
 *
 * Claude is deliberately absent: Claude dashboard work must run through the
 * Claude Code subscription runner, never through an Anthropic API key.
 * Provider choice is fail-closed. A failed or unconfigured request is never
 * rerouted to another vendor without a new, explicit request.
 */
export const METERED_LLM_PROVIDERS = ["deepseek", "openai", "gemini"] as const;
export type MeteredLLMProvider = (typeof METERED_LLM_PROVIDERS)[number];

export const DEFAULT_METERED_LLM_PROVIDER: MeteredLLMProvider = "deepseek";

export const PROVIDER_MODELS = {
  deepseek: { fast: "deepseek-v4-flash", standard: "deepseek-v4-flash" },
  openai: { fast: "gpt-4o-mini", standard: "gpt-4o" },
  gemini: { fast: "gemini-3.5-flash-lite", standard: "gemini-3.7-flash" },
} as const;

const PROVIDER_ENV_KEYS: Record<MeteredLLMProvider, string> = {
  deepseek: "DEEPSEEK_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
};

export function isMeteredLLMProvider(value: string): value is MeteredLLMProvider {
  return METERED_LLM_PROVIDERS.includes(value as MeteredLLMProvider);
}

export function resolveMeteredLLMProvider(requested?: string): MeteredLLMProvider {
  if (!requested) return DEFAULT_METERED_LLM_PROVIDER;
  if (!isMeteredLLMProvider(requested)) {
    throw new Error(
      `Unsupported metered AI provider '${requested}'. Choose ${METERED_LLM_PROVIDERS.join(", ")}. ` +
      "Claude is subscription-only and cannot be selected through this API route.",
    );
  }
  return requested;
}

export function providerEnvKey(provider: MeteredLLMProvider): string {
  return PROVIDER_ENV_KEYS[provider];
}

export function isMeteredLLMProviderConfigured(provider: MeteredLLMProvider): boolean {
  return Boolean(process.env[providerEnvKey(provider)]?.trim());
}

export function requireMeteredLLMProvider(provider: MeteredLLMProvider): void {
  if (!isMeteredLLMProviderConfigured(provider)) {
    throw new Error(
      `${providerEnvKey(provider)} is not configured. ` +
      `The request was not sent and will not fall back to another provider.`,
    );
  }
}
