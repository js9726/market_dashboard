/**
 * Salvage parser for structured-brief model output.
 *
 * generateObject fails with "No object generated: could not parse the
 * response" when a provider wraps its JSON in markdown fences, prepends
 * prose, or appends trailing commentary (DeepSeek does all three under
 * mode:"json"). The raw text usually still contains one valid JSON object —
 * extract and parse it instead of discarding the whole run.
 */

/** Best-effort extraction of the first complete JSON object in `text`. */
export function salvageJsonObject(text: string): unknown | null {
  if (!text) return null;

  // Prefer fenced blocks when present: ```json ... ``` or ``` ... ```
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates: string[] = [];
  if (fence?.[1]) candidates.push(fence[1]);

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(text.slice(start, end + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // try next candidate
    }
  }
  return null;
}
