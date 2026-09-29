<#
.SYNOPSIS
  Functions behind the bot-box control panel and the hourly repo refresher:
  the Discord access list, subscription usage, the bot process, the idle-restart decision
  and the BotBoxRepoRefresh scheduled task. Tested offline by lib\tests\Test-BotBoxPanel.ps1.

  State files (all under %USERPROFILE%\.claude):
    channels\discord\access.json   who may command the bot (the Discord plugin reads it at start)
    bot-box\access-labels.json     owner ID and display names for the panel and the prompt
    bot-box\usage.json             last subscription reading (lib\usage-statusline.py)
    bot-box\bot-state.json         freshness and HEADs the running bot was started with
    bot-box\refresh-status.json    last hourly refresh result
    bot-box\pending-restart.json   a restart the refresher is waiting to do while the bot is busy
#>
Set-StrictMode -Version 2

$script:RefreshTaskName = 'BotBoxRepoRefresh'
$script:BotTaskName = 'BotBoxPrivateClaude'

function Get-BotBoxPaths {
    param([string]$UserProfile = $env:USERPROFILE)
    $state = Join-Path $UserProfile '.claude\bot-box'
    return [pscustomobject]@{
        StateDir      = $state
        LogDir        = Join-Path $state 'logs'
        AccessFile    = Join-Path $UserProfile '.claude\channels\discord\access.json'
        LabelsFile    = Join-Path $state 'access-labels.json'
        UsageFile     = Join-Path $state 'usage.json'
        BotStateFile  = Join-Path $state 'bot-state.json'
        RefreshStatus = Join-Path $state 'refresh-status.json'
        PendingFile   = Join-Path $state 'pending-restart.json'
        RefreshLock   = Join-Path $state 'refresh.lock'
    }
}

function Read-BotJson {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path $Path)) { return $null }
    try { return (Get-Content -Raw -Path $Path | ConvertFrom-Json) } catch { return $null }
}

function Write-BotJson {
    # LF-only UTF-8 without BOM, written to a temporary file and moved into place, so a
    # reader (the Discord plugin, the panel) never sees half a file.
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)]$Value)
    $dir = Split-Path -Parent $Path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $text = (($Value | ConvertTo-Json -Depth 8) -replace "`r`n", "`n") + "`n"
    $tmp = "$Path.tmp"
    [System.IO.File]::WriteAllText($tmp, $text, (New-Object System.Text.UTF8Encoding($false)))
    Move-Item -Force -Path $tmp -Destination $Path
}

# ------------------------------------------------------------------ access list
function Test-DiscordId { param([string]$Id) return [bool]($Id -match '^\d{17,20}$') }

function ConvertTo-SafeLabel {
    # Labels end up in the bot's system prompt: keep them short and plain.
    param([string]$Label)
    $clean = (($Label -replace '[^A-Za-z0-9 _.\-]', '') -replace '\s+', ' ').Trim()
    if ($clean.Length -gt 40) { $clean = $clean.Substring(0, 40).Trim() }
    return $clean
}

function Get-BotAccess {
    param([Parameter(Mandatory)][string]$AccessFile, [Parameter(Mandatory)][string]$LabelsFile)
    $a = Read-BotJson $AccessFile
    $l = Read-BotJson $LabelsFile
    $ids = New-Object System.Collections.Generic.List[string]
    $channels = @()
    if ($a) {
        foreach ($id in @($a.allowFrom)) { if ($id -and -not $ids.Contains([string]$id)) { $ids.Add([string]$id) } }
        if ($a.PSObject.Properties['groups'] -and $a.groups) { $channels = @($a.groups.PSObject.Properties | ForEach-Object { $_.Name }) }
    }
    $labels = @{}
    $owner = $null
    $ownerSource = 'unknown'
    if ($l) {
        if ($l.PSObject.Properties['labels'] -and $l.labels) { foreach ($p in $l.labels.PSObject.Properties) { $labels[$p.Name] = [string]$p.Value } }
        if ($l.PSObject.Properties['owner'] -and $ids.Contains([string]$l.owner)) { $owner = [string]$l.owner; $ownerSource = 'recorded' }
    }
    if (-not $owner -and $ids.Count -eq 1) { $owner = $ids[0]; $ownerSource = 'only user' }
    $users = foreach ($id in $ids) {
        $inChannels = @($channels | Where-Object { @($a.groups.$_.allowFrom) -contains $id })
        [pscustomobject]@{
            Id = $id; Label = $(if ($labels.ContainsKey($id)) { $labels[$id] } else { '' })
            IsOwner = ($id -eq $owner); Channels = $inChannels
        }
    }
    return [pscustomobject]@{
        Exists = [bool]$a; Owner = $owner; OwnerSource = $ownerSource
        Users = @($users); Channels = $channels; Labels = $labels
    }
}

