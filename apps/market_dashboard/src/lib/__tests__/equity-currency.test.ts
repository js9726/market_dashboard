import { describe, expect, it } from "vitest";
import { convertEquitySnapshotToUsd, moneyToUsd, usdToDisplay } from "@/lib/equity-currency";

describe("equity currency helpers", () => {
  it("converts MYR account values back to USD using the supplied USD/MYR rate", () => {
    expect(moneyToUsd(-1933.6, "MYR", 4.7)).toBe(-411.4);
    expect(usdToDisplay(100, "MYR", 4.7)).toBe(470);
  });

  it("keeps USD values unchanged", () => {
    expect(moneyToUsd(965, "USD", null)).toBe(965);
    expect(usdToDisplay(965, "USD", 4.7)).toBe(965);
  });

  it("fails closed when asked to convert non-USD values without a rate", () => {
    expect(moneyToUsd(12813.04, "MYR", null)).toBeNull();
    expect(convertEquitySnapshotToUsd({ totalAssets: 12813.04, cash: 1079.52, marketVal: 11733.52, currencyCode: "MYR" }, null)).toBeNull();
  });

  it("converts a reconciled MooMoo Malaysia MYR snapshot into USD", () => {
    const converted = convertEquitySnapshotToUsd(
      { totalAssets: 58017.37, cash: 4891.07, marketVal: 53126.3, currencyCode: "MYR" },
      4.526,
    );

    expect(converted).toEqual({
      totalAssetsUsd: 12818.69,
      cashUsd: 1080.66,
      marketValUsd: 11738.02,
    });
  });
});
