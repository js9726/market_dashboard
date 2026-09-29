<#
.SYNOPSIS
  When to dispatch the pre-open brief workflow from the bot PC, and the logon-session task
  that does it. Tested offline by Test-BriefDispatch.ps1.

  GitHub has started the scheduled refresh_premarket.yml 4.5-7 hours late, after the US
  open, so this PC starts it at 08:40 US Eastern on weekdays with `gh workflow run`. The
  run takes about 15 minutes, so the brief reaches #j_asistant before the 09:30 open. The
  workflow skips US holidays itself and skips a late scheduled run once this ran.
#>
Set-StrictMode -Version 2

$script:TaskName = 'BotBoxBriefDispatch'
$script:DispatchEt = New-TimeSpan -Hours 8 -Minutes 40
$script:WindowFrom = New-TimeSpan -Hours 8 -Minutes 30
$script:WindowTo = New-TimeSpan -Hours 9 -Minutes 15

function Get-EasternZone { return [TimeZoneInfo]::FindSystemTimeZoneById('Eastern Standard Time') }

function Test-BriefDispatchDue {
    # Returns [pscustomobject]@{ Due; Reason; EtDate }. $LastDispatchEtDate is 'yyyy-MM-dd' or ''.
    param([Parameter(Mandatory)][datetime]$NowUtc, [string]$LastDispatchEtDate = '', [switch]$Force)
    $et = [TimeZoneInfo]::ConvertTimeFromUtc($NowUtc.ToUniversalTime(), (Get-EasternZone))
    $date = $et.ToString('yyyy-MM-dd')
    $r = { param($due, $why) [pscustomobject]@{ Due = $due; Reason = $why; EtDate = $date } }
    if ($Force) { return (& $r $true 'forced') }
    if ($et.DayOfWeek -eq 'Saturday' -or $et.DayOfWeek -eq 'Sunday') { return (& $r $false "weekend in New York ($($et.DayOfWeek))") }
    if ($et.TimeOfDay -lt $script:WindowFrom -or $et.TimeOfDay -gt $script:WindowTo) {
        return (& $r $false ('outside the 08:30-09:15 ET window ({0:HH:mm} ET)' -f $et))
    }
    if ($LastDispatchEtDate -eq $date) { return (& $r $false "already dispatched for $date") }
    return (& $r $true ('due ({0:HH:mm} ET)' -f $et))
}

function Get-BriefTriggerTimes {
    # 08:40 ET in local clock time for both US offsets (EDT -4, EST -5), so one of the two
    # daily triggers lands in the window whatever the season; the window check drops the other.
    param([TimeZoneInfo]$Local = [TimeZoneInfo]::Local)
    $times = foreach ($offset in -4, -5) {
        $utc = [datetime]::SpecifyKind([datetime]::Today.Add($script:DispatchEt).AddHours(-$offset), 'Utc')
        [TimeZoneInfo]::ConvertTimeFromUtc($utc, $Local).TimeOfDay
    }
    return @($times | Sort-Object -Unique)
}

function Register-BriefDispatchTask {
    param([Parameter(Mandatory)][string]$ScriptPath)
    $user = "$env:USERDOMAIN\$env:USERNAME"
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
        -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $ScriptPath)
    $triggers = foreach ($t in (Get-BriefTriggerTimes)) { New-ScheduledTaskTrigger -Daily -At ([datetime]::Today.Add($t)) }
    $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
        -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $script:TaskName -Action $action -Trigger @($triggers) -Settings $settings `
        -Principal $principal -Force `
        -Description 'Bot box: start the pre-open brief workflow at 08:40 ET on weekdays (gh workflow run).' | Out-Null
}

function Unregister-BriefDispatchTask {
    if (Get-ScheduledTask -TaskName $script:TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $script:TaskName -Confirm:$false
    }
}

Export-ModuleMember -Function Test-BriefDispatchDue, Get-BriefTriggerTimes, Register-BriefDispatchTask, Unregister-BriefDispatchTask
