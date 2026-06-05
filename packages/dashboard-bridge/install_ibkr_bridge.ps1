<#
  install_ibkr_bridge.ps1 — register the IBKR bridge as scheduled tasks
  (the IBKR counterpart to install.ps1's DashboardBridge / MooMoo daemon).

  Creates two tasks:
    IBKRBridge      — `ibkr_bridge.py --post` every 10 min + at logon.
                      Keeps positions + equity + current-day fills fresh while
                      IB Gateway / TWS is running and logged in.
    IBKRFlexDaily   — `ibkr_bridge.py --flex --post` once daily (17:10 local).
                      Pulls full trade history via the Flex Web Service so
                      closed trades (which the socket API drops after the day)
                      are captured. Needs flex_token + flex_query_id in config.

  IB Gateway/TWS must be running with the API enabled (port in [ibkr]) for a
  sync to succeed; when it's down the task just logs a connection error and the
  next run retries. Re-running this script re-registers (idempotent).

  Uninstall:
    Unregister-ScheduledTask -TaskName 'IBKRBridge'    -Confirm:$false
    Unregister-ScheduledTask -TaskName 'IBKRFlexDaily' -Confirm:$false
#>
$ErrorActionPreference = "Stop"
$VenvPython = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $VenvPython)) { throw "venv python not found at $VenvPython — run install.ps1 first." }

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

function Register-IBKRTask([string]$Name, [string]$Args, [object[]]$Triggers) {
    $action = New-ScheduledTaskAction -Execute $VenvPython -Argument $Args -WorkingDirectory $PSScriptRoot
    if (Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue) {
        Write-Host "Re-registering '$Name'..." -ForegroundColor Yellow
        Unregister-ScheduledTask -TaskName $Name -Confirm:$false
    }
    Register-ScheduledTask -TaskName $Name -Action $action -Trigger $Triggers `
        -Settings $settings -Principal $principal -Description "IBKR bridge: $Args" | Out-Null
    Write-Host "Registered '$Name' ($Args)" -ForegroundColor Green
}

# Frequent positions/equity sync.
$tLogon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$tEvery = New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 10) -RepetitionDuration (New-TimeSpan -Days 3650)
Register-IBKRTask -Name "IBKRBridge" -Args "ibkr_bridge.py --post" -Triggers @($tLogon, $tEvery)

# Daily full trade-history pull via Flex (after US close, local 17:10).
$tDaily = New-ScheduledTaskTrigger -Daily -At 5:10PM
Register-IBKRTask -Name "IBKRFlexDaily" -Args "ibkr_bridge.py --flex --post" -Triggers @($tDaily)

Start-ScheduledTask -TaskName "IBKRBridge"
Write-Host "`nDone. Logs: $env:USERPROFILE\.ibkr-bridge.log" -ForegroundColor Cyan
Write-Host "IBKRBridge syncs every 10 min (when IB Gateway is up); IBKRFlexDaily pulls history at 17:10." -ForegroundColor Cyan
