/**
 * Fear & Greed index — fetched server-side from CNN's published index so EVERY
 * brief tab shows the same fresh value. Previously each LLM filled
 * `fearGreed` itself, so only Gemini's search-grounded run populated it and the
 * other tabs were blank. This is the same pattern as breadth/marketDirection:
 * authoritative market data computed once in the backend, not guessed per model.
 *
 * Freshness: live fetch with a short in-memory cache (CNN updates the index
 * ~once per trading day, so 10 min is plenty fresh while sparing CNN on every
 * desk poll). Fail-closed: any error or malformed payload returns null, and the
 * caller leaves the field blank rather than showing a stale number.
 */

const CNN_URL = "https://production.dataviz.cnn.com/index/fearandgreed/graphdata";
const CACHE_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

export interface FearGreed {
  score: number; // 0-100, rounded
  label: string; // e.g. "Extreme Fear", "Greed"
  asOf: string | null; // CNN's own data timestamp, for provenance
}

let cache: { value: FearGreed | null; at: number } | null = null;

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Live CNN Fear & Greed, cached ~10 min. Null on any failure (never stale). */
export async function fetchFearGreed(now: number = Date.now()): Promise<FearGreed | null> {
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;

  let value: FearGreed | null = null;
  try {
    const res = await fetch(CNN_URL, {
      headers: {
        // CNN's dataviz endpoint 418s without a browser-like UA.
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.ok) {
      const json = (await res.json()) as { fear_and_greed?: { score?: unknown; rating?: unknown; timestamp?: unknown } };
      const fg = json.fear_and_greed;
      const score = Number(fg?.score);
      const rating = typeof fg?.rating === "string" ? fg.rating : null;
      if (Number.isFinite(score) && score >= 0 && score <= 100 && rating) {
        value = {
          score: Math.round(score),
          label: titleCase(rating),
          asOf: typeof fg?.timestamp === "string" ? fg.timestamp : null,
        };
      }
    } else {
      console.warn(`[fear-greed] CNN returned ${res.status}`);
    }
  } catch (e) {
    console.warn("[fear-greed] fetch failed (left null):", e);
  }

  cache = { value, at: now };
  return value;
}

/**
 * Overlay the authoritative Fear & Greed onto a brief's structured JSON so the
 * value is consistent across providers and as fresh as the read. No-op when the
 * fetch failed (fg null) or the structured payload isn't an object.
 */
export function overlayFearGreed<T>(structured: T, fg: FearGreed | null): T {
  if (!fg || !structured || typeof structured !== "object") return structured;
  return { ...(structured as Record<string, unknown>), fearGreed: { score: fg.score, label: fg.label } } as T;
}
