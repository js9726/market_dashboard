<#
.SYNOPSIS
  Bot box control panel: Claude subscription usage, the private bot, the hourly repo
  refresh and who may command the bot. See CONTROL-PANEL.md.

  Open:            powershell -NoProfile -ExecutionPolicy Bypass -File .\control-panel.ps1
  Desktop icon:    powershell -NoProfile -ExecutionPolicy Bypass -File .\control-panel.ps1 -CreateShortcut
  Check (no window): ... -File .\control-panel.ps1 -SmokeTest  (builds the form, prints what it shows)

  Everything here is local to this PC: no server, no port, nothing sent anywhere.
#>
[CmdletBinding()]
param([switch]$CreateShortcut, [switch]$SmokeTest)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Import-Module (Join-Path $here 'lib\BotBoxPanel.psm1') -Force
$refreshScript = Join-Path $here 'lib\refresh-repos.ps1'
$paths = Get-BotBoxPaths

if ($CreateShortcut) {
    $lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Bot box control panel.lnk'
    $ws = New-Object -ComObject WScript.Shell
    $s = $ws.CreateShortcut($lnk)
    $s.TargetPath = 'powershell.exe'
    $s.Arguments = ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $MyInvocation.MyCommand.Path)
    $s.WorkingDirectory = $here
    $s.Save()
    Write-Host "[OK] Shortcut created: $lnk"
    exit 0
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$font = New-Object System.Drawing.Font('Segoe UI', 9)
$bold = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Bot box control panel'
$form.Font = $font
$form.Size = New-Object System.Drawing.Size(640, 720)
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox = $false
$form.StartPosition = 'CenterScreen'

function New-Box([string]$Title, [int]$Top, [int]$Height) {
    $g = New-Object System.Windows.Forms.GroupBox
    $g.Text = $Title; $g.Font = $bold
    $g.Location = New-Object System.Drawing.Point(12, $Top)
    $g.Size = New-Object System.Drawing.Size(600, $Height)
    $form.Controls.Add($g)
    return $g
}
function New-Label($Parent, [int]$X, [int]$Y, [int]$W, [int]$H = 20) {
    $l = New-Object System.Windows.Forms.Label
    $l.Font = $font; $l.AutoSize = $false
    $l.UseMnemonic = $false  # otherwise '&' in 'P&L' is eaten as a shortcut marker
    $l.Location = New-Object System.Drawing.Point($X, $Y)
    $l.Size = New-Object System.Drawing.Size($W, $H)
    $Parent.Controls.Add($l)
    return $l
}
function New-Button($Parent, [string]$Text, [int]$X, [int]$Y, [int]$W = 110) {
    $b = New-Object System.Windows.Forms.Button
    $b.Font = $font; $b.Text = $Text
    $b.Location = New-Object System.Drawing.Point($X, $Y)
    $b.Size = New-Object System.Drawing.Size($W, 28)
    $Parent.Controls.Add($b)
    return $b
}
function Show-Error([string]$Message) {
    [void][System.Windows.Forms.MessageBox]::Show($Message, 'Bot box', 'OK', 'Warning')
}

# ------------------------------------------------------------------ usage
$gUsage = New-Box 'Claude subscription usage (whole account)' 10 150
$usageRows = @()
foreach ($i in 0, 1) {
    $bar = New-Object System.Windows.Forms.ProgressBar
    $bar.Location = New-Object System.Drawing.Point(15, (28 + $i * 45))
    $bar.Size = New-Object System.Drawing.Size(200, 20)
    $bar.Maximum = 100
    $gUsage.Controls.Add($bar)
    $usageRows += [pscustomobject]@{ Bar = $bar; Text = (New-Label $gUsage 225 (28 + $i * 45) 360 40) }
}
$usageNote = New-Label $gUsage 15 118 570 22
$usageNote.ForeColor = [System.Drawing.Color]::DimGray

# ------------------------------------------------------------------ bot
$gBot = New-Box 'Private bot' 168 95
$botStatus = New-Label $gBot 15 25 570 22
$btnStart = New-Button $gBot 'Start' 15 55
$btnRestart = New-Button $gBot 'Restart' 135 55
$btnStop = New-Button $gBot 'Stop' 255 55
$botNote = New-Label $gBot 375 58 215 22
$botNote.ForeColor = [System.Drawing.Color]::DimGray
$botNote.Text = 'Changes to access apply on Restart'

# ------------------------------------------------------------------ refresh
$gRefresh = New-Box 'Hourly repo refresh (while you are signed in)' 271 150
$refreshStatus = New-Label $gRefresh 15 25 570 22
$refreshLast = New-Object System.Windows.Forms.TextBox
$refreshLast.Multiline = $true; $refreshLast.ReadOnly = $true; $refreshLast.Font = $font
$refreshLast.Location = New-Object System.Drawing.Point(15, 50)
$refreshLast.Size = New-Object System.Drawing.Size(570, 55)
$gRefresh.Controls.Add($refreshLast)
$btnToggle = New-Button $gRefresh 'Turn on' 15 112
$btnRunNow = New-Button $gRefresh 'Run now' 135 112

