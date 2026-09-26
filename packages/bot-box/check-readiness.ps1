<#
.SYNOPSIS
  Read-only readiness report for the 24/7 "bot box" (the secondary PC).

.DESCRIPTION
  Changes nothing. Reports whether this machine can stay on unattended and host
  the private Claude Discord bot, the friends' bot, the podcast, and (after a
  deliberate failover) the broker tasks.

  Each line is PASS, WARN, FAIL or INFO. FAIL means the bot box will not work
  until it is fixed. WARN means it works but will eventually bite.

  Run:  powershell -NoProfile -ExecutionPolicy Bypass -File .\check-readiness.ps1
#>
[CmdletBinding()]
param(
    [string]$WorkspaceRoot = (Join-Path $env:USERPROFILE 'AI codes hub')
)

$ErrorActionPreference = 'SilentlyContinue'
$script:Counts = @{ PASS = 0; WARN = 0; FAIL = 0; INFO = 0 }
# Judge what a fresh sign-in sees: a console opened before a winget install has a stale PATH.
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')

function Show-Row {
    param([string]$Level, [string]$Name, [string]$Detail)
    $script:Counts[$Level]++
    $color = @{ PASS = 'Green'; WARN = 'Yellow'; FAIL = 'Red'; INFO = 'Gray' }[$Level]
    Write-Host ('[{0}] {1,-34} {2}' -f $Level, $Name, $Detail) -ForegroundColor $color
}

function Get-PowerIndex {
    param([string]$SubGroup, [string]$Setting)
    $out = powercfg /query SCHEME_CURRENT $SubGroup $Setting 2>$null
    $result = @{ AC = $null; DC = $null }
    foreach ($line in $out) {
        if ($line -match 'Current AC Power Setting Index:\s*0x([0-9a-fA-F]+)') { $result.AC = [Convert]::ToInt32($Matches[1], 16) }
        if ($line -match 'Current DC Power Setting Index:\s*0x([0-9a-fA-F]+)') { $result.DC = [Convert]::ToInt32($Matches[1], 16) }
    }
    return $result
}

function Test-Tool {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-Port {
    param([int]$Port)
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        $ok = $async.AsyncWaitHandle.WaitOne(1500) -and $client.Connected
        return $ok
    } catch { return $false } finally { $client.Close() }
}

Write-Host ''
Write-Host '=== MACHINE ===' -ForegroundColor Cyan
$cs = Get-CimInstance Win32_ComputerSystem
$os = Get-CimInstance Win32_OperatingSystem
$isLaptop = ($cs.PCSystemType -eq 2)
Show-Row INFO 'Hostname' $env:COMPUTERNAME
Show-Row INFO 'Model' ("{0} {1}" -f $cs.Manufacturer, $cs.Model)
Show-Row INFO 'OS' ("{0} build {1}" -f $os.Caption, $os.BuildNumber)
Show-Row INFO 'Last boot' ([string]$os.LastBootUpTime)
$ramGb = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
if ($ramGb -ge 8) { Show-Row PASS 'RAM' "$ramGb GB" } else { Show-Row WARN 'RAM' "$ramGb GB (8 GB+ recommended for Claude Code + Chrome + bots)" }
if ($isLaptop) {
    Show-Row WARN 'Form factor' 'LAPTOP: keep it on AC, set lid close to Do nothing, and cap battery charge (e.g. 80%) in the vendor app to avoid swelling'
} else {
    Show-Row PASS 'Form factor' 'desktop'
    Show-Row INFO 'BIOS power-on after AC loss' 'check manually in BIOS: "Restore on AC power loss" = Power On, so it returns after a power cut'
}
$marker = Join-Path $env:LOCALAPPDATA 'Jie\bot-box\designated-host.txt'
if ((Test-Path $marker) -and ((Get-Content $marker -TotalCount 1).Trim() -eq $env:COMPUTERNAME)) {
    Show-Row PASS 'Bot box designation' 'this machine is the designated bot box'
} else {
    Show-Row INFO 'Bot box designation' 'not designated yet (install-private-bot.ps1 designates the machine it runs on)'
}

