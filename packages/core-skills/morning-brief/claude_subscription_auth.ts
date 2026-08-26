/** Enforce the boundary between Claude Code subscription auth and API billing. */
export interface ClaudeSubscriptionAuth {
  mode: "oauth" | "cli-login";
  clearedMeteredCredentials: string[];
}

const METERED_ANTHROPIC_ENV = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
] as const;

export function enforceClaudeSubscriptionOnly(
  env: NodeJS.ProcessEnv = process.env,
): ClaudeSubscriptionAuth {
  const clearedMeteredCredentials: string[] = [];
  for (const key of METERED_ANTHROPIC_ENV) {
    if (env[key]) clearedMeteredCredentials.push(key);
    delete env[key];
  }
  return {
    mode: env.CLAUDE_CODE_OAUTH_TOKEN ? "oauth" : "cli-login",
    clearedMeteredCredentials,
  };
}
