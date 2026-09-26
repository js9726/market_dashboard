<#
.SYNOPSIS
  Saves the private bot's Discord token and locks its DMs to your Discord account.

.DESCRIPTION
  You paste the token at a hidden prompt. It is never echoed, never kept in PowerShell
  history and never passes through a Claude session (typing /discord:configure <token>
  inside Claude Code would put it in that session's transcript).

  Writes, under %USERPROFILE%\.claude\channels\discord\ (read by the Discord plugin):
    .env         DISCORD_BOT_TOKEN=... and DISCORD_ACCESS_MODE=static
    access.json  dmPolicy "allowlist", allowFrom = your user ID, no server channels

  Static mode loads access.json once at bot start, so a running bot cannot widen its
  own allowlist. After editing access.json, restart the bot.

  -UserId <id>   your Discord user ID (Discord: User Settings > Advanced > Developer
                 Mode, then right-click your avatar > Copy User ID). Not a secret.
  -SkipToken     only rewrite access.json
  -Clear         remove the token (the bot can no longer connect)

  Run:  powershell -NoProfile -ExecutionPolicy Bypass -File .\configure-discord.ps1 -UserId 123456789012345678
#>
[CmdletBinding()]
param(
    [string]$UserId,
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
$access['dmPolicy'] = 'allowlist'
$access['allowFrom'] = @($UserId)
$access['groups'] = New-Object PSObject
if ($access.Contains('pending')) { $access.Remove('pending') }
[System.IO.File]::WriteAllText($accessFile, ((([pscustomobject]$access) | ConvertTo-Json -Depth 6) + "`n"))
Write-Host "[OK] DMs allowed from user $UserId only; server channels off; allowlist loaded at bot start" -ForegroundColor Green

$task = Get-ScheduledTask -TaskName 'BotBoxPrivateClaude' -ErrorAction SilentlyContinue
if ($task -and $task.State -eq 'Running') {
    Write-Host '[TODO] The bot is running with the old settings: close its console window, then  Start-ScheduledTask BotBoxPrivateClaude' -ForegroundColor Yellow
} else {
    Write-Host '[TODO] Start the bot:  Start-ScheduledTask BotBoxPrivateClaude   then DM it "status"' -ForegroundColor Yellow
}
exit 0
