# Bot box

An always-on machine that runs Jie's Discord bots, the daily brief and the podcast.
Design agreed 2026-09-26; task record `jie_wiki/agent-system/work/discord-bot-box-20260926/`.

| Piece | Runs on | Status |
|---|---|---|
| **Private bot** - Claude Code in Discord DMs, Jie only | Claude subscription | **Step 1 - this folder** |
| Friends' bot - DeepSeek flash in the JTPod server | DeepSeek API (~US$2-4/month) | Step 2, not built |
| 07:30 MYT Mandarin podcast, 20:45 MYT brief, cached deep-dives | Claude subscription | Step 3, not built |

**Host.** Interim host is `WALPLUS-ASUS` (it already runs the brokers, OpenD and Chrome with
TradingView, so no broker failover is needed yet). A better PC will replace it later - see
"Moving to another PC". The old secondary laptop (i5-7200U, 8 GB, 2 GB GPU) is too weak to
host this and cannot run local Qwen TTS.

## Files

| File | What it does |
|---|---|
| `check-readiness.ps1` | Read-only report: power, network, updates, auto-login, disk, software, repos, brokers, designation |
| `install-private-bot.ps1` | Designates this machine, installs the Discord channel plugin (off for ordinary sessions), registers the logon task |
| `configure-discord.ps1` | Saves the bot token from a hidden prompt and limits DMs to your Discord user ID |
| `start-private-bot.ps1` | Runs the bot in a console and restarts it if it exits (started by the logon task) |
| `private-bot.settings.json` | Permissions: `dontAsk` mode, an explicit allow-list, deny rules |
| `private-bot-prompt.md` | Operating rules appended to the bot's system prompt |
| `tools/measure_tickers.py` | Completed-bar ticker measurements; OpenD (full grade) or Yahoo (public grade) |

## Security model

- **`dontAsk` mode.** Anything not on the allow-list is denied instead of prompting, so an
  unattended session never stalls and never does something unlisted. Deny rules block in
  every mode as a second layer.
- **Allowed:** reading the repos, web search/fetch, the brief and analysis scripts, the
  dashboard push, writing under `evidence/` and `outputs/`, Chrome, and the Discord reply tools.
- **Denied:** git push/commit/reset/checkout, deletes, deploys, builds (Prisma migrations),
  system changes, the paper trader, reading secret stores and `.env` files, and the claude.ai
  connectors for IBKR orders, Gmail, Vercel, Google Cloud, BigQuery, Drive, Notion, Calendar.
- **The real boundaries are outside Claude:** the moomoo trade password is never stored on
  this machine (no unlocked trading), and TWS must have **Read-Only API** ticked. Permission
  rules are defence in depth, not the only line.
- **DM only.** Jie's book and P&L are discussed only in DMs, never in a server channel.
- **Only the bot session is the bot.** An enabled plugin logs in to Discord in every Claude
  Code session, so the installer disables it for ordinary sessions and
  `private-bot.settings.json` enables it for the bot session only.
- **Fixed allowlist.** `configure-discord.ps1` allows DMs from your user ID only and sets
  static mode: the allowlist is read once at bot start, so the running bot cannot widen it.
- **The token never passes through Claude.** It is typed at a hidden PowerShell prompt, not
  with `/discord:configure` (which would put it in a session transcript). The bot's
  permissions deny reading `.env` files, and the plugin refuses to send its own state files.

## Set up the interim host (WALPLUS-ASUS)

1. **Power (you do this; the script will not change system settings).** Keep the laptop on
   AC with the lid open, or set *Control Panel > Power Options > Choose what closing the lid
   does > When plugged in: Do nothing*. Sleep and hibernate on AC are already "never".
   Windows Update active hours are 08:00-02:00, so restarts land 02:00-08:00 MYT.
2. **Claude Code must be signed in with `/login`,** not a `setup-token`: Chrome integration
   is switched off for token logins.
3. **Discord application** (Discord Developer Portal, your account):
   - New Application, then Bot: set a name, **Reset Token** and copy it (shown once).
   - Enable **Message Content Intent** under Privileged Gateway Intents.
   - Turn **Public Bot** off, so only you can add the bot to servers.
   - OAuth2 > URL Generator: scope `bot`; permissions View Channels, Send Messages, Send
     Messages in Threads, Read Message History, Attach Files, Add Reactions.
   - Open the URL and add the bot to a server you are in. Discord only allows DMs between
     accounts that share a server. A small server of your own is simplest; JTPod works too
     but needs its owner to add the bot.
   - Discord app: *User Settings > Advanced > Developer Mode* on, then right-click your
     avatar > **Copy User ID**.
4. **Install** (from this folder):
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File .\install-private-bot.ps1 -InstallBun
   ```
   Add `-NoChrome` if you want Chrome free for your own sessions (see Troubleshooting).
5. **Token and allowlist** (from this folder; paste the token at the hidden prompt):
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File .\configure-discord.ps1 -UserId <your ID>
   ```
   No pairing session is needed. Never paste the token into a Claude chat.
6. **Start the bot:** `Start-ScheduledTask BotBoxPrivateClaude` (or sign out and in).
7. **Test:** DM the bot `status`, then `what does VEEV do`. Run `check-readiness.ps1`; it
   should show this machine as the designated bot box.

## Moving to another PC

Only one machine may run the bot: two machines with the same token both answer every
message.

1. On the old host: `install-private-bot.ps1 -Uninstall` (removes the task and the designation)
   and `configure-discord.ps1 -Clear` (removes the token).
2. Brokers move separately and deliberately:
   `jie_wiki/agent-system/work/new-pc-migration/second-machine-brief.md`, "Failover".
3. On the new PC: `bootstrap-new-pc.ps1` from the migration kit, then `check-readiness.ps1`,
   then steps 1-7 above. Push both repositories first: the bootstrap clones from GitHub.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Bot never replies | Is the console window open? Log: `%LOCALAPPDATA%\Jie\bot-box\logs\`. Is your user ID the one in `access.json`, and do you share a server with the bot? |
| `'bun' is not recognized` | A console opened before Bun was installed. The launcher rebuilds PATH; for other consoles, open a new one |
| Changed `access.json`, no effect | Static mode reads it at bot start: close the bot console and `Start-ScheduledTask BotBoxPrivateClaude` |
| Token leaked or reset | Developer Portal > Bot > Reset Token, then `configure-discord.ps1 -UserId <id>` again and restart the bot |
| Reply denied | Run `/mcp` in the bot session; the Discord server name must match `mcp__plugin_discord_discord` in `private-bot.settings.json` |
| A command is denied | Expected for anything unlisted. Add an allow rule deliberately, never switch to skip-permissions |
| Chrome "EADDRINUSE" / not connected | Only one Claude Code session can use Chrome on Windows. Close Chrome use elsewhere, or run the bot with `-NoChrome` |
| Chrome tools stop after hours idle | The extension's service worker went idle; restart the bot or use `/chrome` > Reconnect |
| Hits the subscription limit | The bot pauses until the usage window resets; heavy days (brief + podcast + audit) draw on the same plan |
