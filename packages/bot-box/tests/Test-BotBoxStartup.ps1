<#
.SYNOPSIS
  Offline regression tests for the launcher's startup safety (review finding B5).

  Uses throwaway Git repositories under %TEMP% (a bare origin and clones), a temporary
  USERPROFILE for launcher-level runs, and child PowerShell processes to hold the lock.
  Never starts Claude or Discord, never touches the real checkouts, network or bot.

  Run:  powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\Test-BotBoxStartup.ps1
  Exit: 0 all passed, 1 any failure.
#>
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$kit = Split-Path -Parent $here
$modulePath = Join-Path $kit 'lib\BotBoxStartup.psm1'
$launcher = Join-Path $kit 'start-private-bot.ps1'
Import-Module $modulePath -Force

$script:passed = 0
$script:failed = 0
function Check {
    param([string]$Name, [bool]$Condition, [string]$Detail = '')
    if ($Condition) { $script:passed++; Write-Host "PASS  $Name" -ForegroundColor Green }
    else { $script:failed++; Write-Host "FAIL  $Name  $Detail" -ForegroundColor Red }
}

$root = Join-Path ([System.IO.Path]::GetTempPath()) ('botbox-test-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $root | Out-Null

function G {
    # git with a throwaway identity and no hooks, quiet, fails loudly on error
    $ErrorActionPreference = 'Continue'
    $out = & git -c user.name=botbox-test -c user.email=botbox-test@example.invalid -c core.hooksPath=NUL -c advice.detachedHead=false @args 2>&1
    if ($LASTEXITCODE -ne 0) { throw ("git {0} failed: {1}" -f ($args -join ' '), ($out -join ' ')) }
    return @($out | ForEach-Object { "$_" })
}

$fixtureN = 0
function New-Fixture {
    # origin (bare) <- author (pushes) ; bot (the checkout the launcher refreshes), 1 behind
    $script:fixtureN++
    $d = Join-Path $root "f$script:fixtureN"
    New-Item -ItemType Directory -Path $d | Out-Null
    $origin = Join-Path $d 'origin.git'; $author = Join-Path $d 'author'; $bot = Join-Path $d 'bot'
    G init --quiet --bare -b main $origin | Out-Null
    G clone --quiet $origin $author | Out-Null
    G -C $author symbolic-ref HEAD refs/heads/main | Out-Null
    Set-Content -Path (Join-Path $author 'a.txt') -Value 'a1' -Encoding ascii
    Set-Content -Path (Join-Path $author 'b.txt') -Value 'b1' -Encoding ascii
    G -C $author add -A | Out-Null
    G -C $author commit --quiet -m seed | Out-Null
    G -C $author push --quiet -u origin main | Out-Null
    G clone --quiet $origin $bot | Out-Null
    Set-Content -Path (Join-Path $author 'a.txt') -Value 'a2' -Encoding ascii
    Set-Content -Path (Join-Path $author 'c.txt') -Value 'c-new' -Encoding ascii
    G -C $author add -A | Out-Null
    G -C $author commit --quiet -m advance | Out-Null
    G -C $author push --quiet | Out-Null
    return [pscustomobject]@{ Origin = $origin; Author = $author; Bot = $bot }
}
function Head($repo) { (G -C $repo rev-parse HEAD)[0] }
function Upstream($repo) { (G -C $repo rev-parse '@{u}')[0] }
function Stashes($repo) { @(G -C $repo stash list).Count }

try {
    # ------------------------------------------------------------------ refresh
    $f = New-Fixture
    $r = Update-BotRepo -Repo $f.Bot
    Check 'clean checkout behind origin is fast-forwarded' ($r.Pulled -and $r.Fresh -and (Head $f.Bot) -eq (Upstream $f.Bot)) $r.Reason

    $r = Update-BotRepo -Repo $f.Bot
    Check 'up-to-date checkout is fresh without pulling' ($r.Fresh -and -not $r.Pulled) $r.Reason

    $f = New-Fixture
    $before = Head $f.Bot
    Set-Content -Path (Join-Path $f.Bot 'a.txt') -Value 'local edit' -Encoding ascii
    $r = Update-BotRepo -Repo $f.Bot
    Check 'dirty overlap: not updated, reported STALE' ((-not $r.Fresh) -and $r.Reason -match 'a\.txt' -and $r.Reason -match 'preserved') $r.Reason
    Check 'dirty overlap: local edit, HEAD and stash untouched' (((Get-Content (Join-Path $f.Bot 'a.txt')) -eq 'local edit') -and (Head $f.Bot) -eq $before -and (Stashes $f.Bot) -eq 0)

    $f = New-Fixture
    Set-Content -Path (Join-Path $f.Bot 'c.txt') -Value 'my untracked' -Encoding ascii
    $r = Update-BotRepo -Repo $f.Bot
    Check 'untracked file on an incoming path is preserved' ((-not $r.Fresh) -and $r.Reason -match 'c\.txt' -and ((Get-Content (Join-Path $f.Bot 'c.txt')) -eq 'my untracked')) $r.Reason

    $f = New-Fixture
    Set-Content -Path (Join-Path $f.Bot 'b.txt') -Value 'unrelated edit' -Encoding ascii
    $r = Update-BotRepo -Repo $f.Bot
    Check 'dirty non-overlapping path: updated, edit kept' ($r.Pulled -and ((Get-Content (Join-Path $f.Bot 'b.txt')) -eq 'unrelated edit') -and ((Get-Content (Join-Path $f.Bot 'a.txt')) -eq 'a2')) $r.Reason

    $f = New-Fixture
    $before = Head $f.Bot
    $r = Update-BotRepo -Repo $f.Bot -NoPull
    Check '-NoPull fetches and reports STALE only' ((-not $r.Fresh) -and $r.Behind -eq 1 -and (Head $f.Bot) -eq $before -and $r.Reason -match 'NoPull') $r.Reason

    $f = New-Fixture
    $before = Head $f.Bot
    G -C $f.Bot remote set-url origin (Join-Path $root 'does-not-exist.git') | Out-Null
    $r = Update-BotRepo -Repo $f.Bot
    Check 'failed fetch is reported, checkout left as found' ((-not $r.Fresh) -and $r.Reason -match 'fetch failed' -and (Head $f.Bot) -eq $before) $r.Reason

    $f = New-Fixture
    $before = Head $f.Bot
    G -C $f.Bot fetch --quiet | Out-Null
    $lock = Join-Path $f.Bot '.git\index.lock'
    Set-Content -Path $lock -Value '' -Encoding ascii
    $r = Update-BotRepo -Repo $f.Bot
    Remove-Item $lock -Force
    Check 'failed fast-forward is reported, nothing reset' ((-not $r.Fresh) -and $r.Reason -match 'fast-forward failed' -and (Head $f.Bot) -eq $before -and ((Get-Content (Join-Path $f.Bot 'a.txt')) -eq 'a1')) $r.Reason

    $f = New-Fixture
    Set-Content -Path (Join-Path $f.Bot 'd.txt') -Value 'local commit' -Encoding ascii
    G -C $f.Bot add d.txt | Out-Null
    G -C $f.Bot commit --quiet -m local | Out-Null
    $before = Head $f.Bot
    $r = Update-BotRepo -Repo $f.Bot
    Check 'diverged checkout is not merged' ((-not $r.Fresh) -and $r.Reason -match 'diverged' -and (Head $f.Bot) -eq $before) $r.Reason

    $f = New-Fixture
    $before = Head $f.Bot
    Set-Content -Path (Join-Path $f.Bot '.git\MERGE_HEAD') -Value $before -Encoding ascii
    $r = Update-BotRepo -Repo $f.Bot
    Remove-Item (Join-Path $f.Bot '.git\MERGE_HEAD') -Force
    Check 'merge in progress blocks the refresh' ((-not $r.Fresh) -and $r.Reason -match 'MERGE_HEAD' -and (Head $f.Bot) -eq $before) $r.Reason

    $f = New-Fixture
    $before = Head $f.Bot
    $id = Get-BotRepoIdentity $f.Bot
    $r = Update-BotRepo -Repo $f.Bot -ClaimedRepositories @('git:c:\somewhere\else\.git', $id)
    Check 'active agent claim on the repository blocks the refresh' ((-not $r.Fresh) -and $r.Reason -match 'active claim' -and (Head $f.Bot) -eq $before) $r.Reason
    $r = Update-BotRepo -Repo $f.Bot -ClaimCheckError 'agent_control list exited 1/1'
    Check 'failed claim check blocks the refresh (fail closed)' ((-not $r.Fresh) -and $r.Reason -match 'claim check failed' -and (Head $f.Bot) -eq $before) $r.Reason
    $r = Update-BotRepo -Repo $f.Bot -ClaimedRepositories @('git:c:\somewhere\else\.git')
    Check 'claim on another repository does not block' ($r.Pulled) $r.Reason

    $f = New-Fixture
    G -C $f.Bot checkout --quiet --detach | Out-Null
    $r = Update-BotRepo -Repo $f.Bot
    Check 'detached HEAD is left as found' ((-not $r.Fresh) -and $r.Reason -match 'detached') $r.Reason

    # ------------------------------------------------------------------ claims listing
    $plain = @(
        'task-active: Claude / active / in_progress',
        'task-pending: Codex / pending / in_progress',
        'task-stale: Codex / stale / in_progress',
        'task-done: Claude / released / released'
    )
    $json = @{
        'task-active'  = @{ scopes = @(@{ repository = 'git:C:\Repo\One\.git' }) }
        'task-pending' = @{ scopes = @(@{ repository = 'git:c:/repo/two/.git/' }) }
        'task-stale'   = @{ scopes = @(@{ repository = 'git:c:\repo\three\.git' }) }
        'task-done'    = @{ scopes = @(@{ repository = 'git:c:\repo\four\.git' }) }
    } | ConvertTo-Json -Depth 5
    $repos = @(ConvertFrom-BotClaimListing -PlainLines $plain -JsonText $json)
    Check 'claim listing keeps only active/pending repositories' (($repos.Count -eq 2) -and ($repos -contains 'git:c:\repo\one\.git') -and ($repos -contains 'git:c:\repo\two\.git')) ($repos -join ';')

    # ------------------------------------------------------------------ freshness notice
    $ok = [pscustomobject]@{ Repo = 'jie_wiki'; Fresh = $true; Reason = 'up to date' }
    $bad = [pscustomobject]@{ Repo = 'market_dashboard'; Fresh = $false; Reason = 'fetch failed: x' }
    $n = Get-BotFreshnessNotice -Results @($ok, $bad)
    Check 'stale repository puts the bot in STALE MODE' ($n -match 'STALE MODE' -and $n -match 'market_dashboard: STALE')
    $n = Get-BotFreshnessNotice -Results @($ok)
    Check 'all current: no STALE MODE' ($n -notmatch 'STALE' -and $n -match 'jie_wiki: current')

    # ------------------------------------------------------------------ one-launcher lock
    $lockPath = Join-Path $root 'lock\launcher.lock'
    $heldFlag = Join-Path $root 'held.flag'
    $holder = "Import-Module '$modulePath'; `$l = Enter-BotLauncherLock -Path '$lockPath'; if (`$l) { Set-Content -Path '$heldFlag' -Value held; Start-Sleep -Seconds 60 }"
    $p = Start-Process powershell -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $holder) -PassThru -WindowStyle Hidden
    $deadline = (Get-Date).AddSeconds(20)
    while (-not (Test-Path $heldFlag) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }
    Check 'lock holder process acquired the lock' (Test-Path $heldFlag)
    $second = Enter-BotLauncherLock -Path $lockPath
    Check 'second launcher cannot take a held lock' ($null -eq $second)
    if ($second) { $second.Dispose() }

    # Launcher-level: a second launcher exits 1 before touching anything.
    # Start-Process (PS 5.1) joins arguments unquoted, so paths with spaces are quoted.
    $fakeHome = Join-Path $root 'home'
    $stateDir = Join-Path $fakeHome '.claude\bot-box'
    New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
    Set-Content -Path (Join-Path $stateDir 'designated-host.txt') -Value $env:COMPUTERNAME -Encoding ascii
    $savedProfile = $env:USERPROFILE
    $p2 = $null
    try {
        $env:USERPROFILE = $fakeHome
        $holder2 = "Import-Module '$modulePath'; `$l = Enter-BotLauncherLock -Path '$stateDir\launcher.lock'; if (`$l) { Set-Content -Path '$heldFlag.2' -Value held; Start-Sleep -Seconds 60 }"
        $p2 = Start-Process powershell -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $holder2) -PassThru -WindowStyle Hidden
        $deadline = (Get-Date).AddSeconds(20)
        while (-not (Test-Path "$heldFlag.2") -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }
        $run = Start-Process powershell -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $launcher + '"'), '-PreflightOnly',
            '-WikiRoot', ('"' + $root + '"'), '-DashRoot', ('"' + $root + '"')) -PassThru -Wait -WindowStyle Hidden
        $log = Get-Content -Raw (Get-ChildItem (Join-Path $stateDir 'logs') -Filter '*.log' | Select-Object -First 1).FullName
        Check 'concurrent launcher exits 1 with a clear log line' ($run.ExitCode -eq 1 -and $log -match 'Another bot launcher') ("exit $($run.ExitCode)")
    } finally {
        $env:USERPROFILE = $savedProfile
        if ($p2 -and -not $p2.HasExited) { Stop-Process -Id $p2.Id -Force }
    }

    Stop-Process -Id $p.Id -Force
    $p.WaitForExit()
    $third = Enter-BotLauncherLock -Path $lockPath
    Check 'lock is released by the OS when its holder dies' ($null -ne $third)
    if ($third) { $third.Dispose() }

    # Launcher-level preflight on a checkout with no claim tool: the claim check fails, so
    # the repository must be reported STALE and left as found. If a real bot session is
    # already running on this machine the launcher must refuse instead.
    $f = New-Fixture
    $before = Head $f.Bot
    $home2 = Join-Path $root 'home2'
    $state2 = Join-Path $home2 '.claude\bot-box'
    New-Item -ItemType Directory -Force -Path $state2, (Join-Path $home2 '.claude\channels\discord') | Out-Null
    Set-Content -Path (Join-Path $state2 'designated-host.txt') -Value $env:COMPUTERNAME -Encoding ascii
    # Placeholder only: the launcher checks that a token line exists; nothing connects.
    Set-Content -Path (Join-Path $home2 '.claude\channels\discord\.env') -Value 'DISCORD_BOT_TOKEN=offline-test-placeholder' -Encoding ascii
    $botRunning = @(Get-CimInstance Win32_Process -Filter "Name='claude.exe'" | Where-Object { $_.CommandLine -match '--channels plugin:discord' }).Count -gt 0
    try {
        $env:USERPROFILE = $home2
        $run = Start-Process powershell -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $launcher + '"'), '-PreflightOnly',
            '-WikiRoot', ('"' + $f.Bot + '"'), '-DashRoot', ('"' + $f.Bot + '"')) -PassThru -Wait -WindowStyle Hidden
    } finally {
        $env:USERPROFILE = $savedProfile
    }
    $log = Get-Content -Raw (Get-ChildItem (Join-Path $state2 'logs') -Filter '*.log' | Select-Object -First 1).FullName
    if ($botRunning) {
        Check 'launcher refuses while a bot session is already running' ($run.ExitCode -eq 1 -and $log -match 'already running') ("exit $($run.ExitCode)")
    } elseif ($log -match 'is not on PATH') {
        Write-Host 'SKIP  launcher preflight: claude or bun is not installed on this machine' -ForegroundColor Yellow
    } else {
        Check 'preflight with failed claim check starts in STALE mode' ($run.ExitCode -eq 0 -and $log -match 'claim check failed' -and $log -match 'STALE mode') ("exit $($run.ExitCode)")
    }
    Check 'launcher preflight left the checkout as found' ((Head $f.Bot) -eq $before -and (Stashes $f.Bot) -eq 0)
} finally {
    Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:passed, $script:failed)
if ($script:failed -gt 0) { exit 1 }
exit 0
