/**
 * Copies apps/market_dashboard/data (JSON + charts) into public/market-dashboard/
 * so the Next app can load /market-dashboard/*.json (works with static export).
 *
 * Run from apps/usStockChatBot: npm run sync:market
 * Or after refreshing data: cd ../market_dashboard && python scripts/build_data.py --out-dir data
 *
 * Also sanitizes JSON files: replaces bare NaN / Infinity tokens (Python artefacts)
 * with null so browsers can parse them correctly.
 */
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const srcDir = join(root, "..", "market_dashboard", "data");
const destDir = join(root, "public", "market-dashboard");

async function sanitizeJsonFiles(dir) {
  let fixed = 0;
  let total = 0;
  for await (const entry of glob("**/*.json", { cwd: dir })) {
    const filePath = join(dir, entry);
    const raw = await readFile(filePath, "utf8");
    // Replace bare NaN / Infinity tokens that Python's json module can emit
    const sanitized = raw
      .replace(/\bNaN\b/g, "null")
      .replace(/\bInfinity\b/g, "null")
      .replace(/\b-Infinity\b/g, "null");
    if (sanitized !== raw) {
      await writeFile(filePath, sanitized, "utf8");
      const count = (raw.match(/\bNaN\b|\bInfinity\b|\b-Infinity\b/g) || []).length;
      console.log(`  sanitized ${entry} (${count} token(s) replaced)`);
      fixed++;
    }
    total++;
  }
  if (fixed === 0) console.log(`  all ${total} JSON file(s) already clean`);
}

async function main() {
  await mkdir(destDir, { recursive: true });
  await cp(srcDir, destDir, { recursive: true });
  console.log(`Synced ${srcDir} -> ${destDir}`);
  console.log("Sanitizing JSON files...");
  await sanitizeJsonFiles(destDir);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
