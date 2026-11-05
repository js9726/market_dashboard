# CLAUDE.md - packages/bot-box

Guidance for coding sessions that change this folder. The parent `market_dashboard/CLAUDE.md`
and the cross-agent claim protocol still apply. `README.md` (setup, security model, tests)
and `CONTROL-PANEL.md` (panel, hourly refresh, access list) are the user-facing docs; keep
them in step with any behaviour change.

## What this is

An always-on Windows PC ("bot box", interim host `WALPLUS-ASUS`) runs Claude Code as Jie's
private Discord bot. The bot is a **read-only chat session**, not a coding session: it runs
in `jie_wiki` with `market_dashboard` added, under `dontAsk` permissions, and may run
programs only through one trusted runner.

```
logon task BotBoxPrivateClaude
  -> start-private-bot.ps1        lock, designation, guarded git refresh, access notice
     -> claude --channels plugin:discord ... --settings private-bot.settings.json
              --append-system-prompt (private-bot-prompt.md + freshness + access list)
        -> Bash: "C:/Python314/python.exe" -I ".../lib/botrun.py" <tool> [args]
           -> copies the tool's folder as committed at HEAD into a temp dir, runs it there
hourly task BotBoxRepoRefresh -> lib/refresh-repos.ps1 (same guarded refresh, RAG index,
                                  idle restart)
daily task BotBoxBriefDispatch -> brief/dispatch-premarket-brief.ps1 (gh workflow run)
control-panel.ps1 (WinForms) -> lib/BotBoxPanel.psm1
```

Runtime state lives in `%USERPROFILE%\.claude\bot-box\` (never AppData: the Claude desktop
app's MSIX packaging redirects AppData writes). Discord token and allowlist live in
`%USERPROFILE%\.claude\channels\discord\` (`.env`, `access.json`).

## Commands (run from `market_dashboard/`)

```
python -m unittest discover -s packages/bot-box/tests -v
python -m unittest discover -s packages/bot-box/lib/tests -v
python -m unittest discover -s packages/bot-box/tests -p "test_botrun.py" -k wiki_search -v   # one case
powershell -NoProfile -ExecutionPolicy Bypass -File packages\bot-box\tests\Test-BotBoxStartup.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File packages\bot-box\tests\Test-ConfigureDiscord.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File packages\bot-box\lib\tests\Test-BotBoxPanel.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File packages\bot-box\brief\Test-BriefDispatch.ps1

"C:/Python314/python.exe" -I packages/bot-box/lib/botrun.py --list        # tools and options
"C:/Python314/python.exe" -I packages/bot-box/lib/botrun.py --check-all   # preflight, runs nothing
powershell -NoProfile -ExecutionPolicy Bypass -File packages\bot-box\start-private-bot.ps1 -PreflightOnly  # only while the bot is stopped
```

All suites are offline (no Claude, Discord, broker or network). `tests/accept_host_policy.py`
is the exception: it runs a real `claude -p` session and spends plan usage; run it after any
change to `private-bot.settings.json` or `lib/botrun.py`
(`python packages/bot-box/tests/accept_host_policy.py --model haiku --output receipt.json`).

## Invariants - do not weaken without Jie's explicit decision

- **The runner commits-only rule.** `botrun.py` runs a tool only from a copy of its folder
  at HEAD read from Git's object store. A new or edited tool is unavailable to the bot until
  it is committed. Never make the runner execute from the working tree.
- **Every runner tool is write-free**, except `render_report` (one PNG inside
  `jie_wiki/outputs/bot-box`, root fixed by the runner). Tools print one JSON object to
  stdout; no output-path options. SDK/library chatter goes to stderr.
- **Adding a tool** means: entry in `TOOLS` (repo, script, per-option validator, required
  options), any `FIXED_ARGS`, the reviewed write-free list in `tests/test_settings_policy.py`,
  cases in `tests/test_botrun.py`, the tool list in `private-bot-prompt.md`, and the README.
- **Permissions.** The only program allow rule is the absolute runner command (both quote
  styles). `cd`, interpreters and shells stay denied; no blanket `Bash`. The bot writes only
  to `outputs/bot-box/**`. `tests/test_settings_policy.py` pins this.
- **Broker tools are read-only and fail closed.** OpenD tools go through
  `tools/opend_common.run()` (port check, 45 s watchdog, `UNAVAILABLE` exit 3). The only
  trade-context calls allowed are `get_acc_list`, `position_list_query`,
  `order_list_query`, `history_deal_list_query`, `order_fee_query`, `close`
  (`tests/test_opend_tools.py` parses the sources). Never print account, card, order or deal
  numbers or account totals; never recompute broker values.
- **Measurements never guess.** `measure_tickers.py` fixes the cutoff before fetching, uses
  only completed bars aligned to the NYSE calendar, emits strict JSON (no NaN), and an
  uncomputable gate is `UNKNOWN`, never `PASS`. New unscheduled exchange closures go in
  `SPECIAL_CLOSURES`.
- **Guarded refresh never loses work.** `Update-BotRepo` only fast-forwards, and only with
  no divergence, no merge/rebase in progress, no active agent claim on the repo and no
  local change on an incoming path. It never resets, stashes, checks out or cleans.
- **The Discord token never passes through Claude**: it is entered at a hidden PowerShell
  prompt. Static access mode; the plugin is disabled for ordinary sessions.
- **Machine-specific paths** (`C:/Python314/python.exe`, the absolute runner path) appear in
  `private-bot.settings.json` and `private-bot-prompt.md`; `test_settings_policy.py`
  checks they match. Update both together when moving PCs.

## Conventions

- PowerShell 5.1 (`Set-StrictMode -Version 2` in modules); logic lives in `.psm1` modules so
  it can be tested offline, scripts stay thin. JSON state files are written LF-only, UTF-8
  without BOM, via temp file + move (`Write-BotJson`).
- Python tools use only the stdlib plus libraries already in user site-packages (moomoo /
  futu, yfinance, Pillow); they run with `-E -B` and no `PYTHON*` variables, so they cannot
  rely on `PYTHONPATH` or the cwd beyond their own copied folder.
- Tests that weaken code for mutation checks point an env var (`ACCEPT_SCORER_UNDER_TEST`,
  `SCREENER_UNDER_TEST`, `CONFIGURE_UNDER_TEST`) at a copy; never edit the real file to do it.
- Docs are dated decisions ("Jie, 2026-09-29"); record the date and who decided when you
  change a policy.