Write-Host ''
Write-Host '=== POWER (must never sleep on AC) ===' -ForegroundColor Cyan
$sleep = Get-PowerIndex 'SUB_SLEEP' 'STANDBYIDLE'
if ($null -eq $sleep.AC) { Show-Row WARN 'Sleep on AC' 'could not read - check Settings > System > Power' } elseif ($sleep.AC -eq 0) { Show-Row PASS 'Sleep on AC' 'never' } else { Show-Row FAIL 'Sleep on AC' ("after {0} min. Fix: powercfg /change standby-timeout-ac 0" -f ($sleep.AC / 60)) }
$hib = Get-PowerIndex 'SUB_SLEEP' 'HIBERNATEIDLE'
if ($null -eq $hib.AC) { Show-Row WARN 'Hibernate on AC' 'could not read - check manually' } elseif ($hib.AC -eq 0) { Show-Row PASS 'Hibernate on AC' 'never' } else { Show-Row FAIL 'Hibernate on AC' ("after {0} min. Fix: powercfg /change hibernate-timeout-ac 0" -f ($hib.AC / 60)) }
if ($isLaptop) {
    $lid = Get-PowerIndex 'SUB_BUTTONS' 'LIDACTION'
    if ($null -eq $lid.AC) {
        Show-Row WARN 'Lid close on AC' 'not exposed by powercfg on this machine - check manually: Control Panel > Power Options > Choose what closing the lid does > Do nothing (plugged in)'
    } else {
    $lidText = @{ 0 = 'Do nothing'; 1 = 'Sleep'; 2 = 'Hibernate'; 3 = 'Shut down' }[[int]$lid.AC]
    if ($lid.AC -eq 0) { Show-Row PASS 'Lid close on AC' $lidText } else { Show-Row FAIL 'Lid close on AC' "$lidText. Fix: Control Panel > Power Options > Choose what closing the lid does > Do nothing (plugged in)" }
    }
    $bat = Get-CimInstance -Namespace root/wmi -ClassName BatteryStatus | Select-Object -First 1
    if ($bat -and $bat.PowerOnline) { Show-Row PASS 'On AC power now' 'yes' } elseif ($bat) { Show-Row FAIL 'On AC power now' 'NO - running on battery' }
}

Write-Host ''
Write-Host '=== NETWORK ===' -ForegroundColor Cyan
$ups = Get-NetAdapter -Physical | Where-Object Status -eq 'Up'
foreach ($a in $ups) {
    $wired = ($a.MediaType -match '802\.3') -or ($a.Name -match 'Ethernet')
    if ($wired) { Show-Row PASS 'Active adapter' ("{0} ({1})" -f $a.Name, $a.LinkSpeed) }
    else { Show-Row WARN 'Active adapter' ("{0} ({1}) - Wi-Fi works; wired Ethernet is more reliable for 24/7" -f $a.Name, $a.LinkSpeed) }
}
if (-not $ups) { Show-Row FAIL 'Active adapter' 'no connected network adapter' }
foreach ($h in @('discord.com', 'api.anthropic.com', 'github.com', 'api.deepseek.com')) {
    $r = Test-NetConnection -ComputerName $h -Port 443 -WarningAction SilentlyContinue -InformationLevel Quiet
    if ($r) { Show-Row PASS "Reach $h" 'ok' } else { Show-Row FAIL "Reach $h" 'cannot connect on 443' }
}

