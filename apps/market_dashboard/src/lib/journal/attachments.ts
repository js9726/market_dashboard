/**
 * Validation + helpers for journal-entry image attachments stored on Vercel
 * Blob. Pure functions only — no SDK calls — so the unit tests don't need a
 * Blob token and the same helpers run on both client and server.
 */

export const MAX_ATTACHMENTS_PER_ENTRY = 5;
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type AllowedMime = (typeof ALLOWED_MIME_TYPES)[number];

/**
 * Vercel Blob URLs all live on `*.public.blob.vercel-storage.com`.
 * Server-side we accept either the production host or a localhost/dev URL.
 */
const BLOB_HOST_RE = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//;

export function isValidBlobUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  if (url.length > 1024) return false;       // sanity cap
  return BLOB_HOST_RE.test(url);
}

/**
 * Sanitise an incoming attachmentUrls array. Drops anything that isn't a
 * valid Blob URL, de-dupes, and caps at MAX_ATTACHMENTS_PER_ENTRY.
 */
export function sanitiseAttachmentUrls(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of input) {
    if (!isValidBlobUrl(item)) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= MAX_ATTACHMENTS_PER_ENTRY) break;
  }
  return out;
}

export function isAllowedMime(mime: string | null | undefined): mime is AllowedMime {
  if (!mime) return false;
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mime);
}

export function isWithinSizeLimit(bytes: number | null | undefined): boolean {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return false;
  return bytes > 0 && bytes <= MAX_FILE_SIZE_BYTES;
}
