import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

interface LLMOptions {
  maxTokens?: number;
}

/**
 * Calls the best available LLM provider in priority order:
 * Anthropic (Claude) → OpenAI (GPT-4o) → Gemini.
 * Returns the raw text content of the response.
 * Callers are responsible for JSON.parse if needed.
 */
export async function callLLM(
  userPrompt: string,
  systemPrompt: string,
  opts: LLMOptions = {}
): Promise<string> {
  const { maxTokens = 2048 } = opts;

  if (process.env.ANTHROPIC_API_KEY) {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    const block = msg.content[0];
    return block.type === "text" ? block.text : "{}";
  }

  if (process.env.OPENAI_API_KEY) {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      max_tokens: maxTokens,
    });
    return completion.choices[0].message.content ?? "{}";
  }

  if (process.env.GEMINI_API_KEY) {
    const client = new OpenAI({
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      apiKey: process.env.GEMINI_API_KEY,
    });
    const completion = await client.chat.completions.create({
      model: "gemini-2.5-pro",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      max_tokens: maxTokens,
    });
    return completion.choices[0].message.content ?? "{}";
  }

  throw new Error(
    "No AI provider configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY."
  );
}
