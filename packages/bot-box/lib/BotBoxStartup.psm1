<#
.SYNOPSIS
  Startup safety for the private bot launcher: one-launcher lock, guarded repo refresh
  and the freshness notice given to the bot. Kept in a module so it can be tested
  offline (tests\Test-BotBoxStartup.ps1) without starting Claude or Discord.

  The launcher never resets, stashes, checks out or cleans anything. The shared checkout
  is fast-forwarded only when nothing can be lost or collide: on a branch with an
  upstream, not diverged, no merge/rebase/cherry-pick in progress, no active agent claim
  on the repository, and no local change or untracked file on a path the update touches.
  Otherwise the repository is left exactly as found and the bot is told it is STALE.
#>
Set-StrictMode -Version 2

function Enter-BotLauncherLock {
    # Atomic: the OS grants an exclusive handle to one process only, and releases it when
    # that process exits, so a crashed launcher never leaves a stale lock behind.
    param([Parameter(Mandatory)][string]$Path)
    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    try {
        return [System.IO.File]::Open($Path, [System.IO.FileMode]::OpenOrCreate,
            [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    } catch [System.IO.IOException] {
        return $null
    } catch [System.UnauthorizedAccessException] {
        return $null
    }
}

function Invoke-BotGit {
    param([Parameter(Mandatory)][string]$Repo, [Parameter(Mandatory)][string[]]$GitArgs)
    $ErrorActionPreference = 'Continue'
    $env:GIT_TERMINAL_PROMPT = '0'
    $out = & git -C $Repo @GitArgs 2>&1
    $code = $LASTEXITCODE
    return [pscustomobject]@{
        Code   = $code
        Output = @($out | ForEach-Object { "$_" } | Where-Object { $_ -ne '' })
    }
}

function Get-BotRepoIdentity {
    # Same identity agent_control.py uses: the Git common directory.
    param([Parameter(Mandatory)][string]$Repo)
    $r = Invoke-BotGit -Repo $Repo -GitArgs @('rev-parse', '--path-format=absolute', '--git-common-dir')
    if ($r.Code -ne 0 -or $r.Output.Count -eq 0) { return $null }
    return ('git:' + ([System.IO.Path]::GetFullPath($r.Output[0].Trim())).TrimEnd('\', '/').Replace('/', '\')).ToLowerInvariant()
}

function ConvertFrom-BotClaimListing {
    # Plain `agent_control.py list` gives each claim's live state ("id: owner / state /
    # lifecycle"); `list --json` gives its scopes. Returns repository identities that have
    # an active or pending claim.
    param([string[]]$PlainLines, [string]$JsonText)
    $live = @{}
    foreach ($line in $PlainLines) {
        if ($line -match '^(?<id>[^:\s]+): .+ / (?<state>[a-z_]+) / [a-z_]+\s*$' -and
            @('active', 'pending') -contains $Matches['state']) {
            $live[$Matches['id']] = $true
        }
    }
    $claims = $JsonText | ConvertFrom-Json
    $repos = New-Object System.Collections.Generic.List[string]
    foreach ($p in $claims.PSObject.Properties) {
        if (-not $live.ContainsKey($p.Name)) { continue }
        foreach ($s in @($p.Value.scopes)) {
            if ($s -and $s.repository) {
                $id = ([string]$s.repository).TrimEnd('\', '/').Replace('/', '\').ToLowerInvariant()
                if (-not $repos.Contains($id)) { $repos.Add($id) }
            }
        }
    }
    return $repos.ToArray()  # callers wrap in @(); an empty result is null
}

function Get-BotActiveClaimRepositories {
    param([Parameter(Mandatory)][string]$WikiRoot)
    $ErrorActionPreference = 'Continue'
    $tool = Join-Path $WikiRoot 'scripts\agent_control.py'
    if (-not (Test-Path $tool)) { return [pscustomobject]@{ Ok = $false; Repositories = @(); Error = "missing $tool" } }
    $plain = & python $tool list 2>$null
    $c1 = $LASTEXITCODE
    $json = (& python $tool list --json 2>$null) -join "`n"
    $c2 = $LASTEXITCODE
    if ($c1 -ne 0 -or $c2 -ne 0) {
        return [pscustomobject]@{ Ok = $false; Repositories = @(); Error = "agent_control list exited $c1/$c2" }
    }
    try {
        $repos = ConvertFrom-BotClaimListing -PlainLines @($plain) -JsonText $json
        return [pscustomobject]@{ Ok = $true; Repositories = @($repos); Error = '' }
    } catch {
        return [pscustomobject]@{ Ok = $false; Repositories = @(); Error = "unreadable claim listing: $($_.Exception.Message)" }
    }
}

function Update-BotRepo {
    param(
        [Parameter(Mandatory)][string]$Repo,
        [switch]$NoPull,
        [string[]]$ClaimedRepositories = @(),
        [string]$ClaimCheckError = ''
    )
    $res = [pscustomobject]@{
        Repo = (Split-Path $Repo -Leaf); Fresh = $false; Pulled = $false
        Ahead = $null; Behind = $null; Reason = ''
    }
    function Stop-Stale([string]$Why) { $res.Reason = $Why; return $res }

    $branch = Invoke-BotGit $Repo @('symbolic-ref', '--quiet', '--short', 'HEAD')
    if ($branch.Code -ne 0) { return (Stop-Stale 'detached HEAD or not a repository; left as found') }
    $up = Invoke-BotGit $Repo @('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}')
    if ($up.Code -ne 0) { return (Stop-Stale ("branch {0} has no upstream; left as found" -f $branch.Output[0])) }

    $fetch = Invoke-BotGit $Repo @('fetch', '--quiet')
    if ($fetch.Code -ne 0) {
        $last = if ($fetch.Output.Count) { $fetch.Output[-1] } else { "exit $($fetch.Code)" }
        return (Stop-Stale "fetch failed: $last")
    }
    $counts = Invoke-BotGit $Repo @('rev-list', '--left-right', '--count', 'HEAD...@{u}')
    if ($counts.Code -ne 0 -or $counts.Output.Count -eq 0) { return (Stop-Stale 'could not compare with upstream') }
    $n = $counts.Output[0].Trim() -split '\s+'
    $res.Ahead = [int]$n[0]; $res.Behind = [int]$n[1]
    if ($res.Behind -eq 0) {
        $res.Fresh = $true
        $res.Reason = if ($res.Ahead -gt 0) { "up to date with $($up.Output[0]); $($res.Ahead) local commit(s) not pushed" } else { "up to date with $($up.Output[0])" }
        return $res
    }

    $behind = "behind $($up.Output[0]) by $($res.Behind)"
    if ($NoPull) { return (Stop-Stale "$behind; refresh disabled (-NoPull)") }
    if ($res.Ahead -gt 0) { return (Stop-Stale "$behind and $($res.Ahead) ahead (diverged); left as found") }
    foreach ($marker in @('MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply')) {
        $p = Invoke-BotGit $Repo @('rev-parse', '--git-path', $marker)
        $full = if ([System.IO.Path]::IsPathRooted($p.Output[0])) { $p.Output[0] } else { Join-Path $Repo $p.Output[0] }
        if (Test-Path $full) { return (Stop-Stale "$behind; $marker in progress; left as found") }
    }
    if ($ClaimCheckError) { return (Stop-Stale "$behind; claim check failed ($ClaimCheckError); shared checkout not modified") }
    $identity = Get-BotRepoIdentity $Repo
    if (-not $identity) { return (Stop-Stale "$behind; repository identity unknown; left as found") }
    if (@($ClaimedRepositories) -contains $identity) {
        return (Stop-Stale "$behind; an agent holds an active claim in this repository; shared checkout not modified")
    }

    $incoming = Invoke-BotGit $Repo @('diff', '--name-only', 'HEAD', '@{u}')
    $tracked = Invoke-BotGit $Repo @('diff', '--name-only', 'HEAD')
    $untracked = Invoke-BotGit $Repo @('ls-files', '--others', '--exclude-standard')
    if ($incoming.Code -ne 0 -or $tracked.Code -ne 0 -or $untracked.Code -ne 0) {
        return (Stop-Stale "$behind; could not list local changes; left as found")
    }
    $local = @{}
    foreach ($f in @($tracked.Output) + @($untracked.Output)) { $local[$f] = $true }
    $overlap = @($incoming.Output | Where-Object { $local.ContainsKey($_) })
    if ($overlap.Count -gt 0) {
        $shown = ($overlap | Select-Object -First 5) -join ', '
        return (Stop-Stale "$behind; local changes on incoming paths ($shown) preserved; not updated")
    }

    $merge = Invoke-BotGit $Repo @('merge', '--ff-only', '--quiet', '@{u}')
    if ($merge.Code -ne 0) {
        $last = if ($merge.Output.Count) { $merge.Output[-1] } else { "exit $($merge.Code)" }
        return (Stop-Stale "$behind; fast-forward failed: $last")
    }
    $after = Invoke-BotGit $Repo @('rev-list', '--count', 'HEAD..@{u}')
    if ($after.Code -ne 0 -or $after.Output[0].Trim() -ne '0') { return (Stop-Stale "$behind; still behind after fast-forward") }
    $res.Pulled = $true; $res.Fresh = $true; $res.Behind = 0
    $res.Reason = "fast-forwarded to $($up.Output[0])"
    return $res
}

function Get-BotFreshnessNotice {
    param([Parameter(Mandatory)][object[]]$Results, [datetime]$At = (Get-Date))
    $lines = @('', '## Repository freshness at launch', '')
    foreach ($r in $Results) {
        $lines += ('- {0}: {1} - {2}' -f $r.Repo, $(if ($r.Fresh) { 'current' } else { 'STALE' }), $r.Reason)
    }
    $lines += ('- checked {0:yyyy-MM-dd HH:mm} local time' -f $At)
    if (@($Results | Where-Object { -not $_.Fresh }).Count -gt 0) {
        $lines += ''
        $lines += 'STALE MODE: a repository above could not be refreshed. Any answer that relies on'
        $lines += 'wiki doctrine, skills or scripts must say that they may be out of date, and name the'
        $lines += 'repository. Do not try to update, reset or stash it yourself.'
    }
    return ($lines -join "`n")
}

Export-ModuleMember -Function Enter-BotLauncherLock, Invoke-BotGit, Get-BotRepoIdentity, ConvertFrom-BotClaimListing,
    Get-BotActiveClaimRepositories, Update-BotRepo, Get-BotFreshnessNotice