Write-Host ''
Write-Host '=== WINDOWS UPDATE / LOGIN ===' -ForegroundColor Cyan
$ah = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings'
if ($ah -and $null -ne $ah.ActiveHoursStart) { Show-Row INFO 'Active hours' ("{0}:00 - {1}:00 (updates avoid restarting inside this window)" -f $ah.ActiveHoursStart, $ah.ActiveHoursEnd) }
else { Show-Row WARN 'Active hours' 'not set: Settings > Windows Update > Advanced > Active hours' }
$pending = (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired') -or (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending')
if ($pending) { Show-Row WARN 'Reboot pending' 'yes - reboot once now, while you are at the machine' } else { Show-Row PASS 'Reboot pending' 'no' }
$wl = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
if ($wl.AutoAdminLogon -eq '1') { Show-Row PASS 'Auto-login' 'enabled - bots can start after a reboot without you' }
else { Show-Row WARN 'Auto-login' 'off - after any reboot nothing runs until someone logs in (Sysinternals Autologon sets it safely)' }

Write-Host ''
Write-Host '=== DISK ===' -ForegroundColor Cyan
$c = Get-PSDrive C
$freeGb = [math]::Round($c.Free / 1GB, 1)
if ($freeGb -ge 20) { Show-Row PASS 'C: free' "$freeGb GB" } else { Show-Row WARN 'C: free' "$freeGb GB (podcast audio and logs need room)" }

Write-Host ''
Write-Host '=== SOFTWARE ===' -ForegroundColor Cyan
foreach ($t in @('git', 'gh', 'python', 'node', 'bun', 'claude')) {
    if (Test-Tool $t) {
        $v = (& $t --version 2>$null | Select-Object -First 1)
        Show-Row PASS $t ([string]$v)
    } else {
        $lvl = if ($t -eq 'node') { 'WARN' } else { 'FAIL' }
        Show-Row $lvl $t 'not installed / not on PATH'
    }
}
if (Test-Tool 'claude') {
    $cv = (& claude --version 2>$null | Select-Object -First 1)
    if ($cv -match '(\d+)\.(\d+)\.(\d+)') {
        $n = [int]$Matches[1] * 1000000 + [int]$Matches[2] * 1000 + [int]$Matches[3]
        if ($n -ge 2001211) { Show-Row PASS 'Claude Code >= 2.1.211' 'needed for Chrome integration on Windows' }
        else { Show-Row FAIL 'Claude Code >= 2.1.211' "found $cv - update: claude update" }
    }
}
if (Test-Tool 'gh') {
    $ghOk = (gh auth status 2>&1 | Select-String 'Logged in')
    if ($ghOk) { Show-Row PASS 'gh auth' 'logged in' } else { Show-Row WARN 'gh auth' 'not logged in: gh auth login' }
}
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($chrome) { Show-Row PASS 'Google Chrome' $chrome } else { Show-Row FAIL 'Google Chrome' 'not installed' }
$nmh = Get-ChildItem 'HKCU:\Software\Google\Chrome\NativeMessagingHosts' | Where-Object { $_.PSChildName -match 'claude' }
if ($nmh) { Show-Row PASS 'Claude-in-Chrome host' 'registered (claude --chrome has run once)' }
else { Show-Row WARN 'Claude-in-Chrome host' 'not registered yet: install the Claude extension, then run claude --chrome once' }
$plugins = Join-Path $env:USERPROFILE '.claude\plugins\installed_plugins.json'
if ((Test-Path $plugins) -and (Select-String -Path $plugins -Pattern 'discord@claude-plugins-official' -Quiet)) {
    Show-Row PASS 'Discord channel plugin' 'installed'
    $userSettings = Join-Path $env:USERPROFILE '.claude\settings.json'
    $enabled = $null
    if (Test-Path $userSettings) { $enabled = (Get-Content -Raw -Path $userSettings | ConvertFrom-Json).enabledPlugins.'discord@claude-plugins-official' }
    if ($enabled -eq $false) { Show-Row PASS 'Plugin off for ordinary sessions' 'only the bot session logs in to Discord' }
    else { Show-Row FAIL 'Plugin off for ordinary sessions' 'enabled for every session: claude plugin disable discord@claude-plugins-official --scope user' }
    $dcDir = Join-Path $env:USERPROFILE '.claude\channels\discord'
    $dcEnv = Join-Path $dcDir '.env'
    $hasToken = (Test-Path $dcEnv) -and (Select-String -Path $dcEnv -Pattern '^DISCORD_BOT_TOKEN=.' -Quiet)
    $dcAccess = $null
    if (Test-Path (Join-Path $dcDir 'access.json')) { $dcAccess = Get-Content -Raw -Path (Join-Path $dcDir 'access.json') | ConvertFrom-Json }
    if ($hasToken -and $dcAccess -and $dcAccess.dmPolicy -eq 'allowlist' -and @($dcAccess.allowFrom).Count -eq 1) { Show-Row PASS 'Discord token + allowlist' 'token saved (value not shown), DMs from one user ID' }
    elseif ($hasToken) { Show-Row WARN 'Discord token + allowlist' 'token saved but access is not a one-user allowlist: run configure-discord.ps1 -UserId <id> -SkipToken' }
    else { Show-Row INFO 'Discord token + allowlist' 'not set yet: configure-discord.ps1 -UserId <id>' }
}
else { Show-Row INFO 'Discord channel plugin' 'not installed yet (install-private-bot.ps1 guides this)' }

