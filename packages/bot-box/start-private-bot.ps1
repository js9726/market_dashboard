<#
.SYNOPSIS
  Keeps the private Claude Discord bot running on the bot box.

.DESCRIPTION
  Starts Claude Code in THIS console with the Discord channel, Chrome integration and
  the dontAsk settings. When it exits it is restarted, with a backoff that grows while
  it keeps failing quickly and resets once it has run for 10 minutes.

  Stop it by closing this window. Stop-ScheduledTask ends only this launcher and leaves
  Claude Code running, so the launcher refuses to start while a bot session exists. The
  logon task (install-private-bot.ps1) starts it again at the next sign-in.

  Only one launcher runs at a time: it holds an exclusive lock file for its lifetime
  (released by the OS if it dies), and it also refuses to start while an orphaned bot
  session from an earlier launcher is still running.

  Before each start it refreshes both repositories through lib\BotBoxStartup.psm1: fetch,
  then fast-forward only when nothing can be lost or collide (no divergence, no merge or
  rebase in progress, no active agent claim on the repository, no local change on an
  incoming path). It never resets, stashes or cleans. Anything else leaves the checkout as
  found, logs the reason and starts the bot in STALE mode, where the bot must say its wiki
  and skills may be out of date.

  It also appends who may command the bot (access.json plus the control panel's owner and
  names, lib\BotBoxPanel.psm1) and records what the session started with in
  bot-state.json, which the hourly refresher (lib\refresh-repos.ps1) uses to decide
  whether an idle bot should be restarted.

  Log: %USERPROFILE%\.claude\bot-box\logs\private-bot-YYYYMMDD.log
#>
[CmdletBinding()]
param(
    [string]$WikiRoot = (Join-Path $env:USERPROFILE 'AI codes hub\jie_wiki'),
    [string]$DashRoot = (Join-Path $env:USERPROFILE 'AI codes hub\market_dashboard'),
    [int]$MaxBackoffSeconds = 300,
    # On Windows only one Claude Code session can drive Chrome at a time. Use -NoChrome
    # when you also want Chrome in your own interactive sessions on this machine.
    [switch]$NoChrome,
    # Fetch and report only; never fast-forward the shared checkouts.
    [switch]$NoPull,
    # Run every startup check and the refresh, log the freshness notice, then exit
    # without starting Claude. Exit 0 = would start, 1 = refused.
    [switch]$PreflightOnly
)

$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$settingsFile = Join-Path $here 'private-bot.settings.json'
$promptFile = Join-Path $here 'private-bot-prompt.md'
Import-Module (Join-Path $here 'lib\BotBoxStartup.psm1') -Force
Import-Module (Join-Path $here 'lib\BotBoxPanel.psm1') -Force
# Bot-box state lives under %USERPROFILE%\.claude, not AppData: a script started from the
# Claude desktop app (an MSIX package) has its AppData writes silently redirected into the
# package's LocalCache, where the logon task cannot see them.
$stateDir = Join-Path $env:USERPROFILE '.claude\bot-box'
$logDir = Join-Path $stateDir 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-BotLog {
    param([string]$Message)
    $logFile = Join-Path $logDir ('private-bot-{0:yyyyMMdd}.log' -f (Get-Date))
    $line = '{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $Message
    Add-Content -Path $logFile -Value $line
    Write-Host $line
}

# Only the designated bot box may run the bot: two machines running the same Discord
# bot token would both answer every message. install-private-bot.ps1 writes the marker.
$marker = Join-Path $stateDir 'designated-host.txt'
$designated = if (Test-Path $marker) { (Get-Content -Path $marker -TotalCount 1).Trim() } else { '' }
if ($designated -ne $env:COMPUTERNAME) {
    Write-BotLog "This machine ($env:COMPUTERNAME) is not the designated bot box. Run install-private-bot.ps1 here first."
    exit 1
}
# Held until this process exits. A second launcher (a double-clicked logon task, a manual
# start while the task runs) cannot get it and stops here, before touching anything.
$launcherLock = Enter-BotLauncherLock -Path (Join-Path $stateDir 'launcher.lock')
if (-not $launcherLock) {
    Write-BotLog 'Another bot launcher is already running on this machine (launcher.lock is held); not starting a second one.'
    exit 1
}
foreach ($f in @($settingsFile, $promptFile, $WikiRoot, $DashRoot)) {
    if (-not (Test-Path $f)) { Write-BotLog "Missing: $f"; exit 1 }
}
# A console opened before Bun was installed has a stale PATH, and the plugin's server
# then fails with "'bun' is not recognized". Rebuild PATH from the registry.
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { Write-BotLog 'claude is not on PATH'; exit 1 }
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) { Write-BotLog 'bun is not on PATH (the Discord channel plugin needs it)'; exit 1 }
$tokenFile = Join-Path $env:USERPROFILE '.claude\channels\discord\.env'
$hasToken = $env:DISCORD_BOT_TOKEN -or ((Test-Path $tokenFile) -and (Select-String -Path $tokenFile -Pattern '^DISCORD_BOT_TOKEN=.' -Quiet))
if (-not $hasToken) { Write-BotLog 'No Discord bot token saved. Run configure-discord.ps1 first.'; exit 1 }

