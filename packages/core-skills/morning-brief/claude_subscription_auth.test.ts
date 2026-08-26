import assert from "node:assert/strict";
import test from "node:test";
import { enforceClaudeSubscriptionOnly } from "./claude_subscription_auth.ts";

test("clears Anthropic API credentials while preserving Claude OAuth", () => {
  const env = {
    CLAUDE_CODE_OAUTH_TOKEN: "oauth",
    ANTHROPIC_API_KEY: "metered",
    ANTHROPIC_AUTH_TOKEN: "metered-token",
    ANTHROPIC_BASE_URL: "https://proxy.invalid",
  } as NodeJS.ProcessEnv;
  const result = enforceClaudeSubscriptionOnly(env);
  assert.equal(result.mode, "oauth");
  assert.deepEqual(result.clearedMeteredCredentials.sort(), [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
  ]);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "oauth");
});

test("uses CLI login mode when no OAuth token exists", () => {
  const env = {} as NodeJS.ProcessEnv;
  assert.equal(enforceClaudeSubscriptionOnly(env).mode, "cli-login");
});