Write-Host ''
Write-Host '=== REPOSITORIES ===' -ForegroundColor Cyan
foreach ($repo in @('jie_wiki', 'market_dashboard')) {
    $p = Join-Path $WorkspaceRoot $repo
    if (-not (Test-Path (Join-Path $p '.git'))) { Show-Row FAIL $repo "missing at $p (run bootstrap-new-pc.ps1)"; continue }
    Push-Location $p
    git fetch origin --quiet 2>$null
    $br = (git rev-parse --abbrev-ref HEAD 2>$null)
    $div = (git rev-list --left-right --count origin/main...HEAD 2>$null)
    $dirty = @(git status --short 2>$null).Count
    Pop-Location
    $lvl = if ($br -eq 'main' -and $div -match '^0\s+0$') { 'PASS' } else { 'WARN' }
    Show-Row $lvl $repo ("branch {0}, behind/ahead {1}, {2} dirty path(s)" -f $br, ($div -replace '\s+', '/'), $dirty)
}
$secrets = Join-Path $env:LOCALAPPDATA 'Jie\secrets'
if (Test-Path $secrets) { Show-Row PASS 'Personal secrets store' 'present (contents not read)' } else { Show-Row FAIL 'Personal secrets store' "missing at $secrets (restored by the bootstrap from the .jiebundle)" }

Write-Host ''
Write-Host '=== BROKERS (one machine only) ===' -ForegroundColor Cyan
$brokerTasks = @('DashboardBridge', 'DashboardOpenDWatchdog', 'IBKRBridge', 'IBKRFlexDaily', 'PaperTraderDaily', 'MarketDashboardRefresh')
$present = @()
foreach ($t in $brokerTasks) { if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) { $present += $t } }
if ($present.Count -eq 0) { Show-Row INFO 'Broker scheduled tasks' 'none installed here - correct until the deliberate failover (README step B)' }
else { Show-Row WARN 'Broker scheduled tasks' ("installed here: {0}. Must be DISABLED on the other PC, never both." -f ($present -join ', ')) }
if (Test-Port 11111) { Show-Row INFO 'moomoo OpenD (11111)' 'listening' } else { Show-Row INFO 'moomoo OpenD (11111)' 'not running (expected before failover)' }
if (Test-Port 7496) { Show-Row INFO 'IBKR TWS (7496)' 'listening' } else { Show-Row INFO 'IBKR TWS (7496)' 'not running (expected before failover)' }

Write-Host ''
Write-Host ('SUMMARY: {0} PASS, {1} WARN, {2} FAIL' -f $script:Counts.PASS, $script:Counts.WARN, $script:Counts.FAIL) -ForegroundColor Cyan
if ($script:Counts.FAIL -gt 0) { Write-Host 'Not ready: fix every FAIL line, then run this again.' -ForegroundColor Red }
else { Write-Host 'Ready for the next step in packages/bot-box/README.md.' -ForegroundColor Green }
exit 0
