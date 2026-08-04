# install_paper_trader.ps1 — register the daily SIMULATE paper-trader task.
#
# Runs after the morning package, near the afternoon transition window, and
# post-close: 23:00 Mon-Fri plus 02:15 and 04:10 Tue-Sat Malaysia time.
# Repeated runs are idempotent by final-run signal ID.
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

$triggers = @(
    (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 23:00),
    (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Tuesday,Wednesday,Thursday,Friday,Saturday -At 02:15),
    (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Tuesday,Wednesday,Thursday,Friday,Saturday -At 04:10)
)
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
    -Description "Intraday moomoo SIMULATE paper trader: strict final v2 GO signals -> paper orders + stop management + dashboard sync (paper_trader.py; SIMULATE acc hard-coded)." | Out-Null

Write-Host "Registered $TaskName (23:00 Mon-Fri, 02:15 + 04:10 Tue-Sat local). Log: $Log"
