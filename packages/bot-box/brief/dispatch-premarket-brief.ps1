<#
.SYNOPSIS
  Starts the pre-open brief workflow (refresh_premarket.yml) at 08:40 US Eastern on weekdays.

.DESCRIPTION
  Run by the scheduled task BotBoxBriefDispatch (twice a day in local time, one per US
  clock season; only the run inside 08:30-09:15 ET does anything, once per ET date). It
  calls `gh workflow run` with this user's GitHub CLI login; nothing else is sent.

  -Install    register the task (runs only while you are signed in)
  -Uninstall  remove it
  -Force      dispatch now, whatever the time (a manual test run; it will post to #j_asistant)

  Log: %USERPROFILE%\.claude\bot-box\logs\brief-dispatch-YYYYMMDD.log
#>
[CmdletBinding()]
param(
    [switch]$Install,
    [switch]$Uninstall,
    [switch]$Force,
    [string]$Repo = 'js9726/market_dashboard'
)

$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Import-Module (Join-Path $here 'BriefDispatch.psm1') -Force
$stateDir = Join-Path $env:USERPROFILE '.claude\bot-box'
$logDir = Join-Path $stateDir 'logs'
$stateFile = Join-Path $stateDir 'brief-dispatch.json'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-DispatchLog {
    param([string]$Message)
    $line = '{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $Message
    Add-Content -Path (Join-Path $logDir ('brief-dispatch-{0:yyyyMMdd}.log' -f (Get-Date))) -Value $line
    Write-Host $line
}

if ($Uninstall) { Unregister-BriefDispatchTask; Write-DispatchLog 'Task BotBoxBriefDispatch removed'; exit 0 }
if ($Install) {
    Register-BriefDispatchTask -ScriptPath $MyInvocation.MyCommand.Path
    Write-DispatchLog ('Task BotBoxBriefDispatch registered: daily at {0} local, acting only at 08:40 ET on weekdays' -f
        ((Get-BriefTriggerTimes | ForEach-Object { '{0:hh\:mm}' -f $_ }) -join ' and '))
    exit 0
}

$last = ''
if (Test-Path $stateFile) {
    try { $last = [string]((Get-Content -Raw $stateFile | ConvertFrom-Json).et_date) } catch { $last = '' }
}
$due = Test-BriefDispatchDue -NowUtc ([datetime]::UtcNow) -LastDispatchEtDate $last -Force:$Force
if (-not $due.Due) { Write-DispatchLog "Not dispatched: $($due.Reason)"; exit 0 }

$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Write-DispatchLog 'FAILED: GitHub CLI (gh) is not on PATH'; exit 1 }
$out = & gh workflow run refresh_premarket.yml --repo $Repo --ref main 2>&1 | ForEach-Object { "$_" }
if ($LASTEXITCODE -ne 0) {
    Write-DispatchLog ('FAILED: gh workflow run exited {0}: {1}' -f $LASTEXITCODE, (($out | Select-Object -Last 1) -join ''))
    exit 1
}
$state = [pscustomobject]@{ et_date = $due.EtDate; dispatched_at = (Get-Date).ToString('s') }
[System.IO.File]::WriteAllText($stateFile, (($state | ConvertTo-Json) + "`n"))
Write-DispatchLog "Dispatched refresh_premarket.yml on $Repo for $($due.EtDate) ($($due.Reason))"
exit 0
