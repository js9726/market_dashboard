import fs from "node:fs";
import path from "node:path";

type Provider = "deepseek" | "gemini" | "openai" | "claude";

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
}

loadEnvFile(path.join(process.cwd(), ".env.local"));
loadEnvFile(path.join(process.cwd(), ".env"));

const provider = (process.argv[2] ?? "deepseek") as Provider;
if (!["deepseek", "gemini", "openai", "claude"].includes(provider)) {
  throw new Error(`Unsupported provider: ${provider}`);
}

async function main() {
  const [{ bucketOf }, { regenAndStore, readBucket }] = await Promise.all([
    import("../src/lib/brief/bucket"),
    import("../src/server/brief-cache"),
  ]);

  const bucket = bucketOf();
  await regenAndStore({ bucket, provider, generatedBy: "codex-local" });

  const row = (await readBucket(bucket)).find((candidate) => candidate.provider === provider);
  if (!row) {
    throw new Error(`No ${provider} row was written for ${bucket.toISOString()}`);
  }

  console.log(
    JSON.stringify(
      {
        provider,
        bucketAt: bucket.toISOString(),
        generatedAt: row.generatedAt.toISOString(),
        error: row.errorMsg,
        hasStructured: row.structuredJson != null,
        hasVerdict: row.verdictJson != null,
        htmlLength: row.htmlBody.length,
        tokensIn: row.tokensIn,
        tokensOut: row.tokensOut,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
