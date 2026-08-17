# install_paper_trader.ps1 — register the daily SIMULATE paper-trader task.
#
# Mirrors Jie's active window every 15 minutes from 21:30 to 23:45 Mon-Fri.
# From 00:00 to 04:00 Tue-Sat it continues protection/sync only; the signal
# endpoint blocks new entries after Malaysia midnight. Missed triggers use
# StartWhenAvailable. Repeated runs are idempotent by final-run signal ID.
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

$triggers = @()
for ($minutes = 21 * 60 + 30; $minutes -le 23 * 60 + 45; $minutes += 15) {
    $at = Get-Date -Hour ([math]::Floor($minutes / 60)) -Minute ($minutes % 60) -Second 0
    $triggers += New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At $at
}
for ($minutes = 0; $minutes -le 4 * 60; $minutes += 15) {
    $at = Get-Date -Hour ([math]::Floor($minutes / 60)) -Minute ($minutes % 60) -Second 0
    $triggers += New-ScheduledTaskTrigger -Weekly -DaysOfWeek Tuesday,Wednesday,Thursday,Friday,Saturday -At $at
}
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -WakeToRun `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 5) `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $triggers `
    -Settings $settings `
    -Principal $principal `
    -Description "Intraday moomoo SIMULATE forward validator: strict final v2 GO signals, fail-closed stop-capability gate, existing-position monitoring, and dashboard sync (paper account dynamically verified)." | Out-Null

Write-Host "Registered $TaskName (15-minute monitoring: 21:30-23:45 Mon-Fri; protection/sync 00:00-04:00 Tue-Sat). Log: $Log"
