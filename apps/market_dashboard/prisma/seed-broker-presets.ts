/**
 * Seed built-in BrokerPreset rows.
 *
 * Run with:
 *   npx tsx prisma/seed-broker-presets.ts
 *
 * Idempotent: re-running just upserts the same rows. Safe to run on production
 * Neon DB. Built-in presets have userId=null and isBuiltIn=true so user-cloned
 * presets (with userId set) are never overwritten.
 *
 * Fee formula schema:
 *   {
 *     commission: { type: 'fixed'|'perShare'|'perTrade', value, minimum?, applyTo?: 'BUY'|'SELL'|'BOTH' },
 *     secFee:     { type: 'perShare'|'perValue', value, minimum?, applyTo?: 'SELL' },
 *     tafFee:     { type: 'perShare', value, minimum?, applyTo?: 'SELL', maximum? },
 *     exchangeFee:{ type: 'perTrade'|'perShare', value, applyTo?: 'BOTH' }
 *   }
 *
 * Rates verified against published broker schedules 2026-05. Update when
 * brokers change pricing. User-clone presets always take precedence over
 * built-in if both exist for the same broker.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BUILT_IN_PRESETS = [
  // ── moomoo (Malaysia) — FUTUMY ─────────────────────────────────────────────
  // Schedule: USD 0.0049/share min $0.99/order + SEC/TAF + USD 1 platform fee
  {
    name: "moomoo (Malaysia)",
    region: "MY",
    currency: "USD",
    feeFormula: {
      commission: { type: "perShare", value: 0.0049, minimum: 0.99, applyTo: "BOTH" },
      platformFee: { type: "perTrade", value: 1.00, applyTo: "BOTH" },
      secFee: { type: "perValue", value: 0.0000278, minimum: 0.01, applyTo: "SELL" },
      tafFee: { type: "perShare", value: 0.000166, minimum: 0.01, maximum: 8.30, applyTo: "SELL" },
    },
  },

  // ── moomoo (Singapore) — FUTUSG ────────────────────────────────────────────
  {
    name: "moomoo (Singapore)",
    region: "SG",
    currency: "USD",
    feeFormula: {
      commission: { type: "perShare", value: 0.0049, minimum: 0.99, applyTo: "BOTH" },
      platformFee: { type: "perShare", value: 0.005, minimum: 1.00, applyTo: "BOTH" },
      secFee: { type: "perValue", value: 0.0000278, minimum: 0.01, applyTo: "SELL" },
      tafFee: { type: "perShare", value: 0.000166, minimum: 0.01, maximum: 8.30, applyTo: "SELL" },
    },
  },

  // ── moomoo (US) — FUTUINC ──────────────────────────────────────────────────
  // Schedule: $0 commission for US-domiciled accounts + regulatory only
  {
    name: "moomoo (US)",
    region: "US",
    currency: "USD",
    feeFormula: {
      commission: { type: "fixed", value: 0, applyTo: "BOTH" },
      secFee: { type: "perValue", value: 0.0000278, minimum: 0.01, applyTo: "SELL" },
      tafFee: { type: "perShare", value: 0.000166, minimum: 0.01, maximum: 8.30, applyTo: "SELL" },
    },
  },

  // ── Interactive Brokers — Tiered (US) ──────────────────────────────────────
  // Schedule: $0.0035/share, min $0.35, max 1% of trade value + regulatory
  {
    name: "IBKR Tiered (US)",
    region: "US",
    currency: "USD",
    feeFormula: {
      commission: { type: "perShare", value: 0.0035, minimum: 0.35, applyTo: "BOTH" },
      secFee: { type: "perValue", value: 0.0000278, minimum: 0.01, applyTo: "SELL" },
      tafFee: { type: "perShare", value: 0.000166, minimum: 0.01, maximum: 8.30, applyTo: "SELL" },
      exchangeFee: { type: "perShare", value: 0.0003, applyTo: "BOTH" },
    },
  },

  // ── Interactive Brokers — Fixed (US) ───────────────────────────────────────
  {
    name: "IBKR Fixed (US)",
    region: "US",
    currency: "USD",
    feeFormula: {
      commission: { type: "perShare", value: 0.005, minimum: 1.00, applyTo: "BOTH" },
      // Fixed pricing includes exchange + regulatory fees in commission.
    },
  },

  // ── Charles Schwab (US) ────────────────────────────────────────────────────
  // Schedule: $0 commission + regulatory only
  {
    name: "Charles Schwab",
    region: "US",
    currency: "USD",
    feeFormula: {
      commission: { type: "fixed", value: 0, applyTo: "BOTH" },
      secFee: { type: "perValue", value: 0.0000278, minimum: 0.01, applyTo: "SELL" },
      tafFee: { type: "perShare", value: 0.000166, minimum: 0.01, maximum: 8.30, applyTo: "SELL" },
    },
  },

  // ── Fidelity (US) ──────────────────────────────────────────────────────────
  {
    name: "Fidelity",
    region: "US",
    currency: "USD",
    feeFormula: {
      commission: { type: "fixed", value: 0, applyTo: "BOTH" },
      secFee: { type: "perValue", value: 0.0000278, minimum: 0.01, applyTo: "SELL" },
      tafFee: { type: "perShare", value: 0.000166, minimum: 0.01, maximum: 8.30, applyTo: "SELL" },
    },
  },

  // ── Robinhood (US) ─────────────────────────────────────────────────────────
  // $0 commission, no SEC/TAF passthrough on most account types
  {
    name: "Robinhood",
    region: "US",
    currency: "USD",
    feeFormula: {
      commission: { type: "fixed", value: 0, applyTo: "BOTH" },
      // SEC/TAF: $0.000008 per dollar (passthrough) — applies on sells only
      secFee: { type: "perValue", value: 0.000008, minimum: 0.01, applyTo: "SELL" },
      tafFee: { type: "perShare", value: 0.000166, minimum: 0.01, maximum: 8.30, applyTo: "SELL" },
    },
  },

  // ── Webull (US) ────────────────────────────────────────────────────────────
  {
    name: "Webull",
    region: "US",
    currency: "USD",
    feeFormula: {
      commission: { type: "fixed", value: 0, applyTo: "BOTH" },
      secFee: { type: "perValue", value: 0.0000278, minimum: 0.01, applyTo: "SELL" },
      tafFee: { type: "perShare", value: 0.000166, minimum: 0.01, maximum: 8.30, applyTo: "SELL" },
    },
  },

  // ── Tiger Brokers (Singapore) ──────────────────────────────────────────────
  // Schedule: $0.005/share min $0.99 + platform fee
  {
    name: "Tiger Brokers (SG)",
    region: "SG",
    currency: "USD",
    feeFormula: {
      commission: { type: "perShare", value: 0.005, minimum: 0.99, applyTo: "BOTH" },
      platformFee: { type: "perShare", value: 0.005, minimum: 1.00, applyTo: "BOTH" },
      secFee: { type: "perValue", value: 0.0000278, minimum: 0.01, applyTo: "SELL" },
      tafFee: { type: "perShare", value: 0.000166, minimum: 0.01, maximum: 8.30, applyTo: "SELL" },
    },
  },

  // ── CMC Markets (Singapore) ────────────────────────────────────────────────
  // Schedule: variable, approximated to $0.01/share min $5
  {
    name: "CMC Markets (SG)",
    region: "SG",
    currency: "USD",
    feeFormula: {
      commission: { type: "perShare", value: 0.01, minimum: 5.00, applyTo: "BOTH" },
    },
  },

  // ── Custom (placeholder) ───────────────────────────────────────────────────
  // Zero-fee template users can clone & edit if their broker isn't listed.
  {
    name: "Custom (template)",
    region: "US",
    currency: "USD",
    feeFormula: {
      commission: { type: "fixed", value: 0, applyTo: "BOTH" },
    },
  },
];

async function main() {
  let created = 0;
  let updated = 0;

  for (const preset of BUILT_IN_PRESETS) {
    const existing = await prisma.brokerPreset.findFirst({
      where: { name: preset.name, isBuiltIn: true, userId: null },
    });

    if (existing) {
      await prisma.brokerPreset.update({
        where: { id: existing.id },
        data: {
          region: preset.region,
          currency: preset.currency,
          feeFormula: preset.feeFormula,
        },
      });
      updated++;
    } else {
      await prisma.brokerPreset.create({
        data: {
          name: preset.name,
          region: preset.region,
          currency: preset.currency,
          feeFormula: preset.feeFormula,
          isBuiltIn: true,
          userId: null,
        },
      });
      created++;
    }
  }

  console.log(`✓ Broker presets seeded: ${created} created, ${updated} updated`);
}

main()
  .catch((e) => {
    console.error("[seed-broker-presets] failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