$backoff = 15
while ($true) {
    # Stop-ScheduledTask ends a launcher but not the Claude session it started, and that
    # orphan does not hold the launcher lock. Never start a second bot beside it.
    $running = @(Get-CimInstance Win32_Process -Filter "Name='claude.exe'" | Where-Object { $_.CommandLine -match '--channels plugin:discord' })
    if ($running.Count -gt 0) {
        Write-BotLog ('A bot session is already running (claude.exe pid {0}); not starting another. Close its console window to stop it.' -f (($running | ForEach-Object { $_.ProcessId }) -join ', '))
        exit 1
    }

    # The launcher writes to the shared checkouts only by fast-forwarding, and only when
    # no agent holds an active claim on that repository (agent-system/atomic-claims.md).
    $claims = Get-BotActiveClaimRepositories -WikiRoot $WikiRoot
    if (-not $claims.Ok) { Write-BotLog "WARN claim check failed: $($claims.Error); repositories will not be fast-forwarded" }
    $fresh = foreach ($repo in @($WikiRoot, $DashRoot)) {
        $r = Update-BotRepo -Repo $repo -NoPull:$NoPull -ClaimedRepositories $claims.Repositories -ClaimCheckError $claims.Error
        Write-BotLog ('{0} refresh {1}: {2}' -f $r.Repo, $(if ($r.Fresh) { 'OK' } else { 'STALE' }), $r.Reason)
        $r
    }
    $notice = Get-BotFreshnessNotice -Results @($fresh)
    if (@($fresh | Where-Object { -not $_.Fresh }).Count -gt 0) {
        Write-BotLog 'WARN starting in STALE mode: the bot is told its wiki and skills may be out of date'
    }

    $paths = Get-BotBoxPaths
    $access = Get-BotAccess -AccessFile $paths.AccessFile -LabelsFile $paths.LabelsFile
    $accessNotice = Get-BotAccessNotice -Access $access
    Write-BotLog ('Access: owner {0}, {1} other user(s)' -f $(if ($access.Owner) { 'set' } else { 'NOT SET' }), @($access.Users | Where-Object { -not $_.IsOwner }).Count)

    # PowerShell 5.1 strips embedded double quotes from native-command arguments,
    # so the prompt is passed with single quotes instead.
    $prompt = ((Get-Content -Raw -Path $promptFile) + $notice + "`n" + $accessNotice) -replace '"', "'"

    if ($PreflightOnly) {
        Write-BotLog 'Preflight only: all startup checks passed; Claude was not started'
        Write-Host $notice
        Write-Host $accessNotice
        exit 0
    }

    Write-BotJson -Path $paths.BotStateFile -Value ([pscustomobject]@{
        started_at = (Get-Date).ToString('s')
        repos = @($fresh | ForEach-Object { [pscustomobject]@{ repo = $_.Repo; fresh = $_.Fresh } })
    })

    Set-Location $WikiRoot
    $started = Get-Date
    $chromeArgs = if ($NoChrome) { @() } else { @('--chrome') }
    Write-BotLog ('Starting Claude Code: discord channel, {0}, dontAsk' -f $(if ($NoChrome) { 'no chrome' } else { 'chrome' }))
    & claude --channels plugin:discord@claude-plugins-official @chromeArgs --permission-mode dontAsk --settings $settingsFile --add-dir $DashRoot --append-system-prompt $prompt
    $code = $LASTEXITCODE
    $ran = [int]((Get-Date) - $started).TotalSeconds
    Write-BotLog "Claude Code exited with code $code after $ran s"

    if ($ran -gt 600) { $backoff = 15 } else { $backoff = [Math]::Min($backoff * 2, $MaxBackoffSeconds) }
    Write-BotLog "Restarting in $backoff s"
    Start-Sleep -Seconds $backoff
}
