# install_paper_trader.ps1 — register the daily SIMULATE paper-trader task.
#
# Runs paper_trader.py once per weekday at 21:45 local (Asia/Kuala_Lumpur):
# ~09:45 ET during US daylight saving, ~08:45 ET in winter (pre-market — orders
# then queue to the open; the no-chase gate re-checks price at fire time).
# Requires OpenD on 127.0.0.1:11111 (kept alive by the existing watchdog task);
# if OpenD is down the script exits non-zero and logs — fail-closed, no orders.
#
# Usage:  powershell -ExecutionPolicy Bypass -File install_paper_trader.ps1
# Remove: Unregister-ScheduledTask -TaskName "PaperTraderDaily" -Confirm:$false

$ErrorActionPreference = "Stop"

$TaskName = "PaperTraderDaily"
$BridgeDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = Join-Path $BridgeDir ".venv\Scripts\python.exe"
$Script = Join-Path $BridgeDir "paper_trader.py"
$Log = Join-Path $BridgeDir "paper_trader.log"

if (-not (Test-Path $Python)) { throw "venv python not found: $Python" }
if (-not (Test-Path $Script)) { throw "paper_trader.py not found: $Script" }

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Host "Removing existing task $TaskName"
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# cmd wrapper so stdout+stderr append to the log with a timestamp header.
$action = New-ScheduledTaskAction `
    -Execute "cmd.exe" `
    -Argument "/c echo ===== %DATE% %TIME% ===== >> `"$Log`" 2>&1 && `"$Python`" `"$Script`" >> `"$Log`" 2>&1" `
    -WorkingDirectory $BridgeDir

$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 21:45
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "Daily moomoo SIMULATE paper trader: gate-vetted A-list ENTER signals -> paper orders + stop management + dashboard sync (paper_trader.py; SIMULATE acc hard-coded)." | Out-Null

Write-Host "Registered $TaskName (weekdays 21:45 local). Log: $Log"
