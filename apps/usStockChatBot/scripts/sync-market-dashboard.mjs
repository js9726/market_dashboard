/**
 * Copies apps/market_dashboard/data (JSON + charts) into public/market-dashboard/
 * so the Next app can load /market-dashboard/*.json (works with static export).
 *
 * Run from apps/usStockChatBot: npm run sync:market
 * Or after refreshing data: cd ../market_dashboard && python scripts/build_data.py --out-dir data
 */
import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const srcDir = join(root, "..", "market_dashboard", "data");
const destDir = join(root, "public", "market-dashboard");

async function main() {
  await mkdir(destDir, { recursive: true });
  await cp(srcDir, destDir, { recursive: true });
  console.log(`Synced ${srcDir} -> ${destDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
