<#
.SYNOPSIS
  One-time setup of the private Claude Discord bot on the bot box.

.DESCRIPTION
  1. Checks prerequisites (Claude Code >= 2.1.211, Bun, Chrome, the Claude-in-Chrome
     native host).
  2. Installs the official Discord channel plugin (user scope).
  3. Registers the logon task BotBoxPrivateClaude, which runs start-private-bot.ps1 in a
     visible console every time you sign in.

  It never asks for, reads or stores your Discord bot token. You enter the token
  yourself inside Claude Code (README, step C).

  -InstallBun   also installs Bun with winget if it is missing
  -Uninstall    removes the logon task only (plugin and token are left alone)
  -NoChrome     register the bot without Chrome (keeps Chrome free for your own sessions)

  Running this DESIGNATES this machine as the bot box. Only one machine may be
  designated: two machines running the same bot token would both answer every message.
  To move the bot, run -Uninstall on the old machine first.

  Run:  powershell -NoProfile -ExecutionPolicy Bypass -File .\install-private-bot.ps1
#>
[CmdletBinding()]
param(
    [switch]$InstallBun,
    [switch]$Uninstall,
    [switch]$NoChrome
)

$ErrorActionPreference = 'Stop'
$TaskName = 'BotBoxPrivateClaude'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcher = Join-Path $here 'start-private-bot.ps1'
$problems = New-Object System.Collections.ArrayList

function Say { param([string]$Level, [string]$Text)
    $color = @{ OK = 'Green'; TODO = 'Yellow'; STOP = 'Red'; INFO = 'Gray' }[$Level]
    Write-Host ('[{0}] {1}' -f $Level, $Text) -ForegroundColor $color
}

$markerDir = Join-Path $env:LOCALAPPDATA 'Jie\bot-box'
$marker = Join-Path $markerDir 'designated-host.txt'

if ($Uninstall) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Say OK "Removed logon task $TaskName"
    } else {
        Say INFO "Logon task $TaskName was not registered"
    }
    if (Test-Path $marker) { Remove-Item -Path $marker -Force; Say OK 'This machine is no longer the designated bot box' }
    exit 0
}

Write-Host ''
Write-Host '=== 1. Prerequisites ===' -ForegroundColor Cyan
if (Get-Command claude -ErrorAction SilentlyContinue) {
    $cv = (& claude --version 2>$null | Select-Object -First 1)
    if ($cv -match '(\d+)\.(\d+)\.(\d+)') {
        $n = [int]$Matches[1] * 1000000 + [int]$Matches[2] * 1000 + [int]$Matches[3]
        if ($n -ge 2001211) { Say OK "Claude Code $cv" } else { Say STOP "Claude Code $cv is too old: run  claude update"; [void]$problems.Add('claude') }
    }
} else {
    Say STOP 'Claude Code is not installed. Install it, then run  claude  and use /login (NOT setup-token: Chrome needs /login).'
    [void]$problems.Add('claude')
}

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    if ($InstallBun) {
        Say INFO 'Installing Bun with winget...'
        winget install --id Oven-sh.Bun -e --accept-source-agreements --accept-package-agreements
        $env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
    }
    if (Get-Command bun -ErrorAction SilentlyContinue) { Say OK 'Bun installed' }
    else { Say STOP 'Bun is missing. Re-run with -InstallBun, or: winget install Oven-sh.Bun'; [void]$problems.Add('bun') }
} else {
    Say OK ('Bun ' + (& bun --version 2>$null))
}

$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($chrome) { Say OK 'Google Chrome installed' } else { Say STOP 'Google Chrome is not installed'; [void]$problems.Add('chrome') }

$nmh = Get-ChildItem 'HKCU:\Software\Google\Chrome\NativeMessagingHosts' -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -match 'claude' }
if ($nmh) { Say OK 'Claude-in-Chrome native host registered' }
else { Say TODO 'Install the Claude extension in Chrome, then run  claude --chrome  once and restart Chrome' }

if ($problems.Count -gt 0) {
    Write-Host ''
    Say STOP ('Fix these first, then run this script again: ' + ($problems -join ', '))
    exit 1
}

Write-Host ''
Write-Host '=== 2. Discord channel plugin ===' -ForegroundColor Cyan
$markets = (& claude plugin marketplace list 2>&1 | Out-String)
if ($markets -notmatch 'claude-plugins-official') {
    Say INFO 'Adding the official plugin marketplace'
    & claude plugin marketplace add anthropics/claude-plugins-official
}
& claude plugin install discord@claude-plugins-official --scope user
if ($LASTEXITCODE -eq 0) { Say OK 'discord@claude-plugins-official installed (user scope)' }
else { Say STOP 'Plugin install failed - see the message above'; exit 1 }

Write-Host ''
Write-Host '=== 3. Logon task ===' -ForegroundColor Cyan
$user = "$env:USERDOMAIN\$env:USERNAME"
New-Item -ItemType Directory -Force -Path $markerDir | Out-Null
Set-Content -Path $marker -Value $env:COMPUTERNAME -Encoding ASCII
Say OK "Designated $env:COMPUTERNAME as the bot box"
$launchArgs = '-NoProfile -ExecutionPolicy Bypass -NoExit -File "{0}"' -f $launcher
if ($NoChrome) { $launchArgs += ' -NoChrome' }
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $launchArgs
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Say OK "Registered $TaskName (runs start-private-bot.ps1 at every sign-in of $user)"

Write-Host ''
Write-Host '=== 4. Your manual steps (the script cannot do these) ===' -ForegroundColor Cyan
Say TODO 'Discord Developer Portal: New Application -> Bot -> Reset Token (copy it) -> enable MESSAGE CONTENT INTENT'
Say TODO 'OAuth2 -> URL Generator: scope "bot", permissions View Channels, Send Messages, Read Message History, Attach Files, Add Reactions; open the URL and add the bot to a server you are in'
Say TODO 'In a NORMAL session (not the bot):  claude --channels plugin:discord@claude-plugins-official   then type  /discord:configure <your token>'
Say TODO 'DM the bot; it replies with a pairing code. In that session:  /discord:access pair <code>   then  /discord:access policy allowlist'
Say TODO 'Exit that session, then start the bot: sign out and in, or run  Start-ScheduledTask BotBoxPrivateClaude'
Say TODO 'Test: DM the bot "status". If the reply is denied, run /mcp in the bot session and check the Discord server name matches mcp__plugin_discord_discord in private-bot.settings.json'
exit 0