function Save-BotLabels {
    param([string]$LabelsFile, [string]$Owner, [hashtable]$Labels)
    $obj = [ordered]@{ owner = $Owner; labels = [pscustomobject]$Labels }
    Write-BotJson -Path $LabelsFile -Value ([pscustomobject]$obj)
}

function Set-BotAccessIds {
    # Rewrites allowFrom for DMs and every configured channel; keeps every other setting.
    param([string]$AccessFile, [string[]]$Ids)
    $a = Read-BotJson $AccessFile
    $out = [ordered]@{}
    foreach ($p in $a.PSObject.Properties) { $out[$p.Name] = $p.Value }
    $out['allowFrom'] = @($Ids)
    if ($a.PSObject.Properties['groups'] -and $a.groups) {
        $groups = [ordered]@{}
        foreach ($g in $a.groups.PSObject.Properties) {
            $entry = [ordered]@{}
            foreach ($p in $g.Value.PSObject.Properties) { $entry[$p.Name] = $p.Value }
            $entry['allowFrom'] = @($Ids)
            $groups[$g.Name] = [pscustomobject]$entry
        }
        $out['groups'] = [pscustomobject]$groups
    }
    Write-BotJson -Path $AccessFile -Value ([pscustomobject]$out)
}

function Add-BotAccessUser {
    param([Parameter(Mandatory)][string]$AccessFile, [Parameter(Mandatory)][string]$LabelsFile,
          [Parameter(Mandatory)][string]$UserId, [string]$Label = '')
    $UserId = $UserId.Trim()
    if (-not (Test-DiscordId $UserId)) { throw "'$UserId' is not a Discord user ID (17-20 digits)" }
    $acc = Get-BotAccess -AccessFile $AccessFile -LabelsFile $LabelsFile
    if (-not $acc.Exists) { throw 'No access.json yet: run configure-discord.ps1 first' }
    if (-not $acc.Owner) { throw 'Set the owner first: more than one user is listed and none is marked as owner' }
    $ids = @($acc.Users | ForEach-Object { $_.Id })
    if ($ids -notcontains $UserId) { $ids += $UserId }
    $labels = $acc.Labels
    $safe = ConvertTo-SafeLabel $Label
    if ($safe) { $labels[$UserId] = $safe }
    # Record the owner before the list grows, so it is never ambiguous afterwards.
    Save-BotLabels -LabelsFile $LabelsFile -Owner $acc.Owner -Labels $labels
    Set-BotAccessIds -AccessFile $AccessFile -Ids $ids
}

function Remove-BotAccessUser {
    param([Parameter(Mandatory)][string]$AccessFile, [Parameter(Mandatory)][string]$LabelsFile,
          [Parameter(Mandatory)][string]$UserId)
    $acc = Get-BotAccess -AccessFile $AccessFile -LabelsFile $LabelsFile
    if ($UserId -eq $acc.Owner) { throw 'The owner cannot be removed here (use configure-discord.ps1 to change the owner)' }
    $ids = @($acc.Users | ForEach-Object { $_.Id } | Where-Object { $_ -ne $UserId })
    if ($ids.Count -eq 0) { throw 'Refusing to remove the last user' }
    $labels = $acc.Labels
    $labels.Remove($UserId)
    Save-BotLabels -LabelsFile $LabelsFile -Owner $acc.Owner -Labels $labels
    Set-BotAccessIds -AccessFile $AccessFile -Ids $ids
}