# ------------------------------------------------------------------ access
$gAccess = New-Box 'Who can command the bot' 429 245
$list = New-Object System.Windows.Forms.ListView
$list.View = 'Details'; $list.FullRowSelect = $true; $list.MultiSelect = $false; $list.Font = $font
$list.Location = New-Object System.Drawing.Point(15, 22)
$list.Size = New-Object System.Drawing.Size(570, 90)
[void]$list.Columns.Add('Name', 180)
[void]$list.Columns.Add('Discord user ID', 190)
[void]$list.Columns.Add('Role', 180)
$gAccess.Controls.Add($list)
$lblId = New-Label $gAccess 15 122 60; $lblId.Text = 'User ID'
$txtId = New-Object System.Windows.Forms.TextBox
$txtId.Location = New-Object System.Drawing.Point(75, 119); $txtId.Size = New-Object System.Drawing.Size(170, 22)
$gAccess.Controls.Add($txtId)
$lblName = New-Label $gAccess 255 122 45; $lblName.Text = 'Name'
$txtName = New-Object System.Windows.Forms.TextBox
$txtName.Location = New-Object System.Drawing.Point(300, 119); $txtName.Size = New-Object System.Drawing.Size(160, 22)
$gAccess.Controls.Add($txtName)
$btnAdd = New-Button $gAccess 'Add' 470 116 115
$btnRemove = New-Button $gAccess 'Remove selected' 15 150 140
$btnOwner = New-Button $gAccess 'Make selected owner' 165 150 150
$warn = New-Label $gAccess 15 185 570 55
$warn.ForeColor = [System.Drawing.Color]::DarkRed
$warnText = ('Everyone listed runs on YOUR Claude subscription (consumer plans are for personal use) ' +
    'and can ask the bot anything, including your positions, P&L and trades. ' +
    'Right-click a person in Discord > Copy User ID (Developer Mode on). Takes effect after Restart.')
$warn.Text = $warnText

# ------------------------------------------------------------------ refresh of the window
function Update-Panel {
    try {
        $u = Get-BotUsage -UsageFile $paths.UsageFile
        for ($i = 0; $i -lt 2; $i++) {
            $w = $u.Windows[$i]
            $usageRows[$i].Bar.Value = [int][math]::Min(100, [math]::Max(0, $(if ($null -ne $w.Used -and $w.State -eq 'ok') { $w.Used } else { 0 })))
            $usageRows[$i].Text.Text = Format-BotUsageWindow -Window $w
        }
        $usageNote.Text = if ($u.Available) { 'Reading from the bot at {0:ddd HH:mm}; it updates when the bot replies.' -f $u.ObservedAt } else { 'No reading yet: restart the bot once and send it a message.' }

        $s = Get-BotSessionInfo
        $botStatus.Text = if ($s.Running) {
            'Running since {0:ddd HH:mm}{1}' -f $s.StartedAt, $(if (@($s.LauncherIds).Count) { '' } else { ' - WARNING: no launcher, it will not restart itself' })
        } else { 'Not running' }
        $btnStart.Enabled = -not $s.Running
        $btnRestart.Enabled = $s.Running
        $btnStop.Enabled = $s.Running

        $t = Get-BotRefreshTaskState
        $refreshStatus.Text = if (-not $t.Installed) { 'Off (not set up yet)' } elseif ($t.Enabled) {
            'On - next run {0:ddd HH:mm}' -f $t.NextRun } else { 'Off' }
        $btnToggle.Text = if ($t.Enabled) { 'Turn off' } else { 'Turn on' }
        $st = Read-BotJson $paths.RefreshStatus
        $refreshLast.Text = if ($st) {
            ("Last run {0}`r`n" -f ([datetime]$st.at).ToString('ddd HH:mm')) + ((@($st.repos) | ForEach-Object {
                '{0}: {1} - {2}' -f $_.repo, $(if ($_.pulled) { 'updated' } elseif ($_.fresh) { 'current' } else { 'STALE' }), $_.reason }) -join "`r`n")
        } else { 'No run yet' }

        $sel = if ($list.SelectedItems.Count) { $list.SelectedItems[0].SubItems[1].Text } else { $null }
        $acc = Get-BotAccess -AccessFile $paths.AccessFile -LabelsFile $paths.LabelsFile
        $list.BeginUpdate(); $list.Items.Clear()
        foreach ($usr in $acc.Users) {
            $item = New-Object System.Windows.Forms.ListViewItem($(if ($usr.Label) { $usr.Label } elseif ($usr.IsOwner) { 'Jie' } else { '(no name)' }))
            [void]$item.SubItems.Add($usr.Id)
            [void]$item.SubItems.Add($(if ($usr.IsOwner) { 'Owner' } else { 'User (sees positions)' }))
            if ($usr.Id -eq $sel) { $item.Selected = $true }
            [void]$list.Items.Add($item)
        }
        $list.EndUpdate()
        $warn.Text = if (-not $acc.Owner -and $acc.Users.Count -gt 1) { 'Owner NOT SET: select yourself and click "Make selected owner" before adding anyone else.' } else { $warnText }
    } catch {
        $usageNote.Text = "Refresh failed: $($_.Exception.Message)"
    }
}

