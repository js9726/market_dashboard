import { describe, expect, it } from "vitest";
import { reportedPnlUsd } from "@/lib/currency";

describe("reportedPnlUsd", () => {
  it("prefers persisted USD P&L over the raw sheet amount", () => {
    expect(reportedPnlUsd({
      pnlUsd: -55.82,
      rawPnl: -269.54,
      currencyCode: "MYR",
    })).toEqual({ value: -55.82, currencyCode: "USD", unconverted: false });
  });

  it("fails closed for a non-USD raw value without conversion", () => {
    expect(reportedPnlUsd({
      pnlUsd: null,
      rawPnl: -269.54,
      currencyCode: "MYR",
    })).toEqual({ value: null, currencyCode: "USD", unconverted: true });
  });
});
