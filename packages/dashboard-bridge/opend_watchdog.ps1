# opend_watchdog.ps1 — Phase 4 of pre-open CI + journal revamp plan.
#
# Keeps moomoo OpenD GUI alive on Jie's PC. Runs every 5 minutes via Windows
# Task Scheduler (see install_watchdog.ps1 below). When OpenD dies or its API
# port (11111) becomes unresponsive (zombie process — window alive but service
# dead), this script kills + relaunches the GUI so the dashboard-bridge daemon
# keeps syncing.
#
# Why a separate watchdog vs the existing dashboard-bridge install:
#   - install.ps1 only handles the bridge daemon itself.
#   - The bridge fails silently when OpenD's port doesn't respond.
#   - This watchdog is the lowest-cost way to guarantee OpenD is reachable
#     whenever the PC is online.
#
# Behaviour:
#   1. TCP probe 127.0.0.1:11111 with 2s timeout.
#   2. If alive → exit 0 (no-op).
#   3. If dead → taskkill /F moomoo_OpenD.exe, wait 2s.
#   4. Launch moomoo_OpenD.exe (detached). Wait up to 30s for port.
#   5. Log to %USERPROFILE%\.opend-watchdog.log.

$ErrorActionPreference = 'Continue'
$LogPath = Join-Path $env:USERPROFILE '.opend-watchdog.log'

function Write-Log {
    param([string]$Message)
    $stamp = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    "$stamp $Message" | Out-File -FilePath $LogPath -Append -Encoding utf8
}

function Test-OpenDPort {
    $client = $null
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $task = $client.ConnectAsync('127.0.0.1', 11111)
        if ($task.Wait(2000) -and $client.Connected) { return $true }
        return $false
    } catch { return $false }
    finally { if ($client) { $client.Dispose() } }
}

function Find-OpenDExe {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\moomoo_OpenD\moomoo_OpenD.exe'),
        'C:\Program Files\moomoo OpenD\moomoo_OpenD.exe',
        'C:\Program Files (x86)\moomoo OpenD\moomoo_OpenD.exe',
        (Join-Path $env:USERPROFILE 'Desktop\moomoo OpenD\moomoo_OpenD.exe')
    )
    foreach ($p in $candidates) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

if (Test-OpenDPort) {
    # Healthy — no-op. Only log every 12 cycles (= once an hour at 5-min interval)
    # so the log doesn't grow forever.
    if ((Get-Date).Minute -eq 0) { Write-Log 'OpenD port 11111 OK.' }
    exit 0
}

Write-Log 'OpenD port 11111 unreachable — attempting self-heal.'

# Kill any zombie moomoo_OpenD process.
try {
    Stop-Process -Name 'moomoo_OpenD' -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
} catch {
    Write-Log "taskkill skipped: $($_.Exception.Message)"
}

$exe = Find-OpenDExe
if (-not $exe) {
    Write-Log 'moomoo_OpenD.exe not found at known paths — manual launch required.'
    exit 1
}

try {
    Start-Process -FilePath $exe
    Write-Log "Relaunched $exe"
} catch {
    Write-Log "Relaunch failed: $($_.Exception.Message)"
    exit 1
}

# Wait up to 30s for the port to come back.
for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 2
    if (Test-OpenDPort) {
        Write-Log "OpenD back online after $((($i + 1) * 2))s."
        exit 0
    }
}

Write-Log 'OpenD still down after 30s — manual login may be required (GUI window awaiting password).'
exit 1
