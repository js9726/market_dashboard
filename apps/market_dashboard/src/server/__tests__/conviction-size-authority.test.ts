/**
 * sizePct must follow the FINAL decision (re-review finding 5, 2026-09-23).
 *
 * The band computed verdict + sizePct, then the LLM moderator was clamped down
 * separately, and sizePct was returned untouched — so the module could emit
 * {verdict:"GO", moderator:"WAIT", sizePct:0.5}: a WAIT still carrying 0.50% of
 * authorised equity risk. The route persists moderator as agentVerdict, so the
 * two halves of one record disagreed about whether a position was authorised.
 *
 * The LLM is mocked; no network call is made.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const callLLM = vi.fn();
vi.mock("@/utils/llm-router", () => ({ callLLM: (...a: unknown[]) => callLLM(...a) }));

import { runConvictionAnalysis, type ConvictionInput } from "@/server/conviction-analysis";

const INPUT: ConvictionInput = {
  ticker: "TEST", setup: "BO-CB", sector: "Technology",
  triggerState: "TRIGGERED", triggerReason: "held range + close > pivot on RVOL 2.1x",
  entryZone: 100, stop: 95, target: 130, rvol: 2.1, rsRating: 95, day0Thesis: null,
  algo: { setup: 30, entry: 22, theme: 14, sentiment: 7 },
  extension: { atr14: 4, dist21Atr: 0.5, dist50Atr: null, rsi14: 60, entryRisk: "FAIR", base10dPct: 8 },
  pivotFound: true,
  barComplete: true,
  barDate: "2026-09-22",
};

function reply(moderator: string) {
  return JSON.stringify({
    setup: 32, entry: 24, theme: 14, sentiment: 7, verdict: "GO", moderator,
    champion: "@markminervini",
    reasoning: { setup: "s", entry: "e", theme: "t", sentiment: "x", moderator: "m" },
  });
}

describe("authorised size follows the final moderator", () => {
  beforeEach(() => callLLM.mockReset());

  it("a moderated-down WAIT carries ZERO authorised risk", async () => {
    callLLM.mockResolvedValue(reply("WAIT"));
    const r = await runConvictionAnalysis(INPUT);
    expect(r).not.toBeNull();
    expect(r!.moderator).toBe("WAIT");
    expect(r!.sizePct).toBe(0);
  });

  it("a moderated-down PASS carries ZERO authorised risk", async () => {
    callLLM.mockResolvedValue(reply("PASS"));
    const r = await runConvictionAnalysis(INPUT);
    expect(r!.moderator).toBe("PASS");
    expect(r!.sizePct).toBe(0);
  });

  it("an agreeing ENTER keeps full size", async () => {
    callLLM.mockResolvedValue(reply("ENTER"));
    const r = await runConvictionAnalysis(INPUT);
    expect(r!.moderator).toBe("ENTER");
    expect(r!.verdict).toBe("GO");
    expect(r!.sizePct).toBe(0.5);
  });

  it("the LLM cannot promote a WATCH into a sized ENTER", async () => {
    callLLM.mockResolvedValue(reply("ENTER"));
    const r = await runConvictionAnalysis({ ...INPUT, triggerState: "ARMED", algo: { setup: 10, entry: 8, theme: 5, sentiment: 3 } });
    // ARMED at 77 is a PROBE, never a GO — and never more than half size.
    expect(r!.sizePct).toBeLessThanOrEqual(0.25);
  });

  it("an unfinished bar yields WATCH and zero size even on a TRIGGERED lane", async () => {
    callLLM.mockResolvedValue(reply("ENTER"));
    const r = await runConvictionAnalysis({ ...INPUT, barComplete: false });
    expect(r!.verdict).toBe("WATCH");
    expect(r!.moderator).toBe("WAIT");
    expect(r!.sizePct).toBe(0);
  });

  it("size and moderator never disagree, whatever the model says", async () => {
    for (const m of ["ENTER", "WAIT", "PASS", "garbage", ""]) {
      callLLM.mockResolvedValue(reply(m));
      const r = await runConvictionAnalysis(INPUT);
      expect(r!.sizePct > 0).toBe(r!.moderator === "ENTER");
    }
  });
});
