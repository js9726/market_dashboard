# Bot box - study notes

Personal study notes (2026-10-03). Part 1 explains PowerShell and when to pick each file
type. Part 2 walks through every file in this folder, with line ranges.

---

# Part 1 - PowerShell (.ps1) and choosing a file format

## What a .ps1 file is

A `.ps1` file is a **PowerShell script**. PowerShell is Microsoft's shell and scripting
language, built on .NET. It ships with every copy of Windows; this machine has **Windows
PowerShell 5.1** (`powershell.exe`). You run a script like this:

```
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-private-bot.ps1
```

- `-NoProfile`: skip your personal PowerShell start-up settings, so the script runs the same
  way every time.
- `-ExecutionPolicy Bypass`: Windows blocks unsigned scripts by default, and this allows
  this one run.

Related file types:
- `.psm1` is a PowerShell **module**: a library of functions that a script loads with
  `Import-Module`, like `lib/BotBoxStartup.psm1`.
- `.psd1` is a module's settings file (none in this folder).

## How the language reads

- **Variables** start with `$`: `$backoff = 15`.
- **Commands are Verb-Noun "cmdlets"**: `Get-Date`, `Test-Path`, `New-Item`, `Start-Sleep`.
- **Parameters** start with a dash: `Test-Path -Path $file`.
- **Pipelines pass objects, not text.** That's the big difference from bash:
  ```powershell
  Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'claude.exe' }
  ```
  Each `$_` is a full process object, so you can read `.Name` and `.CommandLine` directly
  instead of slicing text.
- **Comparisons are words**, not symbols: `-eq`, `-ne`, `-gt`, `-lt`, `-match` (regex), `-not`.
- **It can call .NET directly**: `[System.IO.File]::Open(...)`, `[Math]::Min(...)`.
- **It can run normal programs too**: `& claude --channels ...` or `git fetch`.

## Walking through start-private-bot.ps1

| Lines | Code | What it does |
|---|---|---|
| 1-31 | `<# .SYNOPSIS ... #>` | A block comment written as built-in help. `Get-Help .\start-private-bot.ps1` displays it. |
| 32 | `[CmdletBinding()]` | Makes the script behave like a built-in command (adds standard flags such as `-Verbose`). |
| 33-45 | `param( [string]$WikiRoot = ..., [switch]$NoChrome ...)` | The script's arguments. `[string]` and `[int]` are types; `[switch]` is an on/off flag (`-NoChrome` present means `$true`). `Join-Path $env:USERPROFILE '...'` gives a default value; `$env:` reads environment variables. |
| 47 | `$ErrorActionPreference = 'Continue'` | On an error, report it and keep going. The launcher must never die, so it doesn't use `'Stop'`. |
| 49 | `$Host.UI.RawUI.WindowTitle = '...'` | Sets the console window's title so the control panel can find the window. Wrapped in `try { } catch { }` so a failure is ignored. |
| 50 | `Split-Path -Parent $MyInvocation.MyCommand.Path` | The folder this script lives in, so paths work wherever you start it from. |
| 53-54 | `Import-Module (...psm1) -Force` | Loads the function libraries. `-Force` reloads them if they're already loaded. |
| 60 | `New-Item -ItemType Directory -Force ... \| Out-Null` | Creates the log folder (like `mkdir -p`). `Out-Null` throws away its output. |
| 62-68 | `function Write-BotLog { param(...) ... }` | A helper that adds a timestamped line to the log file (`Add-Content`) and prints it (`Write-Host`). `'{0:yyyy-MM-dd}' -f (Get-Date)` is string formatting, like Python's `.format`. |
| 73-77 | `if (Test-Path $marker) {...}`, `Get-Content -TotalCount 1`, `.Trim()` | Reads the first line of the "designated host" file and compares it with `$env:COMPUTERNAME`. `exit 1` stops the script with an error code. |
| 80 | `Enter-BotLauncherLock` | Comes from the module. It opens a lock file exclusively (`[System.IO.File]::Open(... FileShare::None)`) so a second launcher can't run. |
| 85-87 | `foreach ($f in @(...)) {...}` | `@(...)` builds an array; the loop checks each required path exists. |
| 90 | `[Environment]::GetEnvironmentVariable('Path','Machine')` | A .NET call that rebuilds PATH from the registry, so a newly installed `bun` is found. |
| 91-92 | `Get-Command claude -ErrorAction SilentlyContinue` | Is `claude` on PATH? (The equivalent of `which`.) `-ErrorAction SilentlyContinue` means "don't print an error if it isn't." |
| 94 | `Select-String -Path ... -Pattern '^DISCORD_BOT_TOKEN=.' -Quiet` | Like `grep -q`: true or false, the token is never printed. |
| 98 | `while ($true) { ... }` | The forever loop that keeps the bot alive. |
| 101 | `Get-CimInstance Win32_Process -Filter "Name='claude.exe'" \| Where-Object {...}` | Asks Windows for running processes and keeps any claude.exe that is a bot session (checked via its command line). |
| 109-115 | `$fresh = foreach (...) { ...; $r }` | A PowerShell idiom: whatever a loop outputs is collected into `$fresh`. `-NoPull:$NoPull` passes the switch's value on. |
| 128 | `(Get-Content -Raw $promptFile) + $notice ... -replace '"', "'"` | Reads the whole prompt file as one string and swaps `"` for `'`, because PowerShell 5.1 mangles double quotes in arguments to native programs. |
| 137-140 | `[pscustomobject]@{ started_at = ... }` | `@{}` is a hashtable (like a dict); `[pscustomobject]` turns it into an object, which `Write-BotJson` saves as JSON. |
| 142 | `Set-Location $WikiRoot` | The same as `cd`. |
| 144 | `$chromeArgs = if ($NoChrome) { @() } else { @('--chrome') }` | `if` returns a value, much like a ternary. |
| 146 | `& claude ... @chromeArgs ...` | `&` is the call operator for running a program. `@chromeArgs` "splats" the array into separate arguments (or none at all). |
| 147 | `$LASTEXITCODE` | The exit code of the last native program, here Claude. |
| 151 | `[Math]::Min($backoff * 2, $MaxBackoffSeconds)` | Doubles the restart delay up to a cap, then `Start-Sleep -Seconds $backoff`. |

