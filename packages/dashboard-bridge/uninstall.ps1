# uninstall.ps1 — remove the dashboard-bridge scheduled task.
#
# Keeps the venv + config in case you want to reinstall later.
# Pass -Purge to wipe those too.

[CmdletBinding()]
param(
    [switch]$Purge
)

$ErrorActionPreference = "Continue"

$TaskName = "DashboardBridge"
$BridgeDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$VenvDir = Join-Path $BridgeDir ".venv"
$ConfigPath = Join-Path $env:USERPROFILE ".config\dashboard-bridge.toml"

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Host "Stopping and unregistering scheduled task '$TaskName' ..."
    try { Stop-ScheduledTask -TaskName $TaskName } catch {}
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Task removed." -ForegroundColor Green
} else {
    Write-Host "No scheduled task '$TaskName' found."
}

if ($Purge) {
    if (Test-Path $VenvDir) {
        Write-Host "Removing virtualenv ..."
        Remove-Item -Recurse -Force $VenvDir
    }
    if (Test-Path $ConfigPath) {
        Write-Host "Removing config $ConfigPath ..."
        Remove-Item -Force $ConfigPath
    }
    Write-Host "Purge complete." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "Venv preserved at: $VenvDir"
    Write-Host "Config preserved at: $ConfigPath"
    Write-Host "Pass -Purge to remove these too."
}
