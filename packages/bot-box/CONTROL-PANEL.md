# Bot box control panel

A small window on the bot box for the four things you change or check most. Everything is
local to this PC: no server, no port, nothing sent anywhere.

```
powershell -NoProfile -ExecutionPolicy Bypass -File .\control-panel.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\control-panel.ps1 -CreateShortcut   # desktop icon
powershell -NoProfile -ExecutionPolicy Bypass -File .\control-panel.ps1 -SmokeTest        # print, no window
```

The window refreshes itself every 15 seconds.

## Sections

| Section | Shows | Buttons |
|---|---|---|
| Claude subscription usage | 5-hour and 7-day limits: % used, % left, reset time | none |
| Private bot | Running since / not running; Discord connected / NOT connected | Start, Restart, Stop, Show console |
| Hourly repo refresh | On/off, next run, last result per repository | Turn on / Turn off, Run now |
| Who can command the bot | Owner and every allowed Discord user | Add, Remove selected, Make selected owner |

**Usage.** Claude Code exposes the subscription limits only to a session's status line, so
the bot's settings run `lib/usage-statusline.py`, which saves the latest reading to
`%USERPROFILE%\.claude\bot-box\usage.json`. The numbers are for your whole account (your own
Claude sessions count too), they appear only after the bot has replied once since it
started, and they update when the bot replies. "Window reset, no reading since" means that
limit has reset and the bot has not replied since.

**Bot buttons.** Restart ends the bot's Claude session and its Discord plugin; the launcher
starts a fresh one about 15 seconds later. Stop also ends the launcher, so the bot stays off
until Start or your next sign-in.

**Discord connected** means the Discord plugin (`bun.exe`) is running under the bot's Claude
process. "NOT connected" while the bot is running means it can neither receive nor answer
messages: press Restart. The hourly refresh also restarts a bot whose plugin is still missing
3 minutes after it started.

**The bot console** is the PowerShell window the logon task opens, titled
`BOT BOX - private Discord bot (closing this window stops the bot)`. Show console brings it to
the front. Leave it open (minimising is fine): closing it stops the bot. If Claude Code ever
asks a question there, the bot waits until you answer it.

**Hourly refresh.** Turn on registers the scheduled task `BotBoxRepoRefresh`: every hour
while you are signed in it runs `lib/refresh-repos.ps1`, the launcher's guarded update
(fetch, then fast-forward only when nothing can be lost or collide; never reset, stash or
clean). If a repository was updated, or one the bot started STALE is current again, it
restarts the bot once the bot has handled no message for 10 minutes. A repository that has
diverged from GitHub, or that an agent has an active claim on, stays STALE until that is
resolved in a coding session; the refresh reports it and never forces it. Each run then
brings the wiki's Gemini RAG index up to date, re-embedding only the files that changed (the
bot's `wiki_rag` search refuses a stale index; a fraction of a cent per run, and the changed
files' text goes to Google). Log:
`%USERPROFILE%\.claude\bot-box\logs\refresh-YYYYMMDD.log`.

**Access.** Jie chose on 2026-09-29 to let other people command the bot. Adding someone
writes their Discord user ID into the plugin's `access.json` for DMs and every configured
channel; the name is kept in `access-labels.json`. Changes apply after Restart (the plugin
reads the list only when it starts). The launcher tells the bot who is on the list, and:

- everyone listed may give the bot requests, within all its other rules;
- everyone listed may see Jie's positions, P&L, fills and trades (Jie, 2026-09-29), in DMs
  and in #j_asistant;
- account numbers, account totals, credentials and tokens are never shared with anyone.

Everyone you add uses **your** Claude subscription, and claude.ai consumer plans are for
personal use. `configure-discord.ps1` rewrites the list to its `-UserId` only, so re-running it
removes everyone you added here.

## What you can ask the bot

In a DM or in #j_asistant; no @mention needed. Everyone on the access list can ask all of these.

| Ask for | Example | Uses |
|---|---|---|
| Health | `status` or `ping` | instant reply: online, date |
| Positions and P&L | `my positions`, `P&L today` | `positions`: live moomoo via OpenD (OpenD must be running); no IBKR, no account totals |
| A ticker | `analyse VEEV`, `VEEV vs CRM, NOW` | `measure_tickers` (completed bars, gates, stops) plus web research; capped at WATCH without a chart |
| Market breadth | `market breadth` | `breadth_ma`: share of stocks above their moving averages |
| Market edge checklist | `market edge`, `edge for NVDA` | `market_edge` (with `--ticker` for one name) |
| Industry strength | `industry proxies` | `industry_proxies` via OpenD |
| Your own rules and notes | `what's my rule on extension?`, `what did we decide about X?` | `wiki_search`, answered with file:line citations |
| Screener carry-forward | `carry forward yesterday's candidates` | `carry_forward` (needs a dated verdicts folder) |
| Wiki health | `lint the wiki` | `lint_wiki` |
| News and research | `latest news on PLTR` | web search and fetch |

Long answers come as a short summary plus an attached report file.

**Not available from the bot:** the morning brief, screener runs, verdict submission and
dashboard pushes (they write into the shared repositories), orders of any kind, email, git
writes, and IBKR. The bot names what was denied and stops.

**Not yet:** quotes, screener, trades, theme radar and the embedding wiki search belong to
another session's unfinished gate-3 work. The runner refuses them until that work is committed
(checked 2026-09-29: "tool script is not in the last commit").

## Control commands (PowerShell, from `market_dashboard\packages\bot-box`)

| Do | Command |
|---|---|
| Open the panel | `powershell -NoProfile -ExecutionPolicy Bypass -File .\control-panel.ps1` |
| Desktop icon | `... -File .\control-panel.ps1 -CreateShortcut` |
| Start the bot | `Start-ScheduledTask BotBoxPrivateClaude` |
| Refresh repos now | `Start-ScheduledTask BotBoxRepoRefresh` |
| Hourly refresh off / on | `Disable-ScheduledTask BotBoxRepoRefresh` / `Enable-ScheduledTask BotBoxRepoRefresh` |
| Check the bot would start (only while it is stopped) | `powershell -NoProfile -ExecutionPolicy Bypass -File .\start-private-bot.ps1 -PreflightOnly` |
| Health report | `powershell -NoProfile -ExecutionPolicy Bypass -File .\check-readiness.ps1` |
| Token or owner ID | `powershell -NoProfile -ExecutionPolicy Bypass -File .\configure-discord.ps1 -UserId <id> -ChannelId <id> -SkipToken` (resets the access list to you) |
| Logs | `%USERPROFILE%\.claude\bot-box\logs\` (`private-bot-*.log`, `refresh-*.log`) |

## Files

| File | Role |
|---|---|
| `control-panel.ps1` | The window |
| `lib/BotBoxPanel.psm1` | Access list, usage, bot process, restart decision, scheduled task |
| `lib/refresh-repos.ps1` | The hourly refresh (task `BotBoxRepoRefresh`) |
| `lib/usage-statusline.py` | The bot's status line; records usage |
| `lib/tests/` | Offline tests: `Test-BotBoxPanel.ps1`, `test_usage_statusline.py` |