$btnStart.Add_Click({
    try { Start-ScheduledTask -TaskName 'BotBoxPrivateClaude' } catch { Show-Error "Could not start the bot task: $($_.Exception.Message)" }
    Start-Sleep -Seconds 2; Update-Panel
})
$btnRestart.Add_Click({
    $n = Stop-BotSession
    if ($n -eq 0) { Show-Error 'The bot was not running.' }
    Start-Sleep -Seconds 2; Update-Panel
})
$btnStop.Add_Click({
    $r = [System.Windows.Forms.MessageBox]::Show('Stop the bot? It will not answer until you press Start or sign in again.', 'Bot box', 'YesNo', 'Question')
    if ($r -eq 'Yes') { [void](Stop-BotSession -IncludeLauncher); Start-Sleep -Seconds 2; Update-Panel }
})
$btnToggle.Add_Click({
    try {
        if ((Get-BotRefreshTaskState).Enabled) { Disable-BotRefreshTask } else { Enable-BotRefreshTask -ScriptPath $refreshScript }
    } catch { Show-Error "Could not change the refresh task: $($_.Exception.Message)" }
    Update-Panel
})
$btnRunNow.Add_Click({
    if ((Get-BotRefreshTaskState).Installed) { Start-ScheduledTask -TaskName 'BotBoxRepoRefresh' }
    else { Start-Process powershell -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $refreshScript + '"')) }
    $refreshStatus.Text = 'Running... (refresh the window in a minute)'
})
$btnAdd.Add_Click({
    $id = $txtId.Text.Trim()
    if (-not (Test-DiscordId $id)) { Show-Error 'A Discord user ID is 17-20 digits. Right-click the person in Discord > Copy User ID.'; return }
    $r = [System.Windows.Forms.MessageBox]::Show(("Let {0} command the bot on your Claude subscription?`r`nThey WILL see your positions, P&L and trades." -f $(if ($txtName.Text) { $txtName.Text } else { $id })), 'Bot box', 'YesNo', 'Warning')
    if ($r -ne 'Yes') { return }
    try { Add-BotAccessUser -AccessFile $paths.AccessFile -LabelsFile $paths.LabelsFile -UserId $id -Label $txtName.Text; $txtId.Text = ''; $txtName.Text = '' }
    catch { Show-Error $_.Exception.Message }
    Update-Panel
})
$btnRemove.Add_Click({
    if (-not $list.SelectedItems.Count) { return }
    try { Remove-BotAccessUser -AccessFile $paths.AccessFile -LabelsFile $paths.LabelsFile -UserId $list.SelectedItems[0].SubItems[1].Text }
    catch { Show-Error $_.Exception.Message }
    Update-Panel
})
$btnOwner.Add_Click({
    if (-not $list.SelectedItems.Count) { return }
    try { Set-BotAccessOwner -AccessFile $paths.AccessFile -LabelsFile $paths.LabelsFile -UserId $list.SelectedItems[0].SubItems[1].Text }
    catch { Show-Error $_.Exception.Message }
    Update-Panel
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 15000
$timer.Add_Tick({ Update-Panel })
if ($SmokeTest) {
    Update-Panel
    $out = @('USAGE', $usageRows[0].Text.Text, $usageRows[1].Text.Text, $usageNote.Text,
        'BOT', $botStatus.Text, ('buttons start={0} restart={1} stop={2}' -f $btnStart.Enabled, $btnRestart.Enabled, $btnStop.Enabled),
        'REFRESH', $refreshStatus.Text, $btnToggle.Text, $refreshLast.Text,
        'ACCESS') + @($list.Items | ForEach-Object { '{0} | {1} | {2}' -f $_.Text, ($_.SubItems[1].Text -replace '\d{15,}', '<id>'), $_.SubItems[2].Text })
    $out | ForEach-Object { Write-Host $_ }
    $form.Dispose()
    exit 0
}
$form.Add_Shown({ Update-Panel; $timer.Start() })
$form.Add_FormClosed({ $timer.Stop() })
[void]$form.ShowDialog()
