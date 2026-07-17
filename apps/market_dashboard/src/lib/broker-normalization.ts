/** Canonical broker identities used by journal matching and analytics. */
export function brokerKey(value: string | null | undefined): string {
  const normalized = (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized.includes("moomoo") || normalized.includes("futu")) {
    if (normalized.includes("paper") || normalized.includes("sim")) return "moomoo-paper";
    return "moomoo";
  }
  if (normalized.includes("ibkr") || normalized.includes("interactivebrokers")) return "ibkr";
  if (normalized.includes("tiger")) return "tiger";
  return normalized || "unknown";
}

/**
 * The operator has one live moomoo account: Malaysia. Historical sheet values
 * such as "Moo Moo" and FUTUMY therefore represent the same broker. Keep the
 * explicitly simulated paper account separate from the live account.
 */
export function canonicalBrokerLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const key = brokerKey(trimmed);
  if (key === "moomoo") return "moomoo Malaysia";
  if (key === "moomoo-paper") return "moomoo Paper (SIM)";
  return trimmed;
}