function Set-BotAccessOwner {
    param([Parameter(Mandatory)][string]$AccessFile, [Parameter(Mandatory)][string]$LabelsFile,
          [Parameter(Mandatory)][string]$UserId)
    $acc = Get-BotAccess -AccessFile $AccessFile -LabelsFile $LabelsFile
    if (@($acc.Users | ForEach-Object { $_.Id }) -notcontains $UserId) { throw "$UserId is not on the access list" }
    Save-BotLabels -LabelsFile $LabelsFile -Owner $UserId -Labels $acc.Labels
}

function Get-BotAccessNotice {
    # Appended to the bot's system prompt by the launcher, after the fixed rules.
    param([Parameter(Mandatory)]$Access)
    $lines = @('', '## Who may command you (access list at launch)', '')
    if (-not $Access.Exists -or $Access.Users.Count -eq 0) {
        $lines += '- No access list was found. Answer no one.'
        return ($lines -join "`n")
    }
    $others = @($Access.Users | Where-Object { -not $_.IsOwner })
    if ($Access.Owner) {
        $lines += ('- Owner: Jie, Discord user_id {0}.' -f $Access.Owner)
    } else {
        $lines += '- Owner: NOT SET (more than one user is listed and none is marked as owner in the control panel).'
    }
    if ($others.Count -eq 0) {
        $lines += '- Nobody else can command you.'
        return ($lines -join "`n")
    }
    foreach ($u in $others) {
        $name = if ($u.Label) { $u.Label } else { 'unnamed user' }
        $lines += ('- Also allowed: {0}, Discord user_id {1}.' -f $name, $u.Id)
    }
    $lines += ''
    $lines += 'This list replaces "Only Jie''s user ID can command you" above: everyone listed may give you'
    $lines += 'requests, within all the other rules. Check the user_id attribute on every message.'
    if ($Access.Owner) {
        $lines += 'Jie''s private trading data - positions, P&L, fills, trades and anything about his'
        $lines += 'accounts - is for the owner only: use the positions and trades tools, and discuss'
        $lines += 'their results, only in reply to a message whose user_id is the owner''s. Anyone else'
        $lines += 'who asks is told that it is private.'
    } else {
        $lines += 'Because no owner is set, share Jie''s private trading data (positions, P&L, fills, trades,'
        $lines += 'accounts) with no one, and say the owner must be set in the control panel.'
    }
    return ($lines -join "`n")
}

# ------------------------------------------------------------------ subscription usage
function Get-BotUsage {
    param([Parameter(Mandatory)][string]$UsageFile, [datetime]$Now = (Get-Date))
    $u = Read-BotJson $UsageFile
    $epoch = [datetime]'1970-01-01Z'
    $nowUnix = [int64](($Now.ToUniversalTime() - $epoch.ToUniversalTime()).TotalSeconds)
    $windows = foreach ($k in @('five_hour', 'seven_day')) {
        $w = $null
        if ($u -and $u.PSObject.Properties['rate_limits'] -and $u.rate_limits -and $u.rate_limits.PSObject.Properties[$k]) { $w = $u.rate_limits.$k }
        $resets = $null; $used = $null; $state = 'none'
        if ($w) {
            $used = [double]$w.used_percentage
            if ($w.PSObject.Properties['resets_at'] -and $w.resets_at) {
                $resets = $epoch.AddSeconds([double]$w.resets_at).ToLocalTime()
                $state = if ([int64]$w.resets_at -le $nowUnix) { 'reset' } else { 'ok' }
            } else { $state = 'ok' }
        }
        [pscustomobject]@{
            Name = $k; Label = $(if ($k -eq 'five_hour') { '5-hour' } else { '7-day' })
            State = $state; Used = $used
            Left = $(if ($null -ne $used) { [math]::Max([double]0, [double](100 - $used)) } else { $null })
            ResetsAt = $resets
        }
    }
    $observed = $null
    if ($u -and $u.PSObject.Properties['rate_limits_observed_at'] -and $u.rate_limits_observed_at) {
        $observed = $epoch.AddSeconds([double]$u.rate_limits_observed_at).ToLocalTime()
    }
    return [pscustomobject]@{ Available = [bool]$observed; ObservedAt = $observed; Windows = @($windows) }
}

