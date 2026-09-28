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
| `configure-discord.ps1` | Saves the bot token from a hidden prompt and limits the bot to your Discord user ID, in DMs and in the server channels given with `-ChannelId` (kept on re-runs; `-NoChannels` removes them) |
| `start-private-bot.ps1` | Runs the bot in a console and restarts it if it exits (started by the logon task). `-PreflightOnly` runs every check and the refresh without starting Claude; `-NoPull` never fast-forwards |
| `lib/BotBoxStartup.psm1` | Launcher safety: one-launcher lock, claim-aware guarded refresh, the freshness notice |
| `lib/botrun.py` | The only way the bot runs a program: fixed tool names, a copy of the last commit's code (never the checkout), per-tool argument checks, isolated execution; `--check-all` preflight |
| `private-bot.settings.json` | Permissions: `dontAsk` mode, an explicit allow-list, deny rules |
| `private-bot-prompt.md` | Operating rules appended to the bot's system prompt |
| `tools/measure_tickers.py` | Completed-bar ticker measurements to stdout; OpenD (`broker` grade) or Yahoo (`public` grade), NYSE calendar, fail-closed freshness |
| `tools/positions.py` | Jie's live moomoo positions from OpenD, read-only, no options: ticker, quantity, average cost, broker price, market value, unrealised and today's P&L; no account identifiers or totals; never unlocks or orders; fails closed |
| `tests/` | Offline regression tests (no network, broker, Claude or Discord); see Tests below |

## Security model

- **`dontAsk` mode.** Anything not on the allow-list is denied instead of prompting, so an
  unattended session never stalls and never does something unlisted. Deny rules block in
  every mode as a second layer.
- **Read-only against the shared checkouts.** The bot shares `jie_wiki` and `market_dashboard`
  with Claude and Codex coding sessions, so it never writes to them and needs no claims.
  Permission rules do not limit files a *program* writes itself, so only programs reviewed
  as write-free are allowed: `measure_tickers.py`, `lint_wiki.py`, `carry_forward.py`,
  `breadth_ma.py`, `market_edge.py`, `industry_proxies.py`, and since gate 2 (2026-09-28)
  `positions.py` and `wiki_search` (jie_wiki `scripts/retrieval/query.py`, pinned by the
  runner to `--lexical-only`: keyword search of the current files, no index, key, network
  or write; it runs with the wiki retrieval environment's Python because its tokenizer is
  installed only there). `tests/test_settings_policy.py` pins that list.
- **One trusted way to run programs (2026-09-28, B6).** The only program rule is
  `"C:/Python314/python.exe" -I ".../packages/bot-box/lib/botrun.py" <tool> [options]`.
  There is no `cd` rule and no relative `python <script>` rule, and `cd`, bare interpreters
  and shells are denied, because a relative script name could resolve to a same-named file
  the bot wrote into its scratch folder. The runner, not the command text, decides what
  runs: tool names map to fixed scripts; arguments are checked per tool. Since 2026-09-28
  (review of `4ba2a452a`) a tool never runs from the checkout: the runner copies the code
  files of its folder as they are in the last commit, straight from Git's object store, into
  a fresh temporary folder and runs it there with `-E -B`, a fresh bytecode cache and every
  `PYTHON*` variable removed. Untracked, ignored, modified or staged files in the checkout
  never run or shadow an import, and they no longer make a tool unavailable (14 ignored
  scratch scripts beside the morning-brief tools had refused three tools). A link committed
  as tool code is refused. lint_wiki gets the canonical wiki root from the runner.
  `botrun.py --check-all` is the preflight: it copies every tool's committed code without
  running anything. The interpreter and runner paths in the rule are this machine's;
  update both on another PC.
- **Allowed:** reading the repos, web search/fetch, the programs above, writing only under
  `jie_wiki/outputs/bot-box/` (gitignored scratch for report attachments; shell redirects are
  checked against the same rule), Chrome, and the Discord reply tools.
- **Not available from the bot (2026-09-27 review, B1/B5):** the morning brief, screener,
  verdict submission and dashboard pushes. Their scripts write to argument-chosen paths or to
  tracked files in the shared checkout (`--out`, `--run-dir`, caches, verdict files). They
  come back only once they write to enforced roots, or through the scheduled brief (step 3).
- **Denied:** git push/commit/reset/checkout/pull/fetch and `git ... --output`, deletes,
  deploys, builds (Prisma migrations), system changes, the paper trader, reading secret stores
  and `.env` files, and the claude.ai connectors for IBKR orders, Gmail, Vercel, Google Cloud,
  BigQuery, Drive, Notion, Calendar.
