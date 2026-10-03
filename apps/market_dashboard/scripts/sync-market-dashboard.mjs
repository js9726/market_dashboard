/** Copy canonical backend artifacts to the public fallback without time regression.
 * Invalid JSON fails before any write; strings such as "NaN" are never rewritten.
 * Generation timestamps are preserved. Run the freshness gate after this copy.
 */
import { readdir, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const stampKeys = ["built_at", "fetched_at", "as_of", "generated_at", "generatedAt"];
function parseArtifact(text) {
  return JSON.parse(text, (_key, value) => {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new SyntaxError("Non-finite JSON number");
    }
    return value;
  });
}
function stamp(data) {
  for (const key of stampKeys) {
    if (typeof data?.[key] === "string") {
      const value = Date.parse(data[key]);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}
async function files(dir, prefix = "") {
  const result = [];
  for (const entry of await readdir(join(dir, prefix), { withFileTypes: true })) {
    const rel = join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing symlink artifact: ${rel}`);
    if (entry.isDirectory()) result.push(...await files(dir, rel));
    else if (entry.isFile()) result.push(rel);
  }
  return result;
}
export async function syncMarket(srcDir, destDir) {
  const pending = [];
  for (const rel of await files(srcDir)) {
    const bytes = await readFile(join(srcDir, rel));
    if (rel.endsWith(".json")) {
      const source = parseArtifact(bytes.toString("utf8"));
      let existing;
      try { existing = parseArtifact(await readFile(join(destDir, rel), "utf8")); }
      catch (err) { if (err.code !== "ENOENT") throw err; }
      const oldStamp = stamp(existing), newStamp = stamp(source);
      if (oldStamp !== null && (newStamp === null || newStamp < oldStamp)) {
        throw new Error(`Refusing older/undated source over newer public artifact: ${rel}`);
      }
    }
    pending.push([rel, bytes]);
  }
  // Preflight all files before changing any consumer artifact.
  for (const [rel, bytes] of pending) {
    const target = join(destDir, rel);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  return pending.length;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  syncMarket(join(root, "..", "market_dashboard_backend", "data"), join(root, "public", "market-dashboard"))
    .then(count => console.log(`Synced ${count} validated artifacts; original timestamps retained.`))
    .catch(err => { console.error(err.message); process.exitCode = 1; });
}
