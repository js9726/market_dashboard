<#
.SYNOPSIS
  Stores the #j_asistant webhook URL as the GitHub secret DISCORD_BRIEF_WEBHOOK_URL.

.DESCRIPTION
  Create the webhook in Discord first: #j_asistant > Edit Channel > Integrations >
  Webhooks > New Webhook > Copy Webhook URL. Then run this and paste the URL at the hidden
  prompt. The URL is checked, handed to `gh secret set` on standard input (never on the
  command line, in a file or on screen) and forgotten. Anyone holding the URL can post in
  the channel, so never paste it into a chat; if it leaks, delete the webhook in Discord
  and make a new one.

  -SendTest  also posts one short "webhook connected" message to the channel

  Run:  powershell -NoProfile -ExecutionPolicy Bypass -File .\set-brief-webhook.ps1 -SendTest
#>
[CmdletBinding()]
param([switch]$SendTest, [string]$Repo = 'js9726/market_dashboard')

$ErrorActionPreference = 'Stop'
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Write-Host '[STOP] GitHub CLI (gh) is not installed or not on PATH.' -ForegroundColor Red; exit 1 }

$secure = Read-Host 'Paste the #j_asistant webhook URL (input is hidden)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $url = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }

if ($url -notmatch '^https://(discord|discordapp)\.com/api/webhooks/\d{17,20}/[A-Za-z0-9_-]{30,100}$') {
    Remove-Variable url
    Write-Host '[STOP] That is not a Discord webhook URL (https://discord.com/api/webhooks/<id>/<token>). Nothing saved.' -ForegroundColor Red
    exit 1
}

$ErrorActionPreference = 'Continue'
$url | & gh secret set DISCORD_BRIEF_WEBHOOK_URL --repo $Repo 2>&1 | Out-Null
$code = $LASTEXITCODE
if ($code -ne 0) {
    Remove-Variable url
    Write-Host "[STOP] gh secret set failed (exit $code). Check 'gh auth status'. Nothing else was changed." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Saved as the GitHub secret DISCORD_BRIEF_WEBHOOK_URL on $Repo (value not shown)" -ForegroundColor Green

if ($SendTest) {
    $body = @{ username = 'Pre-open brief'; content = 'Webhook connected: the DeepSeek pre-open brief will be posted here on US trading days, around 09:00 ET.'
               allowed_mentions = @{ parse = @() } } | ConvertTo-Json -Depth 3
    try {
        Invoke-RestMethod -Method Post -Uri ($url + '?wait=true') -ContentType 'application/json' -Body $body | Out-Null
        Write-Host '[OK] Test message posted to the channel' -ForegroundColor Green
    } catch {
        Write-Host ('[WARN] The secret is saved, but the test post failed: HTTP {0}' -f $_.Exception.Response.StatusCode.value__) -ForegroundColor Yellow
    }
}
Remove-Variable url
