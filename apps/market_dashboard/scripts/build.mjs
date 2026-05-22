#!/usr/bin/env node
import { spawnSync } from "node:child_process";

function run(label, args, opts = {}) {
  console.log(`[build] ${label}`);
  const command = process.platform === "win32" ? "cmd.exe" : "npx";
  const commandArgs =
    process.platform === "win32" ? ["/d", "/s", "/c", "npx.cmd", ...args] : args;
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
  ["prisma", "migrate", "resolve", "--rolled-back", "20260426000000_add_trade_plan_and_verdict_fields"],
  { allowFailure: true },
);
run("apply migrations", ["prisma", "migrate", "deploy"]);
run("next build", ["next", "build"]);