function Format-BotUsageWindow {
    param([Parameter(Mandatory)]$Window)
    switch ($Window.State) {
        'none'  { return ('{0}: no reading yet (appears after the bot''s first reply)' -f $Window.Label) }
        'reset' { return ('{0}: window reset at {1:ddd HH:mm}; no reading since' -f $Window.Label, $Window.ResetsAt) }
        default {
            $when = if ($Window.ResetsAt) { ', resets {0:ddd HH:mm}' -f $Window.ResetsAt } else { '' }
            return ('{0}: {1:0}% used, {2:0}% left{3}' -f $Window.Label, $Window.Used, $Window.Left, $when)
        }
    }
}

# ------------------------------------------------------------------ bot process
function Get-BotProcessTree {
    # All descendants of $RootId (inclusive) from a process list with ProcessId/ParentProcessId.
    param([Parameter(Mandatory)][int]$RootId, [Parameter(Mandatory)][object[]]$Processes)
    $children = @{}
    foreach ($p in $Processes) {
        $key = [int]$p.ParentProcessId
        if (-not $children.ContainsKey($key)) { $children[$key] = New-Object System.Collections.Generic.List[int] }
        $children[$key].Add([int]$p.ProcessId)
    }
    $out = New-Object System.Collections.Generic.List[int]
    $queue = New-Object System.Collections.Generic.Queue[int]
    $queue.Enqueue($RootId)
    while ($queue.Count -gt 0) {
        $id = $queue.Dequeue()
        if ($out.Contains($id)) { continue }
        $out.Add($id)
        if ($children.ContainsKey($id)) { foreach ($c in $children[$id]) { $queue.Enqueue($c) } }
    }
    return $out.ToArray()
}

function Get-BotSessionInfo {
    $all = @(Get-CimInstance Win32_Process)
    $claude = @($all | Where-Object { $_.Name -eq 'claude.exe' -and $_.CommandLine -match '--channels plugin:discord' })
    $launcher = @($all | Where-Object { $_.Name -match '^(powershell|pwsh)\.exe$' -and $_.CommandLine -match 'start-private-bot\.ps1' })
    return [pscustomobject]@{
        Running     = ($claude.Count -gt 0)
        ClaudeIds   = @($claude | ForEach-Object { [int]$_.ProcessId })
        StartedAt   = $(if ($claude.Count) { ($claude | Sort-Object CreationDate | Select-Object -First 1).CreationDate } else { $null })
        LauncherIds = @($launcher | ForEach-Object { [int]$_.ProcessId })
        All         = $all
    }
}

function Stop-BotSession {
    # Ends the bot's Claude session and its children (the Discord plugin's bun server), so no
    # orphan stays logged in to Discord. With -IncludeLauncher the launcher goes first, so it
    # does not start a new session; without it the launcher restarts the bot after its backoff.
    param([switch]$IncludeLauncher)
    $info = Get-BotSessionInfo
    $ids = New-Object System.Collections.Generic.List[int]
    if ($IncludeLauncher) { foreach ($l in $info.LauncherIds) { $ids.Add($l) } }
    foreach ($c in $info.ClaudeIds) {
        foreach ($d in (Get-BotProcessTree -RootId $c -Processes $info.All)) { if (-not $ids.Contains($d)) { $ids.Add($d) } }
    }
    foreach ($id in $ids) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
    return $ids.Count
}

function Get-BotLastActivity {
    # The bot's transcript changes only when it handles a message; the status line records
    # which transcript belongs to the bot session.
    param([Parameter(Mandatory)][string]$UsageFile, [Nullable[datetime]]$StartedAt)
    $last = $StartedAt
    $u = Read-BotJson $UsageFile
    if ($u -and $u.PSObject.Properties['transcript_path'] -and $u.transcript_path -and (Test-Path $u.transcript_path)) {
        $t = (Get-Item $u.transcript_path).LastWriteTime
        if (-not $last -or $t -gt $last) { $last = $t }
    }
    return $last
}

