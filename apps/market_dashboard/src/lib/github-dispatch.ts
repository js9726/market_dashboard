/**
 * github-dispatch.ts — trigger the per-provider brief refresh workflow.
 *
 * The dashboard "Refresh Claude/Codex" buttons used a serverless metered-API
 * path with a condensed inline prompt (no wiki). For the subscription/wiki
 * providers we instead dispatch the GitHub Actions workflow
 * (refresh_brief_provider.yml), which runs the SAME wiki-grounded brief as the
 * daily pre-open job — Claude on the subscription, Codex/OpenAI via the wiki
 * morning_brief.py. Async: the brief lands when CI finishes and pushes to
 * /api/morning-verdict/ingest.
 *
 * Needs GH_DISPATCH_TOKEN (fine-grained PAT, Actions: read+write on the repo)
 * in the Vercel env. Absent → callers fall back to the serverless path.
 */

const DEFAULT_REPO = "js9726/market_dashboard";
const PROVIDER_WORKFLOW = "refresh_brief_provider.yml";
const CODEX_SELFHOSTED_WORKFLOW = "refresh_codex_selfhosted.yml";

export interface DispatchResult {
  ok: boolean;
  status: number;
  error?: string;
}

export function isDispatchConfigured(): boolean {
  return Boolean(process.env.GH_DISPATCH_TOKEN);
}

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "market-dashboard-refresh",
  };
}

/** Low-level workflow_dispatch. inputs may be empty for no-input workflows. */
async function dispatchWorkflow(
  workflowFile: string,
  inputs: Record<string, string> = {},
): Promise<DispatchResult> {
  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) return { ok: false, status: 0, error: "GH_DISPATCH_TOKEN not set" };
  const repo = process.env.GH_DISPATCH_REPO || DEFAULT_REPO;
  const ref = process.env.GH_DISPATCH_REF || "main";

  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${workflowFile}/dispatches`,
      {
        method: "POST",
        headers: { ...ghHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify(Object.keys(inputs).length ? { ref, inputs } : { ref }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (res.status === 204) return { ok: true, status: 204 };
    const body = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: body.slice(0, 300) || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function dispatchBriefRefresh(provider: string): Promise<DispatchResult> {
  return dispatchWorkflow(PROVIDER_WORKFLOW, { provider });
}

export async function dispatchCodexSelfHosted(): Promise<DispatchResult> {
  return dispatchWorkflow(CODEX_SELFHOSTED_WORKFLOW);
}

/**
 * True iff a self-hosted runner labelled `codex` is currently online — i.e. the
 * operator PC is up and can run the subscription Codex brief. Needs the token
 * to read runners (fine-grained: Administration:read, or classic repo scope).
 * On any error/permission denial returns false, so the caller safely falls back
 * to the cloud OpenAI-API path.
 */
export async function isCodexRunnerOnline(): Promise<boolean> {
  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) return false;
  const repo = process.env.GH_DISPATCH_REPO || DEFAULT_REPO;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/runners?per_page=100`, {
      headers: ghHeaders(token),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as {
      runners?: { status?: string; labels?: { name?: string }[] }[];
    };
    return (data.runners ?? []).some(
      (r) => r.status === "online" && (r.labels ?? []).some((l) => l.name === "codex"),
    );
  } catch {
    return false;
  }
}
