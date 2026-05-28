#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const isWindows = process.platform === "win32";

function localBin(name) {
  return join(process.cwd(), "node_modules", ".bin", isWindows ? `${name}.cmd` : name);
}

function run(label, binName, args, opts = {}) {
  console.log(`[build] ${label}`);

  const binPath = localBin(binName);
  if (!existsSync(binPath)) {
    console.error(`[build] Missing local ${binName} binary at ${binPath}`);
    console.error("[build] Run npm install or npm ci before npm run build.");
    process.exit(1);
  }

  const command = isWindows ? "cmd.exe" : binPath;
  const commandArgs = isWindows ? ["/d", "/s", "/c", `"${binPath}"`, ...args] : args;
  const result = spawnSync(command, commandArgs, { stdio: "inherit", shell: false });
  if (result.error) {
    console.error(`[build] ${label} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0 && !opts.allowFailure) {
    process.exit(result.status ?? 1);
  }
}

run(
  "mark rolled-back migration if present",
  "prisma",
  ["migrate", "resolve", "--rolled-back", "20260426000000_add_trade_plan_and_verdict_fields"],
  { allowFailure: true },
);
run("apply migrations", "prisma", ["migrate", "deploy"]);
run("next build", "next", ["build"]);