function Test-BotIdle {
    param([Nullable[datetime]]$LastActivity, [int]$IdleMinutes = 10, [datetime]$Now = (Get-Date))
    if (-not $LastActivity) { return $true }
    return (($Now - $LastActivity).TotalMinutes -ge $IdleMinutes)
}

function Get-BotRestartReason {
    # Why the running bot should be restarted after a refresh, or $null.
    param($LaunchState, [object[]]$Results)
    $reasons = @()
    foreach ($r in $Results) {
        if ($r.Pulled) { $reasons += "$($r.Repo) was updated" }
        elseif ($r.Fresh -and $LaunchState -and $LaunchState.PSObject.Properties['repos']) {
            $was = @($LaunchState.repos | Where-Object { $_.repo -eq $r.Repo })
            if ($was.Count -and -not $was[0].fresh) { $reasons += "$($r.Repo) is current again (bot started STALE)" }
        }
    }
    if ($reasons.Count) { return ($reasons -join '; ') }
    return $null
}

# ------------------------------------------------------------------ refresh scheduler
function New-BotRefreshTaskDefinition {
    param([Parameter(Mandatory)][string]$ScriptPath)
    $user = "$env:USERDOMAIN\$env:USERNAME"
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
        -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $ScriptPath)
    # Hourly from now on, indefinitely, only while this user is signed in (Interactive).
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Hours 1)
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    return [pscustomobject]@{ Action = $action; Trigger = $trigger; Settings = $settings; Principal = $principal }
}

function Get-BotRefreshTaskState {
    $t = Get-ScheduledTask -TaskName $script:RefreshTaskName -ErrorAction SilentlyContinue
    if (-not $t) { return [pscustomobject]@{ Installed = $false; Enabled = $false; State = 'Not installed'; NextRun = $null; LastRun = $null } }
    $i = Get-ScheduledTaskInfo -TaskName $script:RefreshTaskName -ErrorAction SilentlyContinue
    return [pscustomobject]@{
        Installed = $true; Enabled = ($t.State -ne 'Disabled'); State = [string]$t.State
        NextRun = $(if ($i) { $i.NextRunTime } else { $null }); LastRun = $(if ($i) { $i.LastRunTime } else { $null })
    }
}

function Enable-BotRefreshTask {
    param([Parameter(Mandatory)][string]$ScriptPath)
    if (Get-ScheduledTask -TaskName $script:RefreshTaskName -ErrorAction SilentlyContinue) {
        Enable-ScheduledTask -TaskName $script:RefreshTaskName | Out-Null
        return
    }
    $d = New-BotRefreshTaskDefinition -ScriptPath $ScriptPath
    Register-ScheduledTask -TaskName $script:RefreshTaskName -Action $d.Action -Trigger $d.Trigger -Settings $d.Settings `
        -Principal $d.Principal -Description 'Bot box: hourly guarded refresh of jie_wiki and market_dashboard; restarts the idle private bot after an update.' | Out-Null
}

function Disable-BotRefreshTask {
    if (Get-ScheduledTask -TaskName $script:RefreshTaskName -ErrorAction SilentlyContinue) {
        Disable-ScheduledTask -TaskName $script:RefreshTaskName | Out-Null
    }
}

Export-ModuleMember -Function Get-BotBoxPaths, Read-BotJson, Write-BotJson, Test-DiscordId, ConvertTo-SafeLabel,
    Get-BotAccess, Add-BotAccessUser, Remove-BotAccessUser, Set-BotAccessOwner, Get-BotAccessNotice,
    Get-BotUsage, Format-BotUsageWindow, Get-BotProcessTree, Get-BotSessionInfo, Stop-BotSession,
    Get-BotLastActivity, Test-BotIdle, Get-BotRestartReason, New-BotRefreshTaskDefinition,
    Get-BotRefreshTaskState, Enable-BotRefreshTask, Disable-BotRefreshTask