## Why .ps1 here and not .py or .ts

Almost everything these scripts do is **Windows administration**:

- registering logon and hourly tasks (`Register-ScheduledTask`)
- reading registry and power settings (`HKLM:\...`, `powercfg`)
- listing and killing processes as objects (`Get-CimInstance`, `Stop-Process`)
- a hidden password prompt (`Read-Host -AsSecureString`)
- a desktop GUI (Windows Forms in `control-panel.ps1`)
- running `claude`, `git` and `gh` and checking their exit codes

PowerShell has all of this built in. It's already on every Windows machine (no Python or
Node install needed), and Task Scheduler can launch it directly. In Python, each of those
would need extra packages (`pywin32`, `psutil`) or wrapping PowerShell anyway.

Python is still used where it's the better fit in this same folder:
- **`tools/*.py`**: data and maths work (moomoo SDK, yfinance, pandas, Pillow), where the
  libraries exist only in Python.
- **`lib/botrun.py`**: needs careful, testable process isolation and works on any OS.

TypeScript (`.ts`) lives in the Next.js dashboard, because that code runs in the browser and
on Vercel servers.

## When to use which

| Use | When | Examples |
|---|---|---|
| **.ps1 / .psm1** | Windows-only automation: scheduled tasks, services, registry, processes, installers, launchers, quick admin GUIs | `install-private-bot.ps1`, `start-private-bot.ps1` |
| **.py** | Data processing, maths, calling APIs or SDKs, ML, scripts that should also run on Mac/Linux or in CI | `build_data.py`, `measure_tickers.py` |
| **.ts / .tsx** | Web apps: frontend UI, Next.js API routes, anything deployed to Vercel or run in Node | `apps/market_dashboard/src/...` |
| **.sh** (bash) | The same jobs as .ps1, but on Linux/macOS or in GitHub Actions runners | CI steps |
| **.json / .md** | Not code: configuration and documentation | `private-bot.settings.json`, `README.md` |

