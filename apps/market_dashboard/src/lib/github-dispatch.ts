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
const WORKFLOW_FILE = "refresh_brief_provider.yml";

export interface DispatchResult {
  ok: boolean;
  status: number;
  error?: string;
}

export function isDispatchConfigured(): boolean {
  return Boolean(process.env.GH_DISPATCH_TOKEN);
}

export async function dispatchBriefRefresh(provider: string): Promise<DispatchResult> {
  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) return { ok: false, status: 0, error: "GH_DISPATCH_TOKEN not set" };
  const repo = process.env.GH_DISPATCH_REPO || DEFAULT_REPO;
  const ref = process.env.GH_DISPATCH_REF || "main";

  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
          "User-Agent": "market-dashboard-refresh",
        },
        body: JSON.stringify({ ref, inputs: { provider } }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    // GitHub returns 204 No Content on a successful dispatch.
    if (res.status === 204) return { ok: true, status: 204 };
    const body = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: body.slice(0, 300) || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
