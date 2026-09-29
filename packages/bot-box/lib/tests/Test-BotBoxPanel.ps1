<#
.SYNOPSIS
  Offline tests for lib\BotBoxPanel.psm1: access list edits, the access section given to the
  bot, usage reading, the idle-restart decision, process trees and the scheduled-task
  definition. Uses temporary files only; never registers a task, stops a process or touches
  the real access.json.

  Run:  powershell -NoProfile -ExecutionPolicy Bypass -File .\lib\tests\Test-BotBoxPanel.ps1
#>
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Import-Module (Join-Path (Split-Path -Parent $here) 'BotBoxPanel.psm1') -Force

$script:passed = 0
$script:failed = 0
function Check {
    param([string]$Name, [bool]$Condition, [string]$Detail = '')
    if ($Condition) { $script:passed++; Write-Host "PASS  $Name" -ForegroundColor Green }
    else { $script:failed++; Write-Host "FAIL  $Name  $Detail" -ForegroundColor Red }
}
function Throws([scriptblock]$Block) { try { & $Block; return $false } catch { return $true } }

$root = Join-Path ([System.IO.Path]::GetTempPath()) ('botbox-panel-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $root | Out-Null
$owner = '111111111111111042'
$friend = '222222222222222333'
$chan = '333333333333330302'

function New-AccessFixture {
    $acc = Join-Path $root ('access-' + [guid]::NewGuid().ToString('N').Substring(0, 6) + '.json')
    $lab = "$acc.labels.json"
    # Shape written by configure-discord.ps1.
    $text = '{"dmPolicy":"allowlist","allowFrom":["' + $owner + '"],"groups":{"' + $chan + '":{"requireMention":false,"allowFrom":["' + $owner + '"]}}}'
    [System.IO.File]::WriteAllText($acc, $text)
    return [pscustomobject]@{ Access = $acc; Labels = $lab }
}

try {
    # ------------------------------------------------------------------ access
    $f = New-AccessFixture
    $a = Get-BotAccess -AccessFile $f.Access -LabelsFile $f.Labels
    Check 'single user is inferred as owner' ($a.Owner -eq $owner -and $a.OwnerSource -eq 'only user' -and $a.Users.Count -eq 1)

    Add-BotAccessUser -AccessFile $f.Access -LabelsFile $f.Labels -UserId $friend -Label 'Mei "quote"; drop'
    $raw = Get-Content -Raw $f.Access | ConvertFrom-Json
    Check 'added user can DM' (@($raw.allowFrom) -contains $friend -and @($raw.allowFrom) -contains $owner)
    Check 'added user can use the channel' (@($raw.groups.$chan.allowFrom) -contains $friend)
    Check 'channel settings kept' ($raw.groups.$chan.requireMention -eq $false -and $raw.dmPolicy -eq 'allowlist')
    $a = Get-BotAccess -AccessFile $f.Access -LabelsFile $f.Labels
    Check 'owner recorded before the list grew' ($a.Owner -eq $owner -and $a.OwnerSource -eq 'recorded')
    Check 'label sanitised for the prompt' ((@($a.Users | Where-Object Id -eq $friend)[0].Label) -eq 'Mei quote drop')
    $bytes = [System.IO.File]::ReadAllBytes($f.Access)
    Check 'access.json is LF, no BOM, ASCII' ((@($bytes | Where-Object { $_ -eq 13 -or $_ -gt 127 }).Count -eq 0) -and $bytes[0] -eq [byte][char]'{')
    Check 'single-element arrays stay arrays' ((Get-Content -Raw $f.Labels) -notmatch '"allowFrom":\s*"')

    Add-BotAccessUser -AccessFile $f.Access -LabelsFile $f.Labels -UserId $friend
    Check 'adding twice is a no-op' ((@((Get-Content -Raw $f.Access | ConvertFrom-Json).allowFrom)).Count -eq 2)
    Check 'invalid ID rejected' (Throws { Add-BotAccessUser -AccessFile $f.Access -LabelsFile $f.Labels -UserId '12345' })
    Check 'owner cannot be removed' (Throws { Remove-BotAccessUser -AccessFile $f.Access -LabelsFile $f.Labels -UserId $owner })

    Remove-BotAccessUser -AccessFile $f.Access -LabelsFile $f.Labels -UserId $friend
    $raw = Get-Content -Raw $f.Access | ConvertFrom-Json
    Check 'removed user gone from DMs and channel' ((@($raw.allowFrom) -notcontains $friend) -and (@($raw.groups.$chan.allowFrom) -notcontains $friend))

    # Two users and no recorded owner (e.g. access.json edited by hand): nothing is guessed.
    $g = New-AccessFixture
    [System.IO.File]::WriteAllText($g.Access, ('{"dmPolicy":"allowlist","allowFrom":["' + $owner + '","' + $friend + '"],"groups":{}}'))
    $a = Get-BotAccess -AccessFile $g.Access -LabelsFile $g.Labels
    Check 'ambiguous owner is not guessed' ($null -eq $a.Owner)
    Check 'adding is refused until the owner is set' (Throws { Add-BotAccessUser -AccessFile $g.Access -LabelsFile $g.Labels -UserId '444444444444444444' })
    $n = Get-BotAccessNotice -Access $a
    Check 'no-owner notice shares private data with no one' ($n -match 'NOT SET' -and $n -match 'with no one')
    Set-BotAccessOwner -AccessFile $g.Access -LabelsFile $g.Labels -UserId $owner
    Check 'owner can be set' ((Get-BotAccess -AccessFile $g.Access -LabelsFile $g.Labels).Owner -eq $owner)

    # ------------------------------------------------------------------ notice for the prompt
    $f = New-AccessFixture
    $n = Get-BotAccessNotice -Access (Get-BotAccess -AccessFile $f.Access -LabelsFile $f.Labels)
    Check 'owner-only notice' ($n -match "Owner: Jie, Discord user_id $owner" -and $n -match 'Nobody else')
    Add-BotAccessUser -AccessFile $f.Access -LabelsFile $f.Labels -UserId $friend -Label 'Mei'
    $n = Get-BotAccessNotice -Access (Get-BotAccess -AccessFile $f.Access -LabelsFile $f.Labels)
    Check 'notice lists the extra user' ($n -match "Also allowed: Mei, Discord user_id $friend")
    Check 'notice keeps positions and P&L owner-only' ($n -match 'positions, P&L, fills, trades' -and $n -match 'owner only')
    Check 'notice overrides the fixed owner-only rule' ($n -match 'This list replaces')
    $missing = Get-BotAccess -AccessFile (Join-Path $root 'nope.json') -LabelsFile (Join-Path $root 'nope2.json')
    Check 'missing access list answers no one' ((Get-BotAccessNotice -Access $missing) -match 'Answer no one')

    # ------------------------------------------------------------------ usage
    $now = Get-Date '2026-09-29T12:00:00'
    $epoch = [datetime]'1970-01-01Z'
    $unix = { param($dt) [int64](($dt.ToUniversalTime() - $epoch.ToUniversalTime()).TotalSeconds) }
    $uf = Join-Path $root 'usage.json'
    $doc = @{ updated_at = (& $unix $now); rate_limits_observed_at = (& $unix $now.AddMinutes(-5)); rate_limits = @{
        five_hour = @{ used_percentage = 23.4; resets_at = (& $unix $now.AddHours(2)) }
        seven_day = @{ used_percentage = 41.2; resets_at = (& $unix $now.AddHours(-1)) } } }
    [System.IO.File]::WriteAllText($uf, ($doc | ConvertTo-Json -Depth 5))
    $u = Get-BotUsage -UsageFile $uf -Now $now
    $w5 = $u.Windows[0]; $w7 = $u.Windows[1]
    Check 'usage: 5-hour used and left' ($u.Available -and $w5.State -eq 'ok' -and $w5.Used -eq 23.4 -and [math]::Abs($w5.Left - 76.6) -lt 0.01)
    Check 'usage: a passed reset is not shown as current' ($w7.State -eq 'reset')
    Check 'usage: text' ((Format-BotUsageWindow -Window $w5) -match '^5-hour: 23% used, 77% left, resets ')
    $u = Get-BotUsage -UsageFile (Join-Path $root 'none.json') -Now $now
    Check 'usage: no file means no reading' ((-not $u.Available) -and $u.Windows[0].State -eq 'none')

    # ------------------------------------------------------------------ restart decision
    $launchStale = [pscustomobject]@{ repos = @([pscustomobject]@{ repo = 'market_dashboard'; fresh = $false }, [pscustomobject]@{ repo = 'jie_wiki'; fresh = $true }) }
    $r = @([pscustomobject]@{ Repo = 'jie_wiki'; Fresh = $true; Pulled = $false }, [pscustomobject]@{ Repo = 'market_dashboard'; Fresh = $false; Pulled = $false })
    Check 'no change: no restart' ($null -eq (Get-BotRestartReason -LaunchState $launchStale -Results $r))
    $r[0].Pulled = $true
    Check 'update pulled: restart' ((Get-BotRestartReason -LaunchState $launchStale -Results $r) -match 'jie_wiki was updated')
    $r = @([pscustomobject]@{ Repo = 'market_dashboard'; Fresh = $true; Pulled = $false })
    Check 'stale at launch, current now: restart' ((Get-BotRestartReason -LaunchState $launchStale -Results $r) -match 'current again')
    Check 'no launch state and nothing pulled: no restart' ($null -eq (Get-BotRestartReason -LaunchState $null -Results $r))

    Check 'idle after 10 minutes' (Test-BotIdle -LastActivity $now.AddMinutes(-10) -Now $now)
    Check 'busy within 10 minutes' (-not (Test-BotIdle -LastActivity $now.AddMinutes(-3) -Now $now))
    $tr = Join-Path $root 'transcript.jsonl'
    Set-Content -Path $tr -Value 'x'
    (Get-Item $tr).LastWriteTime = $now.AddMinutes(-2)
    [System.IO.File]::WriteAllText($uf, ('{"transcript_path":' + ($tr | ConvertTo-Json) + '}'))
    $last = Get-BotLastActivity -UsageFile $uf -StartedAt $now.AddHours(-1)
    Check 'last activity comes from the bot transcript' ([math]::Abs(($last - $now.AddMinutes(-2)).TotalSeconds) -lt 2)
    $last = Get-BotLastActivity -UsageFile (Join-Path $root 'none.json') -StartedAt $now.AddMinutes(-30)
    Check 'no transcript yet: activity is the start time' ($last -eq $now.AddMinutes(-30))

    # ------------------------------------------------------------------ process tree
    $procs = @(
        [pscustomobject]@{ ProcessId = 10; ParentProcessId = 1 },   # launcher
        [pscustomobject]@{ ProcessId = 20; ParentProcessId = 10 },  # claude
        [pscustomobject]@{ ProcessId = 30; ParentProcessId = 20 },  # bun
        [pscustomobject]@{ ProcessId = 31; ParentProcessId = 30 },  # bun child
        [pscustomobject]@{ ProcessId = 40; ParentProcessId = 1 }    # unrelated
    )
    $t = @(Get-BotProcessTree -RootId 20 -Processes $procs)
    Check 'process tree covers claude and the Discord plugin' (($t -join ',') -eq '20,30,31')

    # ------------------------------------------------------------------ scheduled task definition (not registered)
    $d = New-BotRefreshTaskDefinition -ScriptPath 'C:\x\refresh-repos.ps1'
    Check 'task repeats hourly' ($d.Trigger.Repetition.Interval -eq 'PT1H')
    Check 'task repeats indefinitely' ([string]::IsNullOrEmpty($d.Trigger.Repetition.Duration)) ("duration '$($d.Trigger.Repetition.Duration)'")
    Check 'task runs only while signed in' ($d.Principal.LogonType -eq 'Interactive' -and $d.Principal.RunLevel -eq 'Limited')
    Check 'task runs hidden with the refresh script' ($d.Action.Arguments -match '-WindowStyle Hidden' -and $d.Action.Arguments -match 'refresh-repos\.ps1')
    Check 'task never overlaps itself' ($d.Settings.MultipleInstances -eq 'IgnoreNew')
} finally {
    Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:passed, $script:failed)
if ($script:failed -gt 0) { exit 1 }
exit 0