**Simple rule:** if the job is mostly about **telling Windows what to do**, use `.ps1`. If
it's mostly about **working on data**, use `.py`. If it's about **web pages or a web server**,
use `.ts`.

One caution: Windows PowerShell 5.1 has quirks that newer PowerShell 7 (`pwsh`) fixed, such
as the double-quote stripping on line 128. That's why these scripts include small
workarounds.

---

# Part 2 - Every file in packages/bot-box

## The big picture

An always-on Windows PC runs Claude Code as Jie's private Discord bot. The bot can only read
things. It can run programs only through one trusted runner, which runs the last committed
copy of each tool, never the working files. A launcher keeps the bot alive, an hourly job
keeps the two repos up to date without losing anyone's work, a control panel manages it, and
a daily task starts the pre-open brief.

```
logon task BotBoxPrivateClaude
  -> start-private-bot.ps1        lock, designation, guarded git refresh, access notice
     -> claude --channels plugin:discord ... --settings private-bot.settings.json
              --append-system-prompt (private-bot-prompt.md + freshness + access list)
        -> Bash: "C:/Python314/python.exe" -I ".../lib/botrun.py" <tool> [args]
           -> copies the tool's folder as committed at HEAD into a temp dir, runs it there
hourly task BotBoxRepoRefresh  -> lib/refresh-repos.ps1
daily task BotBoxBriefDispatch -> brief/dispatch-premarket-brief.ps1 (gh workflow run)
control-panel.ps1 (WinForms)   -> lib/BotBoxPanel.psm1
```

