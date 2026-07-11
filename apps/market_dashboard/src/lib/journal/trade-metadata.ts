export const MAX_TRADE_METADATA_ITEMS = 24;
export const MAX_TRADE_METADATA_TEXT_LENGTH = 80;
export const MAX_TRADE_SCREENSHOT_URL_LENGTH = 500;
export const MAX_TRADE_THOUGHTS_LENGTH = 4000;

export type TradeMetadata = {
  tags: string[];
  screenshots: string[];
  mistakes: string[];
  thoughts: string | null;
};

export type TradeMetadataPatch = Partial<TradeMetadata>;

type ParseResult =
  | { ok: true; value: TradeMetadataPatch }
  | { ok: false; error: string };

type UrlResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

const METADATA_FIELDS = new Set<keyof TradeMetadata>(["tags", "screenshots", "mistakes", "thoughts"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTextArray(value: unknown, field: "tags" | "mistakes"): string[] | string {
  if (!Array.isArray(value)) return `${field} must be an array`;
  if (value.length > MAX_TRADE_METADATA_ITEMS) {
    return `${field} cannot contain more than ${MAX_TRADE_METADATA_ITEMS} items`;
  }

  const seen = new Set<string>();
  const output: string[] = [];
  for (let index = 0; index < value.length; index++) {
    const item = value[index];
    if (typeof item !== "string") return `${field}[${index}] must be a string`;
    const clean = item.trim();
    if (!clean) return `${field}[${index}] cannot be blank`;
    if (clean.length > MAX_TRADE_METADATA_TEXT_LENGTH) {
      return `${field}[${index}] cannot exceed ${MAX_TRADE_METADATA_TEXT_LENGTH} characters`;
    }
    const key = clean.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(clean);
  }
  return output;
}

export function normalizeTradeScreenshotUrl(value: unknown): UrlResult {
  if (typeof value !== "string") return { ok: false, error: "Screenshot URL must be a string" };
  const clean = value.trim();
  if (!clean) return { ok: false, error: "Screenshot URL cannot be blank" };
  if (clean.length > MAX_TRADE_SCREENSHOT_URL_LENGTH) {
    return { ok: false, error: `Screenshot URL cannot exceed ${MAX_TRADE_SCREENSHOT_URL_LENGTH} characters` };
  }

  let parsed: URL;
  try {
    parsed = new URL(clean);
  } catch {
    return { ok: false, error: "Screenshot URL is invalid" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, error: "Screenshot URL must use HTTPS" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "Screenshot URL cannot contain credentials" };
  }
  return { ok: true, value: parsed.href };
}

function parseScreenshotArray(value: unknown): string[] | string {
  if (!Array.isArray(value)) return "screenshots must be an array";
  if (value.length > MAX_TRADE_METADATA_ITEMS) {
    return `screenshots cannot contain more than ${MAX_TRADE_METADATA_ITEMS} items`;
  }

  const seen = new Set<string>();
  const output: string[] = [];
  for (let index = 0; index < value.length; index++) {
    const item = value[index];
    const parsed = normalizeTradeScreenshotUrl(item);
    if (!parsed.ok) return `screenshots[${index}]: ${parsed.error}`;
    if (seen.has(parsed.value)) continue;
    seen.add(parsed.value);
    output.push(parsed.value);
  }
  return output;
}

function parseThoughts(value: unknown): string | null | { error: string } {
  if (value == null) return null;
  if (typeof value !== "string") return { error: "thoughts must be a string or null" };
  const clean = value.trim();
  if (!clean) return null;
  if (clean.length > MAX_TRADE_THOUGHTS_LENGTH) {
    return { error: `thoughts cannot exceed ${MAX_TRADE_THOUGHTS_LENGTH} characters` };
  }
  return clean;
}

export function parseTradeMetadataPatch(value: unknown): ParseResult {
  if (!isRecord(value)) return { ok: false, error: "Body must be a JSON object" };

  const unknownField = Object.keys(value).find((field) => !METADATA_FIELDS.has(field as keyof TradeMetadata));
  if (unknownField) return { ok: false, error: `Unknown metadata field: ${unknownField}` };

  const patch: TradeMetadataPatch = {};
  if (Object.prototype.hasOwnProperty.call(value, "tags")) {
    const tags = parseTextArray(value.tags, "tags");
    if (typeof tags === "string") return { ok: false, error: tags };
    patch.tags = tags;
  }
  if (Object.prototype.hasOwnProperty.call(value, "mistakes")) {
    const mistakes = parseTextArray(value.mistakes, "mistakes");
    if (typeof mistakes === "string") return { ok: false, error: mistakes };
    patch.mistakes = mistakes;
  }
  if (Object.prototype.hasOwnProperty.call(value, "screenshots")) {
    const screenshots = parseScreenshotArray(value.screenshots);
    if (typeof screenshots === "string") return { ok: false, error: screenshots };
    patch.screenshots = screenshots;
  }
  if (Object.prototype.hasOwnProperty.call(value, "thoughts")) {
    const thoughts = parseThoughts(value.thoughts);
    if (thoughts && typeof thoughts === "object") return { ok: false, error: thoughts.error };
    patch.thoughts = thoughts;
  }

  if (!Object.keys(patch).length) {
    return { ok: false, error: "At least one metadata field is required" };
  }
  return { ok: true, value: patch };
}
