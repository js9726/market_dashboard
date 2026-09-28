<#
.SYNOPSIS
  Saves the private bot's Discord token and locks the bot to your Discord account, in DMs
  and in the server channels you name.

.DESCRIPTION
  You paste the token at a hidden prompt. It is never echoed, never kept in PowerShell
  history and never passes through a Claude session (typing /discord:configure <token>
  inside Claude Code would put it in that session's transcript).

  Writes, under %USERPROFILE%\.claude\channels\discord\ (read by the Discord plugin):
    .env         DISCORD_BOT_TOKEN=... and DISCORD_ACCESS_MODE=static
    access.json  dmPolicy "allowlist", allowFrom = your user ID, and one entry under
                 "groups" per server channel, each answering only your user ID

  Static mode loads access.json once at bot start, so a running bot cannot widen its
  own allowlist. After editing access.json, restart the bot.

  -UserId <id>   your Discord user ID (Discord: User Settings > Advanced > Developer
                 Mode, then right-click your avatar > Copy User ID). Not a secret.
  -ChannelId <id>[,<id>]  the server channels the bot works in (Discord: right-click the
                 channel > Copy Channel ID). Replaces the channel list. Without it the
                 channels already configured are kept, so re-running never drops them.
                 Every channel answers only -UserId, whatever the file said before; other
                 people in the channel can read the bot's replies but cannot command it.
  -NoChannels    remove every server channel (DMs only)
  -SkipToken     only rewrite access.json
  -Clear         remove the token (the bot can no longer connect)

  Run:  powershell -NoProfile -ExecutionPolicy Bypass -File .\configure-discord.ps1 -UserId 123456789012345678 -ChannelId 123456789012345679
#>
[CmdletBinding()]
param(
    [string]$UserId,
    [string[]]$ChannelId,
    [switch]$NoChannels,
    [switch]$SkipToken,
    [switch]$Clear
)

$ErrorActionPreference = 'Stop'
$stateDir = Join-Path $env:USERPROFILE '.claude\channels\discord'
$envFile = Join-Path $stateDir '.env'
$accessFile = Join-Path $stateDir 'access.json'

# The plugin parses .env line by line with ^(\w+)=(.*)$ and no multiline flag, so a CR
# before the newline makes the line silently fail to match. Write LF-only UTF-8, no BOM.
function Write-EnvFile { param([hashtable]$Values)
    $keep = @()
    if (Test-Path $envFile) {
        $keep = @(Get-Content -Path $envFile | Where-Object { $_ -match '^\w+=' -and -not $Values.ContainsKey(($_ -split '=', 2)[0]) })
    }
    $lines = $keep + @($Values.GetEnumerator() | Where-Object { $null -ne $_.Value } | ForEach-Object { '{0}={1}' -f $_.Key, $_.Value })
    [System.IO.File]::WriteAllText($envFile, (($lines -join "`n") + "`n"))
}

New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

if ($Clear) {
    if (Test-Path $envFile) {
        $rest = @(Get-Content -Path $envFile | Where-Object { $_ -match '^\w+=' -and $_ -notmatch '^DISCORD_BOT_TOKEN=' })
        if ($rest.Count -gt 0) { [System.IO.File]::WriteAllText($envFile, (($rest -join "`n") + "`n")) } else { Remove-Item -Path $envFile -Force }
    }
    Write-Host '[OK] Token removed. Restart the bot for this to take effect.' -ForegroundColor Green
    exit 0
}

if (-not $UserId) {
    Write-Host '[STOP] Pass -UserId with your Discord user ID (Developer Mode > right-click your avatar > Copy User ID).' -ForegroundColor Red
    exit 1
}
if ($UserId -notmatch '^\d{17,20}$') {
    Write-Host "[STOP] '$UserId' is not a Discord user ID (17-20 digits). Nothing saved." -ForegroundColor Red
    exit 1
}
# Accept "-ChannelId a,b" and "-ChannelId a -ChannelId b"-style lists alike.
$channels = @($ChannelId | ForEach-Object { "$_" -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($NoChannels -and $channels.Count -gt 0) {
    Write-Host '[STOP] Use -ChannelId or -NoChannels, not both. Nothing saved.' -ForegroundColor Red
    exit 1
}
foreach ($id in $channels) {
    if ($id -notmatch '^\d{17,20}$') {
        Write-Host "[STOP] '$id' is not a Discord channel ID (17-20 digits). Nothing saved." -ForegroundColor Red
        exit 1
    }
}

if (-not $SkipToken) {
    $secure = Read-Host 'Paste the bot token (Developer Portal > Bot > Reset Token). Input is hidden' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    # Bot tokens are three base64url parts joined by dots.
    if ($token -notmatch '^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{20,}$') {
        Remove-Variable token
        Write-Host '[STOP] That does not look like a bot token (three parts separated by dots). Nothing saved.' -ForegroundColor Red
        exit 1
    }
    Write-EnvFile @{ DISCORD_BOT_TOKEN = $token; DISCORD_ACCESS_MODE = 'static' }
    Remove-Variable token
    Write-Host "[OK] Token saved to $envFile (not shown)" -ForegroundColor Green
} else {
    Write-EnvFile @{ DISCORD_ACCESS_MODE = 'static' }
}

$access = [ordered]@{}
if (Test-Path $accessFile) {
    $old = Get-Content -Raw -Path $accessFile | ConvertFrom-Json
    foreach ($p in $old.PSObject.Properties) { $access[$p.Name] = $p.Value }
}
# Channels: the -ChannelId list, or none with -NoChannels, or else the ones already in the
# file (only real channel IDs). Each keeps its requireMention setting (default off) and
# answers only $UserId.
$previous = @{}
if ($access.Contains('groups') -and $access['groups']) {
    foreach ($p in $access['groups'].PSObject.Properties) {
        if ($p.Name -match '^\d{17,20}$') { $previous[$p.Name] = $p.Value }
    }
}
if ($NoChannels) { $keep = @() } elseif ($channels.Count -gt 0) { $keep = $channels } else { $keep = @($previous.Keys | Sort-Object) }
$groups = [ordered]@{}
foreach ($id in $keep) {
    $mention = $false
    if ($previous.ContainsKey($id) -and $previous[$id] -and $previous[$id].PSObject.Properties['requireMention']) {
        $mention = [bool]$previous[$id].requireMention
    }
    $groups[$id] = [pscustomobject][ordered]@{ requireMention = $mention; allowFrom = @($UserId) }
}
$access['dmPolicy'] = 'allowlist'
$access['allowFrom'] = @($UserId)
$access['groups'] = [pscustomobject]$groups
if ($access.Contains('pending')) { $access.Remove('pending') }
[System.IO.File]::WriteAllText($accessFile, ((([pscustomobject]$access) | ConvertTo-Json -Depth 6) + "`n"))
if ($keep.Count -gt 0) {
    Write-Host ("[OK] DMs and channel(s) {0} answer user $UserId only; allowlist loaded at bot start" -f ($keep -join ', ')) -ForegroundColor Green
} else {
    Write-Host "[OK] DMs allowed from user $UserId only; no server channels; allowlist loaded at bot start" -ForegroundColor Green
}

$task = Get-ScheduledTask -TaskName 'BotBoxPrivateClaude' -ErrorAction SilentlyContinue
if ($task -and $task.State -eq 'Running') {
    Write-Host '[TODO] The bot is running with the old settings: close its console window, then  Start-ScheduledTask BotBoxPrivateClaude' -ForegroundColor Yellow
} else {
    Write-Host '[TODO] Start the bot:  Start-ScheduledTask BotBoxPrivateClaude   then DM it "status"' -ForegroundColor Yellow
}
exit 0
