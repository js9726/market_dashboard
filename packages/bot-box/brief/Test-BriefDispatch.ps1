<#
.SYNOPSIS
  Offline tests for BriefDispatch.psm1: the 08:30-09:15 ET window across both US clock
  seasons, weekends, once per day, -Force, and the local trigger times. Registers no task
  and calls no GitHub command.

  Run:  powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-BriefDispatch.ps1
#>
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Import-Module (Join-Path $here 'BriefDispatch.psm1') -Force

$script:passed = 0
$script:failed = 0
function Check {
    param([string]$Name, [bool]$Condition, [string]$Detail = '')
    if ($Condition) { $script:passed++; Write-Host "PASS  $Name" -ForegroundColor Green }
    else { $script:failed++; Write-Host "FAIL  $Name  $Detail" -ForegroundColor Red }
}
function Utc([string]$s) { return [datetime]::SpecifyKind([datetime]::Parse($s, [Globalization.CultureInfo]::InvariantCulture), 'Utc') }

# Summer (EDT, UTC-4): 08:40 ET = 12:40 UTC.  Winter (EST, UTC-5): 08:40 ET = 13:40 UTC.
$d = Test-BriefDispatchDue -NowUtc (Utc '2026-09-30 12:40:00')
Check 'EDT weekday 08:40 ET is due' ($d.Due -and $d.EtDate -eq '2026-09-30') $d.Reason
$d = Test-BriefDispatchDue -NowUtc (Utc '2026-12-02 13:40:00')
Check 'EST weekday 08:40 ET is due' ($d.Due -and $d.EtDate -eq '2026-12-02') $d.Reason
$d = Test-BriefDispatchDue -NowUtc (Utc '2026-12-02 12:40:00')
Check 'EST 07:40 ET (the summer trigger in winter) is not due' (-not $d.Due -and $d.Reason -match 'outside') $d.Reason
$d = Test-BriefDispatchDue -NowUtc (Utc '2026-09-30 13:40:00')
Check 'EDT 09:40 ET (the winter trigger in summer) is not due' (-not $d.Due -and $d.Reason -match 'outside') $d.Reason
$d = Test-BriefDispatchDue -NowUtc (Utc '2026-10-03 12:40:00')
Check 'Saturday is not due' (-not $d.Due -and $d.Reason -match 'weekend') $d.Reason
$d = Test-BriefDispatchDue -NowUtc (Utc '2026-09-30 12:40:00') -LastDispatchEtDate '2026-09-30'
Check 'second dispatch on the same ET date is not due' (-not $d.Due -and $d.Reason -match 'already') $d.Reason
$d = Test-BriefDispatchDue -NowUtc (Utc '2026-09-30 12:40:00') -LastDispatchEtDate '2026-09-29'
Check 'yesterday''s dispatch does not block today' ($d.Due) $d.Reason
$d = Test-BriefDispatchDue -NowUtc (Utc '2026-10-03 03:00:00') -Force
Check '-Force dispatches any time' ($d.Due -and $d.Reason -eq 'forced')
# Around midnight UTC the ET date is still the previous day.
$d = Test-BriefDispatchDue -NowUtc (Utc '2026-10-01 01:00:00')
Check 'ET date follows New York, not UTC' ($d.EtDate -eq '2026-09-30')

$myt = [TimeZoneInfo]::FindSystemTimeZoneById('Singapore Standard Time')   # UTC+8, no DST, same as MYT
$t = @(Get-BriefTriggerTimes -Local $myt)
Check 'MYT triggers are 20:40 and 21:40' (($t | ForEach-Object { '{0:hh\:mm}' -f $_ }) -join ',' -eq '20:40,21:40') (($t | ForEach-Object { "$_" }) -join ',')

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:passed, $script:failed)
if ($script:failed -gt 0) { exit 1 }
exit 0
