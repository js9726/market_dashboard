# install_watchdog.ps1 — Phase 4 of pre-open CI + journal revamp plan.
#
# Registers a Windows Scheduled Task that runs opend_watchdog.ps1 every 5
# minutes when the user is logged in. Idempotent — running again replaces
# the existing task definition.
#
# Run from an elevated PowerShell (right-click → Run as Administrator):
#
#   cd "C:\Users\jiesh\AI codes hub\market_dashboard\packages\dashboard-bridge"
#   .\install_watchdog.ps1
#
# To uninstall:
#
#   Unregister-ScheduledTask -TaskName 'DashboardOpenDWatchdog' -Confirm:$false

$ErrorActionPreference = 'Stop'
$TaskName = 'DashboardOpenDWatchdog'
$ScriptPath = Join-Path $PSScriptRoot 'opend_watchdog.ps1'

if (-not (Test-Path $ScriptPath)) {
    Write-Error "opend_watchdog.ps1 not found at $ScriptPath"
    exit 1
}

Write-Host "Registering scheduled task '$TaskName' for $ScriptPath" -ForegroundColor Cyan

# Action: PowerShell with -NoProfile -WindowStyle Hidden so the user doesn't
# see a console flash every 5 min.
$Action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ScriptPath`""

# Trigger: every 5 minutes, indefinitely, while user is logged on.
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date)
$Trigger.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 5) `
    -RepetitionDuration (New-TimeSpan -Days 9999)).Repetition

$Principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive

$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
    -MultipleInstances IgnoreNew

# Replace existing if present.
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Existing task found — unregistering first." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Principal $Principal `
    -Settings $Settings `
    -Description 'Keeps moomoo OpenD GUI alive for the dashboard-bridge daemon. Runs every 5 min.' `
    | Out-Null

Write-Host "✓ Task '$TaskName' registered. Logs: $env:USERPROFILE\.opend-watchdog.log" -ForegroundColor Green
Write-Host "First run will fire within 5 minutes." -ForegroundColor Cyan
