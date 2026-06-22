/**
 * asText — coerce any LLM-provided brief field into a safe string for React.
 *
 * Why: the structured brief is produced by several LLM providers (DeepSeek,
 * Gemini, Codex/OpenAI, Claude) and ingested largely as-is. A provider that
 * emits a field as an OBJECT where a string is expected — e.g. an `alert`
 * shaped `{ level, message }` instead of a plain string — used to crash the
 * entire dashboard with React error #31 ("Objects are not valid as a React
 * child"). One malformed payload must never blank everyone's desk.
 *
 * This collapses the common object shapes to their human-readable text and
 * falls back to a JSON string, so a render site can always emit a string.
 */
export function asText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(" · ");
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    // Most natural shapes first: { level, message } alert, { text }, { label }.
    if (typeof o.message === "string") return o.message;
    if (typeof o.text === "string") return o.text;
    if (typeof o.label === "string") return o.label;
    if (typeof o.value === "string") return o.value;
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return String(value);
}
