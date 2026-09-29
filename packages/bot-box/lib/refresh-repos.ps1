<#
.SYNOPSIS
  Hourly refresh of jie_wiki and market_dashboard for the private bot (task BotBoxRepoRefresh).

.DESCRIPTION
  Runs the same guarded update as the launcher (lib\BotBoxStartup.psm1): fetch, then
  fast-forward only when nothing can be lost or collide. It never resets, stashes or
  cleans; a diverged or claimed repository stays STALE and is reported, not forced.

  If a repository was updated, or one the bot started STALE is now current, the running bot
  is restarted so its freshness note is right - but only once it has handled no message for
  -IdleMinutes. While it is busy the restart waits (pending-restart.json) and is retried on
  the next run. The restart ends the bot's Claude session and its Discord plugin; the
  launcher starts a new session after its 15-second backoff.

  The control panel turns the task on and off. Log: %USERPROFILE%\.claude\bot-box\logs\refresh-YYYYMMDD.log
#>
[CmdletBinding()]
param(
    [string]$WikiRoot = (Join-Path $env:USERPROFILE 'AI codes hub\jie_wiki'),
    [string]$DashRoot = (Join-Path $env:USERPROFILE 'AI codes hub\market_dashboard'),
    [int]$IdleMinutes = 10,
    [switch]$NoRestart
)

$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Import-Module (Join-Path $here 'BotBoxStartup.psm1') -Force
Import-Module (Join-Path $here 'BotBoxPanel.psm1') -Force
$paths = Get-BotBoxPaths
New-Item -ItemType Directory -Force -Path $paths.LogDir | Out-Null

function Write-RefreshLog {
    param([string]$Message)
    $line = '{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $Message
    Add-Content -Path (Join-Path $paths.LogDir ('refresh-{0:yyyyMMdd}.log' -f (Get-Date))) -Value $line
    Write-Host $line
}

$lock = Enter-BotLauncherLock -Path $paths.RefreshLock
if (-not $lock) { Write-RefreshLog 'Another refresh is running; skipped'; exit 0 }

$claims = Get-BotActiveClaimRepositories -WikiRoot $WikiRoot
if (-not $claims.Ok) { Write-RefreshLog "WARN claim check failed: $($claims.Error); repositories will not be fast-forwarded" }
$results = foreach ($repo in @($WikiRoot, $DashRoot)) {
    $r = Update-BotRepo -Repo $repo -ClaimedRepositories $claims.Repositories -ClaimCheckError $claims.Error
    Write-RefreshLog ('{0} {1}: {2}' -f $r.Repo, $(if ($r.Pulled) { 'UPDATED' } elseif ($r.Fresh) { 'OK' } else { 'STALE' }), $r.Reason)
    $r
}
$results = @($results)
Write-BotJson -Path $paths.RefreshStatus -Value ([pscustomobject]@{
    at = (Get-Date).ToString('s')
    repos = @($results | ForEach-Object { [pscustomobject]@{ repo = $_.Repo; fresh = $_.Fresh; pulled = $_.Pulled; reason = $_.Reason } })
})

if ($NoRestart) { exit 0 }
$session = Get-BotSessionInfo
if (-not $session.Running) {
    if (Test-Path $paths.PendingFile) { Remove-Item $paths.PendingFile -Force }
    exit 0
}
$launch = Read-BotJson $paths.BotStateFile
$reason = Get-BotRestartReason -LaunchState $launch -Results $results
$pending = Read-BotJson $paths.PendingFile
if ($pending -and $session.StartedAt -and $session.StartedAt -gt [datetime]$pending.since) {
    # The bot has been restarted by something else since the restart was requested.
    Remove-Item $paths.PendingFile -Force
    $pending = $null
}
if ($reason -and -not $pending) {
    $pending = [pscustomobject]@{ since = (Get-Date).ToString('s'); reason = $reason }
    Write-BotJson -Path $paths.PendingFile -Value $pending
}
if (-not $pending) { exit 0 }

$last = Get-BotLastActivity -UsageFile $paths.UsageFile -StartedAt $session.StartedAt
if (-not (Test-BotIdle -LastActivity $last -IdleMinutes $IdleMinutes)) {
    Write-RefreshLog ('Bot restart waiting ({0}): last activity {1:HH:mm}, needs {2} idle minutes' -f $pending.reason, $last, $IdleMinutes)
    exit 0
}
if (@($session.LauncherIds).Count -eq 0) {
    Write-RefreshLog "Bot restart skipped ($($pending.reason)): no launcher is running, so nothing would start it again"
    exit 0
}
$n = Stop-BotSession
Remove-Item $paths.PendingFile -Force
Write-RefreshLog "Restarting the idle bot ($($pending.reason)): ended $n process(es); the launcher starts a new session"
exit 0
