/**
 * Fee calculator for trades.
 *
 * Given a BrokerPreset.feeFormula and trade leg (side, qty, price), returns
 * the total fees in the broker's local currency.
 *
 * Used by:
 *   - /api/trades/manual    — show fee preview + persist
 *   - /api/csv/import       — backfill fees if CSV doesn't include them
 *
 * Formula schema (matches prisma/seed-broker-presets.ts):
 *   {
 *     commission?:  { type, value, minimum?, maximum?, applyTo? }
 *     platformFee?: { type, value, minimum?, maximum?, applyTo? }
 *     secFee?:      { type, value, minimum?, maximum?, applyTo? }
 *     tafFee?:      { type, value, minimum?, maximum?, applyTo? }
 *     exchangeFee?: { type, value, minimum?, maximum?, applyTo? }
 *   }
 *
 * `type` is one of:
 *   - 'fixed'     — flat amount regardless of size
 *   - 'perShare'  — value × abs(qty)
 *   - 'perValue'  — value × abs(qty × price)
 *   - 'perTrade'  — same as fixed (alias)
 *
 * `applyTo` is 'BUY' | 'SELL' | 'BOTH' (default 'BOTH' if omitted).
 *
 * Returns a breakdown so the UI can show "Commission $0.99, SEC $0.05..." and
 * a total. Total is rounded to 4 decimals — caller rounds further if needed.
 */

export type FeeSide = "BUY" | "SELL";

export type FeeComponent = {
  type: "fixed" | "perShare" | "perValue" | "perTrade";
  value: number;
  minimum?: number;
  maximum?: number;
  applyTo?: FeeSide | "BOTH";
};

export type FeeFormula = {
  commission?: FeeComponent;
  platformFee?: FeeComponent;
  secFee?: FeeComponent;
  tafFee?: FeeComponent;
  exchangeFee?: FeeComponent;
  // Catch-all for future broker-specific fees (e.g., regulatory levies in HK)
  [key: string]: FeeComponent | undefined;
};

export type FeeBreakdown = {
  total: number;
  components: { name: string; amount: number }[];
};

function computeOne(
  c: FeeComponent | undefined,
  qty: number,
  price: number,
  side: FeeSide,
): number {
  if (!c) return 0;
  const applyTo = c.applyTo ?? "BOTH";
  if (applyTo !== "BOTH" && applyTo !== side) return 0;

  const absQty = Math.abs(qty);
  const notional = absQty * Math.abs(price);

  let raw: number;
  switch (c.type) {
    case "fixed":
    case "perTrade":
      raw = c.value;
      break;
    case "perShare":
      raw = c.value * absQty;
      break;
    case "perValue":
      raw = c.value * notional;
      break;
    default:
      return 0;
  }

  if (c.minimum != null && raw < c.minimum) raw = c.minimum;
  if (c.maximum != null && raw > c.maximum) raw = c.maximum;
  return raw;
}

const FEE_COMPONENT_NAMES = [
  "commission",
  "platformFee",
  "secFee",
  "tafFee",
  "exchangeFee",
] as const;

export function calculateFees(
  formula: FeeFormula | null | undefined,
  qty: number,
  price: number,
  side: FeeSide,
): FeeBreakdown {
  if (!formula || qty === 0 || price === 0) {
    return { total: 0, components: [] };
  }

  const components: { name: string; amount: number }[] = [];

  // Known named components first (predictable display order)
  for (const name of FEE_COMPONENT_NAMES) {
    const amount = computeOne(formula[name], qty, price, side);
    if (amount > 0) components.push({ name, amount });
  }

  // Pick up any custom keys (broker-specific extra fees)
  for (const [key, c] of Object.entries(formula)) {
    if ((FEE_COMPONENT_NAMES as readonly string[]).includes(key)) continue;
    const amount = computeOne(c, qty, price, side);
    if (amount > 0) components.push({ name: key, amount });
  }

  const total = components.reduce((sum, c) => sum + c.amount, 0);
  return {
    total: Math.round(total * 10000) / 10000,  // 4 decimal places
    components: components.map((c) => ({
      name: c.name,
      amount: Math.round(c.amount * 10000) / 10000,
    })),
  };
}
