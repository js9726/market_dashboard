#!/usr/bin/env node
/**
 * Create (or update) the operator's IBKR broker account so the IBKR bridge can
 * sync. /api/bridge/sync matches incoming data by UserBrokerAccount.alias and
 * 404s until the row exists; the /dashboard/settings/brokers create-form is
 * gated behind NEXT_PUBLIC_FEATURE_BROKER_JOURNAL, so this script creates the
 * account directly (no feature-flag dependency).
 *
 * Idempotent: upserts on (userId, alias). Re-running is safe.
 *
 * Usage (from apps/market_dashboard/):
 *   node --env-file=.env.local scripts/create-ibkr-account.mjs --dry-run
 *   node --env-file=.env.local scripts/create-ibkr-account.mjs
 *   node --env-file=.env.local scripts/create-ibkr-account.mjs --account-id U1234567
 *   node --env-file=.env.local scripts/create-ibkr-account.mjs --alias "IBKR main" --preset "IBKR Fixed (US)"
 *
 * Env (loaded by --env-file=.env.local):
 *   DATABASE_URL   Required for Prisma client init
 *   OWNER_EMAIL    Default operator email if --user not given
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const DRY = process.argv.includes("--dry-run");
const ALIAS = arg("alias", "IBKR main");
const PRESET_NAME = arg("preset", "IBKR Tiered (US)");
const ACCOUNT_ID = arg("account-id", null); // IBKR account number (e.g. U1234567) — optional
const USER_EMAIL = arg("user", process.env.OWNER_EMAIL);

async function main() {
  if (!USER_EMAIL) throw new Error("No owner email — set OWNER_EMAIL or pass --user <email>");

  const owner = await prisma.user.findUnique({ where: { email: USER_EMAIL } });
  if (!owner) throw new Error(`User not found for email: ${USER_EMAIL}`);

  const preset = await prisma.brokerPreset.findFirst({
    where: { name: PRESET_NAME, OR: [{ isBuiltIn: true }, { userId: null }] },
  });
  if (!preset) {
    const all = await prisma.brokerPreset.findMany({ where: { isBuiltIn: true }, select: { name: true } });
    throw new Error(
      `Preset "${PRESET_NAME}" not found. Seeded presets: ${all.map((p) => p.name).join(", ")}`,
    );
  }

  const existing = await prisma.userBrokerAccount.findUnique({
    where: { userId_alias: { userId: owner.id, alias: ALIAS } },
  });

  console.log(`\nOwner:    ${owner.email} (${owner.id})`);
  console.log(`Preset:   ${preset.name} [${preset.region}/${preset.currency}] (${preset.id})`);
  console.log(`Alias:    ${ALIAS}`);
  console.log(`Account#: ${ACCOUNT_ID ?? "(none — matched by alias)"}`);
  console.log(`Action:   ${existing ? "UPDATE existing" : "CREATE new"} broker account`);

  // Bridge token check — IBKR reuses the same per-user token MooMoo uses.
  const token = await prisma.brokerBridgeToken.findUnique({ where: { userId: owner.id } });
  if (token) {
    console.log(
      `BridgeTok: present (label=${token.label ?? "—"}, lastHeartbeat=${token.lastHeartbeat?.toISOString() ?? "never"})`,
    );
  } else {
    console.log("BridgeTok: ⚠ NONE — generate one before running the bridge (same token works for IBKR + MooMoo).");
  }

  if (DRY) {
    console.log("\n[dry-run] No changes written.");
    return;
  }

  const account = await prisma.userBrokerAccount.upsert({
    where: { userId_alias: { userId: owner.id, alias: ALIAS } },
    update: {
      presetId: preset.id,
      isActive: true,
      isLive: true,
      ...(ACCOUNT_ID ? { brokerAccountId: ACCOUNT_ID } : {}),
      displayCurrency: "USD",
    },
    create: {
      userId: owner.id,
      presetId: preset.id,
      alias: ALIAS,
      isActive: true,
      isLive: true,
      brokerAccountId: ACCOUNT_ID ?? null,
      displayCurrency: "USD",
    },
  });

  console.log(`\n✓ ${existing ? "Updated" : "Created"} UserBrokerAccount ${account.id} (alias "${account.alias}").`);
  console.log("  Next: configure [ibkr] in dashboard-bridge.toml and run `python ibkr_bridge.py --post`.");
}

main()
  .catch((e) => {
    console.error("ERROR:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
