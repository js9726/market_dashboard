# Self-Hosted Codex Brief Runner

Generates the **Codex** dashboard tab on your **ChatGPT/Codex subscription**
(not the metered OpenAI API) by running `codex exec` on a GitHub Actions
**self-hosted runner** on your PC — the only place your live Codex auth exists.

> **Why self-hosted:** the Codex CLI is a stateful desktop binary with rotating
> OAuth tokens. It can't run on a GitHub-hosted Linux runner. The runner has to
> be the machine where you ran `codex login`.

## Prerequisites
- Codex CLI logged in on this PC (`codex login`) **with workspace credits**.
  Verify: `codex exec --skip-git-repo-check -c model_reasoning_effort="low" "say hi"`.
  If it says *"workspace is out of credits"*, refill before this can produce a brief.
- Python + Node on PATH (you already run the pipeline here).

## One-time: install the runner
1. GitHub → `js9726/market_dashboard` → **Settings → Actions → Runners → New self-hosted runner** → Windows.
2. Follow the download/config commands it shows. When it asks for **labels**, add **`codex`** (the workflow targets `runs-on: [self-hosted, codex]`).
3. Run it as a service so it survives reboots:
   ```powershell
   ./run.cmd            # foreground test first
   # then, from an elevated shell, install the service:
   ./svc.sh install     # or: ./svc install  (Windows runner ships svc.cmd)
   ./svc.sh start
   ```
4. Confirm it shows **Idle** under Settings → Actions → Runners.

## Trigger
- **Manual:** Actions → *Refresh Codex Brief (self-hosted, subscription)* → Run workflow.
- **Scheduled:** weekdays ~09:05 ET (`5 13 * * 1-5`) — only runs when the PC + runner are online.

The job refreshes data (build_data + screeners + index technicals), then runs
`npm run brief:codex` which calls `codex exec` and pushes the StructuredBrief to
`/api/morning-verdict/ingest` as the Codex tab.

## Knobs (workflow env)
- `CODEX_REASONING` — reasoning effort (`low`/`medium`/`high`, default `medium`).
- `CODEX_MODEL` — model override (defaults to your `~/.codex/config.toml`).
- `CODEX_EXE` — explicit path to `codex.exe` if auto-resolve fails. The runner
  resolves it via `CODEX_EXE` → PATH → `%LOCALAPPDATA%\OpenAI\Codex\bin\*\codex.exe`.

## Notes
- The runner pushes to the **same** `BRIEF_INGEST_KEY` ingest endpoint as the
  other providers; no `CODEX_AUTH_JSON` secret is needed (auth is the live local
  `~/.codex`). You can delete that secret if it was added for the cloud attempt.
- The dashboard **Refresh Codex** button still dispatches the cloud
  `refresh_brief_provider.yml` (OpenAI API) as the always-available fallback;
  this self-hosted job is the subscription path that runs when your PC is on.
- The brief follows the same wiki rubric + ≤4-search budget as the Claude path.