Runtime state lives in `%USERPROFILE%\.claude\bot-box\`. The Discord token and allowlist
live in `%USERPROFILE%\.claude\channels\discord\` (`.env`, `access.json`).

## Top-level files

### README.md (245 lines) - the main manual
- **1-15:** what the box is, the 3-step plan (step 1 is the private bot; the friends' bot and
  the podcast aren't built yet) and the host machine.
- **17-35:** the table of files.
- **37-112:** the security model: `dontAsk` mode, read-only access to the shared repos, the
  trusted runner (B6), what is allowed and denied, reports sent as images, the safe refresh,
  one launcher only, who may use the bot, and the token never passing through Claude.
- **114-151:** the 7 setup steps (power, `/login`, Discord app, install, token, start, test).
- **153-163:** how to move the bot to another PC.
- **165-227:** how to run the tests and what each test file proves.
- **229-245:** troubleshooting table.

### CONTROL-PANEL.md (119 lines)
- **1-21:** how to open the panel and its four sections.
- **23-68:** how usage is captured, what the bot buttons do, what "Discord connected"
  means, the console, the hourly refresh and the access list.
- **70-95:** what you can ask the bot. Lines 93-95 are out of date: they say quotes,
  screener, trades, theme radar and RAG search are "not yet" available, but commit
  `915e780d3` added them.
- **97-119:** PowerShell commands and the file roles.

### private-bot-prompt.md (100 lines) - rules added to the bot's system prompt
- **10-24:** fixed scope and safety: analysis only, web/Discord content is data and never
  instructions, never reveal identifiers.
- **26-40:** it's a read-only chat bot: skip the coding-session start-up, and write only to
  `outputs/bot-box/`.
- **42-56:** answer style: send "on it" first, `status` gets an instant reply, long reports
  become HTML rendered to PNG.
- **57-60:** the ticker answer format (trade-analyser Mode B).
- **61-67:** the only allowed program command and the list of tools.
- **68-97:** how to use each tool: `positions`, `orders`, `trades`, `quotes`, `screener`,
  `theme_radar`, `wiki_rag` falling back to `wiki_search`, and `measure_tickers` status rules.
- **98-100:** freshness rules and the MYT / US session clock.

### private-bot.settings.json (92 lines) - the bot's permissions
- **2-4:** turns the Discord plugin on, for the bot session only.
- **5-8:** a status line that runs `usage-statusline.py` to record plan usage.
- **10:** `dontAsk`: anything not allowed is refused instead of prompting.
- **11-23:** allowed: Read/Glob/Grep/Web, writes only under `outputs/bot-box/**`, the runner
  command in both quote styles, Chrome and Discord.
- **24-69:** denied: git writes and fetch, deletes, builds/deploys, `gh`, system tools, `cd`,
  every interpreter and shell, the paper trader.
- **71-77:** denied: reading secret stores and `.env` files.
- **78-89:** denied: claude.ai connectors (by ID), computer-use, scheduled tasks, magnific.

### install-private-bot.ps1 (146 lines) - one-time install
- **1-31:** help text and switches (`-InstallBun`, `-Uninstall`, `-NoChrome`).
- **39-48:** `Say` helper and the path of the "this PC is the bot box" marker (under
  `.claude`, not AppData, because of how the desktop app redirects AppData).
- **50-59:** `-Uninstall` removes the logon task and the marker.
- **61-100:** prerequisite checks: Claude >= 2.1.211, Bun (with optional winget install),
  Chrome, the Claude-in-Chrome host.
- **102-120:** installs the Discord plugin, then disables it for ordinary sessions and
  confirms that.
- **122-136:** writes the marker and registers the `BotBoxPrivateClaude` task, which runs
  the launcher at every sign-in and restarts it up to 3 times.
- **138-146:** prints your manual steps.

### configure-discord.ps1 (147 lines) - token and allowlist
- **1-39:** help text and parameters.
- **46-55:** `Write-EnvFile` writes LF-only line endings, because the plugin's parser breaks
  on CR.
- **59-66:** `-Clear` removes the token.
- **68-87:** checks the user and channel IDs are 17-20 digits.
- **89-105:** reads the token at a hidden prompt, checks its 3-part format and saves it with
  `DISCORD_ACCESS_MODE=static`.
- **107-134:** rebuilds `access.json`: keeps the channels already there (unless you pass new
  ones), makes every channel answer only your user ID, keeps each channel's
  `requireMention`, and removes pending pairing codes.
- **135-147:** prints the result and whether you need to restart.

### start-private-bot.ps1 (154 lines) - the launcher loop
See the line-by-line table in Part 1. In short: lock, then designation and prerequisite
checks; then loop forever: refuse if an orphaned bot is running, run the safe refresh on
both repos, build the prompt, start `claude`, and restart with a doubling backoff
(15 s up to 300 s, reset to 15 s after a run longer than 10 minutes).

### check-readiness.ps1 (220 lines) - read-only health report
- **25-56:** helpers: `Show-Row`, `Get-PowerIndex` (reads powercfg), `Test-Tool`,
  `Test-Port`.
- **58-81:** machine: RAM, laptop or desktop, bot-box designation.
- **83-99:** power: sleep, hibernate and lid action on AC, and whether it's on AC now.
- **101-113:** network: wired or Wi-Fi, and whether discord, anthropic, github and deepseek
  are reachable on port 443.
- **115-124:** Windows Update active hours, pending reboot, auto-login.
- **126-130:** free space on C:.
- **132-187:** software: git, gh, python, node, bun, claude versions; gh login; Chrome; the
  plugin installed but off for ordinary sessions; token plus a one-user allowlist; whether
  jie_wiki is trusted.
- **189-204:** repos on `main` and in sync with origin; the secrets folder exists.
- **206-214:** broker scheduled tasks, and whether OpenD (11111) and TWS (7496) are listening.
- **216-220:** summary.

### control-panel.ps1 (265 lines) - the WinForms window
- **13-31:** `-CreateShortcut` creates a desktop icon.
- **33-74:** sets up the form and UI helpers.
- **76-141:** builds the four boxes: Usage (progress bars), Bot (status plus
  Start/Restart/Stop/Console), Refresh (status, last result, Toggle/Run now), Access (list,
  add/remove, make owner, warning).
- **144-196:** `Update-Panel` reads usage, session info, task state, `refresh-status.json`
  and the access list.
- **198-248:** button handlers. Restart is `Stop-BotSession`, after which the launcher
  starts a new session. Stop also kills the launcher.
- **250-265:** a 15-second refresh timer. `-SmokeTest` prints what the window would show
  (with IDs masked) and exits.

## lib/

### lib/BotBoxStartup.psm1 (188) - launcher safety
- **15-29:** `Enter-BotLauncherLock`: an exclusive file handle. The OS releases it
  automatically if the process dies.
- **31-41:** `Invoke-BotGit`: runs git with prompts disabled and captures output.
- **43-49:** `Get-BotRepoIdentity`: the repo's git common directory, the same identity
  `agent_control.py` uses.
- **51-75:** `ConvertFrom-BotClaimListing`: combines the plain list (to get the
  active/pending state) with the JSON (to get the repos each claim covers).
- **77-95:** `Get-BotActiveClaimRepositories`: calls `agent_control.py list` twice. Any
  failure counts as "unsafe to touch the repos".
- **97-169:** `Update-BotRepo`. It needs a branch with an upstream, then fetches. If the repo
  isn't behind it's fresh. Otherwise it stops at the first problem: `-NoPull`, diverged,
  merge/rebase/cherry-pick in progress, failed claim check, unknown identity, an active
  claim, or a local change on an incoming path. If none apply it runs `merge --ff-only` and
  checks it's no longer behind.
- **171-185:** `Get-BotFreshnessNotice`: the "Repository freshness at launch" text, plus the
  STALE MODE paragraph when needed.

### lib/BotBoxPanel.psm1 (388) - the panel's logic and the refresher
- **20-52:** paths; `Read-BotJson`; `Write-BotJson` (writes a temp file then moves it,
  LF-only, no BOM).
- **55-63:** ID check; `ConvertTo-SafeLabel` (names are cleaned and capped at 40 characters
  because they go into the system prompt).
- **65-94:** `Get-BotAccess`: combines `access.json` with the labels to work out users,
  channels and owner. The owner is "recorded", or is inferred only when there is exactly one
  user.
- **96-159:** add, remove and set owner. You can't add anyone until the owner is set, the
  owner can't be removed, and the last user can't be removed. `Set-BotAccessIds` rewrites
  `allowFrom` for DMs and every channel.
- **161-192:** `Get-BotAccessNotice`: the "Who may command you" text appended to the prompt.
- **195-235:** reads `usage.json` into the 5-hour and 7-day windows (states ok/reset/none)
  and formats them.
- **238-307:** the process tree (BFS); `Test-BotDiscordPlugin` (is `bun.exe` running under the
  bot's claude.exe); `Get-BotSessionInfo`; `Test-BotPluginRestartNeeded` (3-minute grace);
  `Stop-BotSession` (kills the tree, optionally the launcher first).
- **309-341:** last activity, from the transcript's modified time; idle after 10 minutes;
  `Get-BotRestartReason` (a repo was pulled, or a repo that was STALE at launch is current
  again).
- **344-382:** defines, reads, enables and disables the hourly `BotBoxRepoRefresh` task.

### lib/refresh-repos.ps1 (130) - the hourly job
- **50-51:** its own lock.
- **53-60:** checks claims and runs the safe refresh on both repos.
- **62-82:** refreshes the wiki's Gemini RAG index with `store.py refresh` in the retrieval
  venv (only changed files are re-embedded) and parses the result.
- **83-87:** writes `refresh-status.json`.
- **89-99:** if the Discord plugin is missing more than 3 minutes after start, restarts the
  bot.
- **100-116:** decides whether a restart is needed, and keeps or clears
  `pending-restart.json`.
- **118-129:** restarts only if the bot has been idle 10 minutes and a launcher exists to
  start it again.

### lib/usage-statusline.py (108)
- **26-31:** state folder (can be overridden with an env var for tests).
- **34-43:** `clean_window` keeps only finite percentages and reset times.
- **46-61:** `update` keeps the last reading when the new input has no `rate_limits`.
- **64-68:** the status text.
- **71-84:** atomic write.
- **87-104:** `main` never fails the status line.

### lib/botrun.py (357) - the trusted runner, the core of the security model
- **46-53:** roots are worked out from the file's own location; the ticker regex; which file
  types count as code.
- **56-112:** argument validators: choice, regex, number range, ISO date, data folder (must
  be inside a repo, passed on as an absolute path), free text (<= limit, no control
  characters).
- **114-156:** the `TOOLS` table, which maps each tool name to (repo, script, option schema,
  required options). Tools: measure_tickers, breadth_ma, market_edge, industry_proxies,
  lint_wiki, carry_forward, positions, wiki_search, wiki_rag, quotes, trades, screener,
  theme_radar, orders, render_report.
- **157-176:** `REPEATABLE`; `FIXED_ARGS`, which the runner adds itself (wiki root,
  keyword-only search, the RAG index with `--no-repair`, the canonical screener config, the
  output root); `POSITIONAL` (the question goes last, after `--`); `INTERPRETERS` (the
  retrieval venv's Python).
- **179-213:** `validate_args`: unknown option, duplicate, value starting with `-`, or
  missing required option are all refused.
- **216-224:** `_git` drops `GIT_*` variables and uses `--no-replace-objects`.
- **227-269:** `snapshot`: lists HEAD's files in the tool's folder with `ls-tree`. Only code
  files are kept; a symlink or submodule is refused, and so is a tool missing from the last
  commit. Contents are read with `cat-file --batch` into the temp folder.
- **272-312:** `child_environment` removes `PYTHON*` variables. `run_tool` runs
  `python -E -B -X pycache_prefix=<temp> <copy>` from the copy's folder with empty stdin.
- **315-328:** `check_all` preflight (exit 2 if any tool is refused).
- **331-353:** command line: `--help`, `--list`, `--check-all`, `--check <tool>`. A refusal
  prints `BOTRUN REFUSED` and exits 2.

## tools/ - what the bot can run

### tools/opend_common.py (118)
- Host, port, timeouts, and the real stdout saved before anything redirects it.
- `emit`; `unavailable` (exit 3); `number` (non-finite becomes None); the port check; SDK
  output sent to stderr.
- `global_state` (quotes, and trading if needed, must be logged in); `live_account` (requires
  exactly one real US account and never prints its ID).
- `run`: runs the read in a worker thread with a 45 s watchdog, and uses `os._exit` if the
  SDK hangs.

### tools/positions.py (80)
- **32-50:** `position_row`: any invalid broker value turns the row into `INVALID_DATA` with
  nulls.
- **53-67:** reads positions from the real account and drops rows with zero quantity.
- **70-76:** output.

### tools/orders.py (112)
- Working statuses, stop types, `order_row`.
- `coverage`: unfilled SELL stop/trailing quantity against shares held gives COVERED,
  PARTIAL or NONE. A take-profit limit is not a stop.
- Reads orders and positions; output.

### tools/quotes.py (106)
- Age in ET; pre-market and after-hours fields; a row is STALE if it's more than 10 minutes
  old during regular hours, INVALID_DATA if the price is <= 0.
- Snapshot, retried one ticker at a time if a bad symbol fails the whole batch.
- Command line and output.

### tools/trades.py (154)
- Turns deals into fills; spreads each order's fee across its fills by quantity.
- FIFO realized P&L. A sell whose buy is older than the 360-day history gets null with a
  reason, never an estimate.
- Fetches 360 days of deals plus fees (in batches of 50); totals per currency.

### tools/screener.py (106)
- TradingView scanner URL, headers, and field names.
- POST with one retry on 429/5xx. Each screener gets its own status, so one failure doesn't
  hide the others.
- `--config` is always the canonical file, passed by the runner. Overall status is OK,
  PARTIAL or UNAVAILABLE (exit 3).

### tools/measure_tickers.py (560)
- **55-83:** gate thresholds (volume 1.5x, extension veto 2.5 ATR, combined 1.5 ATR plus
  base > 18%, and others); history lengths; the 20-minute finalization buffer; special
  closures.
- **87-177:** NYSE calendar: Easter, holiday rules, early closes, the expected last
  completed session.
- **181-234:** data from OpenD (futu) or Yahoo; yfinance output kept off stdout.
- **238-308:** bar checks (finite, positive, consistent highs and lows); splitting completed
  bars from the live bar; freshness and 60-session alignment checks.
- **312-453:** EMA, ATR, returns; `measure` computes the 8 gates, stop candidates, relative
  strength vs SPY, triggers, and the live partial bar shown as context only.
- **461-556:** the cutoff is fixed before fetching; if SPY is unusable, exit 3; each row gets
  a status; JSON is strict (exit 4 on any NaN).

### tools/render_report.py (213)
- Sizes, browser paths, a strict CSP, the file-name pattern.
- `resolve_inside` refuses `..`, symlinks and junctions, anything outside the root, and files
  over 5 MB.
- A one-file HTTP server on 127.0.0.1 with the CSP.
- Headless Edge or Chrome with a dead proxy and a throwaway profile; waits until the
  screenshot file stops growing; trims empty space at the bottom.
- Renders and writes the PNG atomically. Exit codes: 0 OK, 2 REFUSED, 3 FAILED.

## brief/ - the pre-open brief dispatch

- **BriefDispatch.psm1:** **20-33** decides whether a dispatch is due (weekday, 08:30-09:15
  ET, once per ET date, or `-Force`). **35-44** works out trigger times for both US clock
  seasons; in MYT that's 20:40 and 21:40. **46-64** registers and unregisters the
  `BotBoxBriefDispatch` task.
- **dispatch-premarket-brief.ps1:** `-Install` and `-Uninstall`; reads
  `brief-dispatch.json`; when due, runs `gh workflow run refresh_premarket.yml` and records
  the date. It exists because GitHub's schedule was starting the run 4.5-7 hours late.
- **set-brief-webhook.ps1:** reads the #j_asistant webhook URL at a hidden prompt, checks
  its format, pipes it into `gh secret set DISCORD_BRIEF_WEBHOOK_URL`, and with `-SendTest`
  posts a test message.
- **Test-BriefDispatch.ps1:** 10 offline checks covering the time window, both clock
  seasons, weekends, once-per-day and the MYT trigger times.

## tests/ and lib/tests/ (all offline unless noted)

| File | Proves |
|---|---|
| tests/test_settings_policy.py | Settings stay locked down: `dontAsk`, the runner is the only program rule, the prompt shows the same command, cd/shells/interpreters denied, every runner tool is on the write-free list, writes only to scratch, LF-only JSON |
| tests/test_botrun.py | Runner isolation, using throwaway git repos: only committed copies run; no injection via env vars, scratch files, links or junctions; each tool's argument schema; the fixed args |
| tests/test_measure_tickers.py | Review findings B1-B4: no file writes, freshness and alignment, NaN and stop-validity rules, the NYSE calendar |
| tests/test_opend_tools.py | Uses a fake `moomoo` package and a fake socket: no identifiers printed, fails closed, watchdog, FIFO, stop coverage, and an AST check that no trading functions are called |
| tests/test_screener.py | Fake `send`: one screener failing doesn't hide the others, no cookie or file writes, the canonical config has the needed fields |
| tests/test_render_report.py | Paths stay confined, the server serves only the report, trimming, and a live test that local files can't leak into the image |
| tests/accept_host_policy.py | **Not offline.** A real `claude -p` session with 15 steps, scored only from the event stream, the CLI exit code and the filesystem (PASS / FAIL / INCONCLUSIVE) |
| tests/test_accept_scoring.py | The acceptance scorer above never passes when evidence is missing or tampered with |
| tests/Test-BotBoxStartup.ps1 | The safe refresh in every blocking case, the lock, and the launcher preflight |
| tests/Test-ConfigureDiscord.ps1 | `access.json` handling, run against a throwaway USERPROFILE (the real file is hashed to prove it wasn't touched) |
| lib/tests/Test-BotBoxPanel.ps1 | Access edits, the prompt notice, usage reading, restart decisions, process tree, task definition |
| lib/tests/test_usage_statusline.py | Usage recording, and the status line never breaking |

The `__pycache__/` folders are leftover Python bytecode, not tracked in git. You can ignore
them.

## Documentation gaps noticed (2026-10-03, not yet fixed)

1. CONTROL-PANEL.md lines 93-95 still say the gate-3 tools aren't available, but they are now.
2. README.md doesn't list the `brief/` folder or `Test-BriefDispatch.ps1`.
3. check-readiness.ps1 line 211 points to "README step B", which doesn't exist.
4. install-private-bot.ps1 line 141 leaves out the "Send Messages in Threads" permission
   that the README lists.
