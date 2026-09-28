<#
.SYNOPSIS
  Tests configure-discord.ps1's access.json handling (-ChannelId, -NoChannels).

.DESCRIPTION
  Runs the script with -SkipToken in a child PowerShell whose USERPROFILE is a throwaway
  folder, so the real %USERPROFILE%\.claude\channels\discord is never written and no token
  is involved. The script's closing Get-ScheduledTask call only reads task state. The
  real access.json is hashed before and after to prove it was not touched.

  powershell -NoProfile -ExecutionPolicy Bypass -File packages/bot-box/tests/Test-ConfigureDiscord.ps1
#>
$ErrorActionPreference = 'Stop'
$configure = Join-Path (Split-Path $PSScriptRoot -Parent) 'configure-discord.ps1'
# Mutation checks point this at a weakened copy; the real script is never edited for them.
if ($env:CONFIGURE_UNDER_TEST) { $configure = $env:CONFIGURE_UNDER_TEST }
$user = '123456789012345678'
$other = '223456789012345678'
$chanA = '333456789012345678'
$chanB = '433456789012345678'
$chanC = '533456789012345678'
$script:failures = 0
$realProfile = $env:USERPROFILE
$realAccess = Join-Path $realProfile '.claude\channels\discord\access.json'
$realHash = if (Test-Path $realAccess) { (Get-FileHash $realAccess).Hash } else { 'absent' }
$fakeHome = Join-Path ([System.IO.Path]::GetTempPath()) ('bot-configure-' + [guid]::NewGuid().ToString('N'))
$state = Join-Path $fakeHome '.claude\channels\discord'
$access = Join-Path $state 'access.json'
$envFile = Join-Path $state '.env'

function Invoke-Configure { param([string[]]$Arguments)
    $env:USERPROFILE = $fakeHome
    try {
        $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $configure @Arguments | Out-String
        return @{ Code = $LASTEXITCODE; Output = $out }
    } finally { $env:USERPROFILE = $realProfile }
}
function Read-Access { Get-Content -Raw -Path $access | ConvertFrom-Json }
function Get-Channels { param($a) if ($a.groups) { @($a.groups.PSObject.Properties.Name | Sort-Object) } else { @() } }
function Check { param([string]$Name, [bool]$Condition)
    if ($Condition) { Write-Host "PASS  $Name" } else { Write-Host "FAIL  $Name" -ForegroundColor Red; $script:failures++ }
}

try {
    # 1. -ChannelId sets the channel, answering only the user.
    $r = Invoke-Configure @('-UserId', $user, '-SkipToken', '-ChannelId', $chanA)
    $a = Read-Access
    Check 'ChannelId run exits 0' ($r.Code -eq 0)
    Check 'ChannelId sets exactly that channel' (((Get-Channels $a) -join ',') -eq $chanA)
    Check 'channel answers only the user' ((@($a.groups.$chanA.allowFrom) -join ',') -eq $user)
    Check 'channel does not require a mention' ($a.groups.$chanA.requireMention -eq $false)
    Check 'DMs stay allowlisted to the user' ($a.dmPolicy -eq 'allowlist' -and (@($a.allowFrom) -join ',') -eq $user)
    $envText = Get-Content -Raw -Path $envFile
    Check '.env holds static mode and no token' ($envText -match 'DISCORD_ACCESS_MODE=static' -and $envText -notmatch 'DISCORD_BOT_TOKEN')

    # 2. Re-running without -ChannelId keeps the channel.
    $r = Invoke-Configure @('-UserId', $user, '-SkipToken')
    Check 'rerun without ChannelId keeps the channel' ($r.Code -eq 0 -and ((Get-Channels (Read-Access)) -join ',') -eq $chanA)

    # 3. A hand-edited file: other people and junk keys are dropped, requireMention is kept.
    $seed = [ordered]@{
        dmPolicy = 'open'; allowFrom = @($user, $other)
        groups = [ordered]@{ $chanA = [ordered]@{ requireMention = $true; allowFrom = @($user, $other) }
                             'notachannel' = [ordered]@{ requireMention = $false; allowFrom = @($other) } }
        pending = [ordered]@{ code = 'x' }
    }
    [System.IO.File]::WriteAllText($access, (([pscustomobject]$seed) | ConvertTo-Json -Depth 6))
    $r = Invoke-Configure @('-UserId', $user, '-SkipToken')
    $a = Read-Access
    Check 'rerun keeps only real channel IDs' ($r.Code -eq 0 -and ((Get-Channels $a) -join ',') -eq $chanA)
    Check 'rerun forces the channel to the user only' ((@($a.groups.$chanA.allowFrom) -join ',') -eq $user)
    Check 'rerun keeps requireMention' ($a.groups.$chanA.requireMention -eq $true)
    Check 'rerun resets DMs to the user only' ($a.dmPolicy -eq 'allowlist' -and (@($a.allowFrom) -join ',') -eq $user)
    Check 'pending pairing codes are removed' ($null -eq $a.PSObject.Properties['pending'])

    # 4. -ChannelId replaces the list (comma-separated).
    $r = Invoke-Configure @('-UserId', $user, '-SkipToken', '-ChannelId', "$chanB,$chanC")
    $a = Read-Access
    Check 'ChannelId list replaces the channels' ($r.Code -eq 0 -and ((Get-Channels $a) -join ',') -eq "$chanB,$chanC")
    Check 'every listed channel answers only the user' ((@($a.groups.$chanB.allowFrom) -join ',') -eq $user -and (@($a.groups.$chanC.allowFrom) -join ',') -eq $user)

    # 5. -NoChannels removes them all.
    $r = Invoke-Configure @('-UserId', $user, '-SkipToken', '-NoChannels')
    Check 'NoChannels leaves DMs only' ($r.Code -eq 0 -and (Get-Channels (Read-Access)).Count -eq 0)

    # 6. Bad input changes nothing.
    $before = (Get-FileHash $access).Hash
    $r = Invoke-Configure @('-UserId', $user, '-SkipToken', '-ChannelId', 'abc')
    Check 'invalid channel ID stops with exit 1' ($r.Code -eq 1)
    $r2 = Invoke-Configure @('-UserId', $user, '-SkipToken', '-ChannelId', $chanA, '-NoChannels')
    Check 'ChannelId with NoChannels stops with exit 1' ($r2.Code -eq 1)
    Check 'refused runs leave access.json unchanged' ((Get-FileHash $access).Hash -eq $before)
} finally {
    $env:USERPROFILE = $realProfile
    if (Test-Path $fakeHome) { Remove-Item -Recurse -Force -Path $fakeHome }
}
$after = if (Test-Path $realAccess) { (Get-FileHash $realAccess).Hash } else { 'absent' }
Check 'the real access.json was not touched' ($after -eq $realHash)

Write-Host ''
Write-Host ('{0} failed' -f $script:failures)
exit $script:failures
