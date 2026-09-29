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
| Private bot | Running since / not running | Start, Restart, Stop |
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

**Hourly refresh.** Turn on registers the scheduled task `BotBoxRepoRefresh`: every hour
while you are signed in it runs `lib/refresh-repos.ps1`, the launcher's guarded update
(fetch, then fast-forward only when nothing can be lost or collide; never reset, stash or
clean). If a repository was updated, or one the bot started STALE is current again, it
restarts the bot once the bot has handled no message for 10 minutes. A repository that has
diverged from GitHub, or that an agent has an active claim on, stays STALE until that is
resolved in a coding session; the refresh reports it and never forces it. Log:
`%USERPROFILE%\.claude\bot-box\logs\refresh-YYYYMMDD.log`.

**Access.** Jie chose on 2026-09-29 to let other people command the bot. Adding someone
writes their Discord user ID into the plugin's `access.json` for DMs and every configured
channel; the name is kept in `access-labels.json`. Changes apply after Restart (the plugin
reads the list only when it starts). The launcher tells the bot who is on the list, and:

- everyone listed may give the bot requests, within all its other rules;
- Jie's positions, P&L, fills, trades and account details go only to the owner;
- if no owner is set, nobody gets them.

Everyone you add uses **your** Claude subscription, and claude.ai consumer plans are for
personal use. `configure-discord.ps1` rewrites the list to its `-UserId` only, so re-running it
removes everyone you added here.

## Files

| File | Role |
|---|---|
| `control-panel.ps1` | The window |
| `lib/BotBoxPanel.psm1` | Access list, usage, bot process, restart decision, scheduled task |
| `lib/refresh-repos.ps1` | The hourly refresh (task `BotBoxRepoRefresh`) |
| `lib/usage-statusline.py` | The bot's status line; records usage |
| `lib/tests/` | Offline tests: `Test-BotBoxPanel.ps1`, `test_usage_statusline.py` |
