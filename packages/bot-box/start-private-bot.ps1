<#
.SYNOPSIS
  Keeps the private Claude Discord bot running on the bot box.

.DESCRIPTION
  Starts Claude Code in THIS console with the Discord channel, Chrome integration and
  the dontAsk settings. When it exits it is restarted, with a backoff that grows while
  it keeps failing quickly and resets once it has run for 10 minutes.

  Stop it by closing this window. The logon task (install-private-bot.ps1) starts it
  again at the next sign-in.

  Log: %LOCALAPPDATA%\Jie\bot-box\logs\private-bot-YYYYMMDD.log
#>
[CmdletBinding()]
param(
    [string]$WikiRoot = (Join-Path $env:USERPROFILE 'AI codes hub\jie_wiki'),
    [string]$DashRoot = (Join-Path $env:USERPROFILE 'AI codes hub\market_dashboard'),
    [int]$MaxBackoffSeconds = 300,
    # On Windows only one Claude Code session can drive Chrome at a time. Use -NoChrome
    # when you also want Chrome in your own interactive sessions on this machine.
    [switch]$NoChrome
)

$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$settingsFile = Join-Path $here 'private-bot.settings.json'
$promptFile = Join-Path $here 'private-bot-prompt.md'
$logDir = Join-Path $env:LOCALAPPDATA 'Jie\bot-box\logs'
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
$marker = Join-Path $env:LOCALAPPDATA 'Jie\bot-box\designated-host.txt'
$designated = if (Test-Path $marker) { (Get-Content -Path $marker -TotalCount 1).Trim() } else { '' }
if ($designated -ne $env:COMPUTERNAME) {
    Write-BotLog "This machine ($env:COMPUTERNAME) is not the designated bot box. Run install-private-bot.ps1 here first."
    exit 1
}
foreach ($f in @($settingsFile, $promptFile, $WikiRoot, $DashRoot)) {
    if (-not (Test-Path $f)) { Write-BotLog "Missing: $f"; exit 1 }
}
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { Write-BotLog 'claude is not on PATH'; exit 1 }
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) { Write-BotLog 'bun is not on PATH (the Discord channel plugin needs it)'; exit 1 }

$backoff = 15
while ($true) {
    foreach ($repo in @($WikiRoot, $DashRoot)) {
        Push-Location $repo
        $result = (git pull --ff-only 2>&1 | Select-Object -Last 1)
        Pop-Location
        Write-BotLog ('git pull --ff-only {0}: {1}' -f (Split-Path $repo -Leaf), $result)
    }

    # PowerShell 5.1 strips embedded double quotes from native-command arguments,
    # so the prompt is passed with single quotes instead.
    $prompt = (Get-Content -Raw -Path $promptFile) -replace '"', "'"

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
