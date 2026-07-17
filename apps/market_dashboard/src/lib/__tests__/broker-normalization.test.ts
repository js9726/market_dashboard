import { describe, expect, it } from "vitest";
import { brokerKey, canonicalBrokerLabel } from "@/lib/broker-normalization";

describe("broker normalization", () => {
  it.each(["Moo Moo", "moomoo", "moomoo Malaysia", "moomoo (Malaysia)", "FUTUMY"])(
    "maps %s to the one live Malaysia account",
    (input) => {
      expect(brokerKey(input)).toBe("moomoo");
      expect(canonicalBrokerLabel(input)).toBe("moomoo Malaysia");
    },
  );

  it("keeps the simulated paper account separate", () => {
    expect(brokerKey("moomoo Paper (SIM)")).toBe("moomoo-paper");
    expect(canonicalBrokerLabel("moomoo Paper (SIM)")).toBe("moomoo Paper (SIM)");
  });

  it("does not rewrite unrelated brokers", () => {
    expect(canonicalBrokerLabel("Affin Hwang")).toBe("Affin Hwang");
    expect(canonicalBrokerLabel("IBKR main")).toBe("IBKR main");
  });
});
