import { describe, expect, it } from "vitest";
import {
  ALLOWED_MIME_TYPES,
  MAX_ATTACHMENTS_PER_ENTRY,
  MAX_FILE_SIZE_BYTES,
  isAllowedMime,
  isValidBlobUrl,
  isWithinSizeLimit,
  sanitiseAttachmentUrls,
} from "@/lib/journal/attachments";

const GOOD_URL = "https://abcd1234.public.blob.vercel-storage.com/journal-2026-05-21-abc.png";
const ANOTHER_GOOD = "https://team-foo.public.blob.vercel-storage.com/chart-xyz.jpg";

describe("isValidBlobUrl", () => {
  it("accepts a real-shaped Blob URL", () => {
    expect(isValidBlobUrl(GOOD_URL)).toBe(true);
  });
  it("rejects http (must be https)", () => {
    expect(isValidBlobUrl(GOOD_URL.replace("https://", "http://"))).toBe(false);
  });
  it("rejects arbitrary domains", () => {
    expect(isValidBlobUrl("https://evil.example.com/image.png")).toBe(false);
    expect(isValidBlobUrl("https://my-storage.blob.windows.net/x.png")).toBe(false);
  });
  it("rejects non-string + over-long input", () => {
    expect(isValidBlobUrl(null)).toBe(false);
    expect(isValidBlobUrl(undefined)).toBe(false);
    expect(isValidBlobUrl(42)).toBe(false);
    expect(isValidBlobUrl("https://abc.public.blob.vercel-storage.com/" + "a".repeat(2000))).toBe(false);
  });
});

describe("sanitiseAttachmentUrls", () => {
  it("returns [] for non-array input", () => {
    expect(sanitiseAttachmentUrls(null)).toEqual([]);
    expect(sanitiseAttachmentUrls("string")).toEqual([]);
    expect(sanitiseAttachmentUrls({})).toEqual([]);
  });

  it("drops invalid entries", () => {
    expect(
      sanitiseAttachmentUrls([GOOD_URL, "not-a-url", 42, null, ANOTHER_GOOD]),
    ).toEqual([GOOD_URL, ANOTHER_GOOD]);
  });

  it("de-duplicates", () => {
    expect(sanitiseAttachmentUrls([GOOD_URL, GOOD_URL, ANOTHER_GOOD])).toEqual([GOOD_URL, ANOTHER_GOOD]);
  });

  it("caps at MAX_ATTACHMENTS_PER_ENTRY", () => {
    const many = Array.from(
      { length: MAX_ATTACHMENTS_PER_ENTRY + 3 },
      (_, i) => `https://x.public.blob.vercel-storage.com/file-${i}.png`,
    );
    const out = sanitiseAttachmentUrls(many);
    expect(out).toHaveLength(MAX_ATTACHMENTS_PER_ENTRY);
    expect(out[0]).toBe(many[0]);
  });
});

describe("isAllowedMime", () => {
  it("accepts each canonical image MIME type", () => {
    for (const mime of ALLOWED_MIME_TYPES) {
      expect(isAllowedMime(mime)).toBe(true);
    }
  });
  it("rejects null + arbitrary content types", () => {
    expect(isAllowedMime(null)).toBe(false);
    expect(isAllowedMime(undefined)).toBe(false);
    expect(isAllowedMime("application/pdf")).toBe(false);
    expect(isAllowedMime("image/svg+xml")).toBe(false);
  });
});

describe("isWithinSizeLimit", () => {
  it("accepts positive sizes under the limit", () => {
    expect(isWithinSizeLimit(1)).toBe(true);
    expect(isWithinSizeLimit(MAX_FILE_SIZE_BYTES)).toBe(true);
    expect(isWithinSizeLimit(MAX_FILE_SIZE_BYTES - 1)).toBe(true);
  });
  it("rejects sizes over the limit", () => {
    expect(isWithinSizeLimit(MAX_FILE_SIZE_BYTES + 1)).toBe(false);
  });
  it("rejects 0, negative, NaN, and non-numbers", () => {
    expect(isWithinSizeLimit(0)).toBe(false);
    expect(isWithinSizeLimit(-1)).toBe(false);
    expect(isWithinSizeLimit(NaN)).toBe(false);
    expect(isWithinSizeLimit(Infinity)).toBe(false);
    expect(isWithinSizeLimit(null)).toBe(false);
  });
});