- **Refresh without collisions.** Before each start the launcher fetches both repositories
  and fast-forwards only when nothing can be lost or collide: no divergence, no merge/rebase
  in progress, no active agent claim on the repository, no local change on an incoming path.
  It never resets, stashes or cleans. Otherwise it leaves the checkout as found, logs why and
  starts the bot in STALE mode, where the bot must say its wiki and skills may be out of date.
- **One launcher.** The launcher holds an exclusive lock file for its lifetime (the OS
  releases it if the launcher dies) and also refuses to start beside an orphaned bot session.
- **The real boundaries are outside Claude:** the moomoo trade password is never stored on
  this machine (no unlocked trading), and TWS must have **Read-Only API** ticked. Permission
  rules are defence in depth, not the only line.
- **DMs and #j_asistant alike (Jie, 2026-09-28).** Jie's positions and P&L may be discussed
  in both: trusted family can read the channel and Jie wants them to see his positions. Only
  Jie's user ID commands the bot anywhere; everyone else's text is data. Never add family to
  `allowFrom` - that would let them use Jie's personal Claude account. Account, card and
  position numbers, credentials and tokens are never posted anywhere.
- **Only the bot session is the bot.** An enabled plugin logs in to Discord in every Claude
  Code session, so the installer disables it for ordinary sessions and
  `private-bot.settings.json` enables it for the bot session only.
