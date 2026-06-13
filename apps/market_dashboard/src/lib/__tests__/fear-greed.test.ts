import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchFearGreed, overlayFearGreed } from "../fear-greed";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("overlayFearGreed", () => {
  const fg = { score: 34, label: "Fear", asOf: null };

  it("sets fearGreed on a structured object", () => {
    expect(overlayFearGreed({ mood: { posture: "GO" } }, fg)).toEqual({
      mood: { posture: "GO" },
      fearGreed: { score: 34, label: "Fear" },
    });
  });

  it("overrides an LLM-provided fearGreed (CNN wins)", () => {
    expect(overlayFearGreed({ fearGreed: { score: 99, label: "Extreme Greed" } }, fg)).toEqual({
      fearGreed: { score: 34, label: "Fear" },
    });
  });

  it("no-ops when fg is null or payload is not an object", () => {
    expect(overlayFearGreed({ a: 1 }, null)).toEqual({ a: 1 });
    expect(overlayFearGreed(null, fg)).toBeNull();
    expect(overlayFearGreed("x", fg)).toBe("x");
  });
});

describe("fetchFearGreed", () => {
  function mockFetch(payload: unknown, ok = true) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok, status: ok ? 200 : 503, json: async () => payload })),
    );
  }

  it("parses CNN payload and title-cases the rating", async () => {
    mockFetch({ fear_and_greed: { score: 33.7, rating: "extreme fear", timestamp: "2026-06-12T00:00:00Z" } });
    // unique `now` each test to bypass the module cache
    expect(await fetchFearGreed(1_000_000)).toEqual({
      score: 34,
      label: "Extreme Fear",
      asOf: "2026-06-12T00:00:00Z",
    });
  });

  it("returns null on out-of-range score (fail-closed)", async () => {
    mockFetch({ fear_and_greed: { score: 250, rating: "greed" } });
    expect(await fetchFearGreed(2_000_000)).toBeNull();
  });

  it("returns null on a non-OK response", async () => {
    mockFetch({}, false);
    expect(await fetchFearGreed(3_000_000)).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    expect(await fetchFearGreed(4_000_000)).toBeNull();
  });
});
