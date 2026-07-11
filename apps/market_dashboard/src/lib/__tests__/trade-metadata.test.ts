import { describe, expect, it } from "vitest";
import {
  MAX_TRADE_METADATA_ITEMS,
  MAX_TRADE_METADATA_TEXT_LENGTH,
  MAX_TRADE_THOUGHTS_LENGTH,
  normalizeTradeScreenshotUrl,
  parseTradeMetadataPatch,
} from "@/lib/journal/trade-metadata";

describe("parseTradeMetadataPatch", () => {
  it("rejects non-object, empty, and unknown-field bodies", () => {
    expect(parseTradeMetadataPatch(null)).toMatchObject({ ok: false });
    expect(parseTradeMetadataPatch([])).toMatchObject({ ok: false });
    expect(parseTradeMetadataPatch({})).toMatchObject({ ok: false });
    expect(parseTradeMetadataPatch({ tags: [], notes: [] })).toMatchObject({
      ok: false,
      error: "Unknown metadata field: notes",
    });
  });

  it("keeps PATCH semantics by returning only fields that were supplied", () => {
    expect(parseTradeMetadataPatch({ tags: [" earnings "] })).toEqual({
      ok: true,
      value: { tags: ["earnings"] },
    });
  });

  it("trims and de-duplicates labels case-insensitively", () => {
    expect(parseTradeMetadataPatch({ tags: ["Gap Up", " gap up ", "VCP"] })).toEqual({
      ok: true,
      value: { tags: ["Gap Up", "VCP"] },
    });
  });

  it("rejects blank, overlong, non-string, and oversized label arrays", () => {
    expect(parseTradeMetadataPatch({ tags: [""] })).toMatchObject({ ok: false });
    expect(parseTradeMetadataPatch({ mistakes: [42] })).toMatchObject({ ok: false });
    expect(parseTradeMetadataPatch({ tags: ["x".repeat(MAX_TRADE_METADATA_TEXT_LENGTH + 1)] })).toMatchObject({ ok: false });
    expect(parseTradeMetadataPatch({ tags: Array.from({ length: MAX_TRADE_METADATA_ITEMS + 1 }, (_, i) => `tag-${i}`) })).toMatchObject({ ok: false });
  });

  it("normalizes and de-duplicates HTTPS screenshot URLs", () => {
    expect(parseTradeMetadataPatch({ screenshots: [" https://example.com/chart.png ", "https://example.com/chart.png"] })).toEqual({
      ok: true,
      value: { screenshots: ["https://example.com/chart.png"] },
    });
  });

  it("normalizes thoughts while preserving partial PATCH semantics", () => {
    expect(parseTradeMetadataPatch({ thoughts: "  I chased the first push.  " })).toEqual({
      ok: true,
      value: { thoughts: "I chased the first push." },
    });
    expect(parseTradeMetadataPatch({ thoughts: "   " })).toEqual({
      ok: true,
      value: { thoughts: null },
    });
    expect(parseTradeMetadataPatch({ thoughts: 42 })).toMatchObject({ ok: false });
    expect(parseTradeMetadataPatch({ thoughts: "x".repeat(MAX_TRADE_THOUGHTS_LENGTH + 1) })).toMatchObject({ ok: false });
  });
});

describe("normalizeTradeScreenshotUrl", () => {
  it("rejects malformed, insecure, and credential-bearing URLs", () => {
    expect(normalizeTradeScreenshotUrl("not a url")).toMatchObject({ ok: false });
    expect(normalizeTradeScreenshotUrl("http://example.com/chart.png")).toMatchObject({ ok: false });
    expect(normalizeTradeScreenshotUrl("https://user:secret@example.com/chart.png")).toMatchObject({ ok: false });
  });

  it("accepts an HTTPS URL", () => {
    expect(normalizeTradeScreenshotUrl("https://example.com/chart.png?size=2")).toEqual({
      ok: true,
      value: "https://example.com/chart.png?size=2",
    });
  });
});