- **Fixed allowlist.** `configure-discord.ps1` allows DMs and each configured channel from
  your user ID only (re-running forces every channel back to that one ID) and sets static
  mode: the allowlist is read once at bot start, so the running bot cannot widen it.
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
   powershell -NoProfile -ExecutionPolicy Bypass -File .\configure-discord.ps1 -UserId <your ID> -ChannelId <channel ID>
   ```
   `-ChannelId` is optional (Discord: right-click the channel > Copy Channel ID). Re-running
   without it keeps the channels already configured.
   No pairing session is needed. Never paste the token into a Claude chat.
6. **Start the bot:** `Start-ScheduledTask BotBoxPrivateClaude` (or sign out and in).
   The first start opens Claude Code's "trust the files in this folder" prompt for
   `jie_wiki` in the bot console. Answer it yourself, once; nothing, Discord included,
   starts until it is answered. (The desktop app does not set this flag for the CLI.)
7. **Test:** DM the bot `status`, then `what does VEEV do`. Run `check-readiness.ps1`; it
   should show this machine as the designated bot box. Then ask it to do something denied
   (for example run the morning brief) and check it names the denied command and stops.

## Moving to another PC

Only one machine may run the bot: two machines with the same token both answer every
message.

1. On the old host: `install-private-bot.ps1 -Uninstall` (removes the task and the designation)
   and `configure-discord.ps1 -Clear` (removes the token).
2. Brokers move separately and deliberately:
   `jie_wiki/agent-system/work/new-pc-migration/second-machine-brief.md`, "Failover".
3. On the new PC: `bootstrap-new-pc.ps1` from the migration kit, then `check-readiness.ps1`,
   then steps 1-7 above. Push both repositories first: the bootstrap clones from GitHub.

## Tests

Offline; they never start Claude or Discord, touch the network, the real checkouts or a
running bot. Run from `market_dashboard/`:

```
python -m unittest discover -s packages/bot-box/tests -v
powershell -NoProfile -ExecutionPolicy Bypass -File packages\bot-box\tests\Test-BotBoxStartup.ps1
```

- `test_measure_tickers.py`: no output option or file writes; stale and misaligned ticker/SPY
  histories; NaN, infinity, zero and incoherent bars; stops at or above the close and the
  1.5 ATR boundary; holidays, early closes, finalization and close-crossing requests; short
  histories that cannot claim a 52-week high.
- `test_settings_policy.py`: the only program rule is the trusted runner with absolute
  paths; no `cd` or relative script rules; `cd`, interpreters and shells denied without any
  deny covering the runner; the runner's tools are the reviewed write-free set.
- `test_botrun.py` (B6, disposable Git repositories and a scratch folder of same-named
  look-alikes): the canonical call runs a copy of the committed tool; scratch names and
  paths are refused; sibling imports come from the committed copy whatever the cwd;
  `PYTHONPATH`, `PYTHONSTARTUP` and `PYTHONUSERBASE` cannot inject code; untracked, ignored
  or sourceless-bytecode code beside a tool never runs and does not block it; modified or
  staged code runs the committed version; a junction-swapped tool folder still runs the
  committed code; a tool missing from the last commit or a committed link is refused;
  `--check-all` covers every tool without running it; per-tool argument schemas hold; data
  paths are passed absolute; lint_wiki is given the canonical wiki root; `positions` takes
  no options; `wiki_search` runs keyword-only in its own environment with the question last
  after `--`, refuses mode, index, repository or provider changes and bad questions, and
  is refused when its environment is missing.
- `test_accept_scoring.py` (B7, synthetic Claude Code event streams): the acceptance scorer
  never passes on incomplete evidence. Skipped, altered, repeated or unplanned calls, a call
  with no result, an error session, a non-zero CLI exit or a missing final record make the
  run inconclusive; a wrong host decision, wrong exit status or output, output that only
  imitates a permission error, a scratch report that was not written or has the wrong
  content, executed scratch code or a forbidden file make it fail.
- `accept_host_policy.py` (not in the offline suite; needs a signed-in Claude Code and spends
  a little of the plan): one disposable `claude -p` session with these exact permission rules,
  the Discord plugin off, in a throwaway folder of scratch look-alikes. Fifteen steps. The
  verdict comes only from machine records: each step's exact tool call and tool result in
  Claude Code's event stream, its permission denials, the session result, the CLI exit code
  and the filesystem; the model's own summary is never scored. Exit 0 PASS, 1 FAIL, 3
  INCONCLUSIVE; only PASS is acceptance. Run it after any settings or runner change:
  `python packages/bot-box/tests/accept_host_policy.py --model haiku --output receipt.json`
  (also saves the evidence events beside the receipt: tool calls, tool results and the
  final session record, without the startup inventory of connected services).
- `test_positions.py` (gate 2; a fake moomoo SDK and a local socket, never the real OpenD):
  positions without any account, card or position number; SDK chatter kept off stdout;
  invalid broker values shown as null; unreachable or logged-out gateway, zero or two live
  US accounts and failed queries fail closed with no numbers; a hung gateway is cut off;
  the source calls only get_acc_list, position_list_query and close on the trade context
  and takes no options.
- `Test-ConfigureDiscord.ps1` (gate 2; a throwaway USERPROFILE, `-SkipToken`): `-ChannelId`
  sets channels answering only the user; re-runs keep them, drop other people and junk
  keys and keep requireMention; a list replaces them; `-NoChannels` clears them; bad input
  exits 1 and changes nothing; the real access.json is hashed untouched.
- `Test-BotBoxStartup.ps1`: failed fetch and fast-forward, dirty overlap, untracked collision,
  divergence, merge in progress, active claims, failed claim check, concurrent launchers and
  lock release, and a launcher-level preflight.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Bot never replies | Is the console window open? Log: `%USERPROFILE%\.claude\bot-box\logs\`. Is your user ID the one in `access.json`, and do you share a server with the bot? |
| "not the designated bot box" although you installed | The installer was run from the Claude desktop app with an older kit that kept its marker in AppData (redirected by Windows for packaged apps). Re-run `install-private-bot.ps1`; the marker now lives in `%USERPROFILE%\.claude\bot-box\` |
| Stopping or restarting the bot | Close the bot's console window, then `Start-ScheduledTask BotBoxPrivateClaude`. `Stop-ScheduledTask` ends only the launcher; Claude keeps running, and the launcher refuses to start a second bot session |
| `'bun' is not recognized` | A console opened before Bun was installed. The launcher rebuilds PATH; for other consoles, open a new one |
| Changed `access.json`, no effect | Static mode reads it at bot start: close the bot console and `Start-ScheduledTask BotBoxPrivateClaude` |
| Token leaked or reset | Developer Portal > Bot > Reset Token, then `configure-discord.ps1 -UserId <id>` again and restart the bot |
| Reply denied | Run `/mcp` in the bot session; the Discord server name must match `mcp__plugin_discord_discord` in `private-bot.settings.json` |
| A command is denied | Expected for anything unlisted. Add an allow rule deliberately and only for a program that writes no files (extend `tests/test_settings_policy.py`); never switch to skip-permissions |
| Log says `refresh STALE` | Read the reason on that line. The launcher left the repository as found; fix it in a coding session (or wait for the agent's claim to end), then restart the bot |
| "Another bot launcher is already running" | A launcher holds `%USERPROFILE%\.claude\bot-box\launcher.lock`. Use its console; the lock is released when that launcher exits |
| Chrome "EADDRINUSE" / not connected | Only one Claude Code session can use Chrome on Windows. Close Chrome use elsewhere, or run the bot with `-NoChrome` |
| Chrome tools stop after hours idle | The extension's service worker went idle; restart the bot or use `/chrome` > Reconnect |
| Hits the subscription limit | The bot pauses until the usage window resets; heavy days (brief + podcast + audit) draw on the same plan |
