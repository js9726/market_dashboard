# scripts/validate_changes.ps1
#
# End-to-end validation for the composed-giraffe plan changes.
# Run any time to verify CLAUDE.md, the Python scripts, and the Next.js API
# routes are still in a healthy state.
#
# Usage:   powershell -NoProfile -File scripts\validate_changes.ps1
#
# Exits 0 on success, 1 on first failure.

$ErrorActionPreference = "Stop"

$repo = Resolve-Path (Join-Path $PSScriptRoot "..")
$app  = Join-Path $repo "apps/market_dashboard"
$be   = Join-Path $repo "apps/market_dashboard_backend"

$script:failures = @()

function Step($name, [ScriptBlock]$body) {
    Write-Host ""
    Write-Host "==> $name" -ForegroundColor Cyan
    # Reset $LASTEXITCODE so a previous native-exe failure does not bleed in.
    $global:LASTEXITCODE = 0
    try {
        & $body
        if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
            $script:failures += $name
            Write-Host "    FAIL ($name) exit=$LASTEXITCODE" -ForegroundColor Red
        } else {
            Write-Host "    OK" -ForegroundColor Green
        }
    } catch {
        $script:failures += $name
        Write-Host ("    FAIL ($name): " + $_) -ForegroundColor Red
    }
}

# 1. CLAUDE.md section structure
Step "CLAUDE.md has exactly 8 numbered sections (1..8)" {
    $sections = Select-String -Path (Join-Path $repo "CLAUDE.md") -Pattern '^## (\d+)\.' |
                ForEach-Object { [int]$_.Matches[0].Groups[1].Value }
    if ($sections.Count -ne 8) {
        throw "Expected 8 sections, got $($sections.Count): $($sections -join ',')"
    }
    for ($i = 0; $i -lt 8; $i++) {
        if ($sections[$i] -ne ($i + 1)) {
            throw "Section numbering broken: got $($sections -join ',')"
        }
    }
    $surgical = Select-String -Path (Join-Path $repo "CLAUDE.md") -Pattern 'Surgical Changes'
    if ($surgical) {
        throw "'Surgical Changes' heading should have been removed"
    }
}

# 2. Python scripts all import cleanly
Step "All 7 Python scripts import without error" {
    Push-Location (Join-Path $be "scripts")
    try {
        python -c "import importlib; [importlib.import_module(m) for m in ['build_data','breadth_scan','morning_brief','trader_verdict','tv_screener_fetch','live_quote_daemon','yahoo_quote_push']]; print('imports OK')"
    } finally { Pop-Location }
}

# 3. sanitize_json + safe_json_dumps round-trip on synthetic data
Step "sanitize_json + safe_json_dumps strip NaN / Inf across the 3 importing scripts" {
    Push-Location (Join-Path $be "scripts")
    try {
        python _validate_safety.py
    } finally { Pop-Location }
}

# 4. No bare NaN/Infinity tokens in synced JSON
Step "No bare NaN/Infinity in apps/market_dashboard/public/market-dashboard/*.json" {
    $publicDir = Join-Path $app "public/market-dashboard"
    if (-not (Test-Path $publicDir)) {
        Write-Host "    (no synced public dir yet -- skipping)" -ForegroundColor Yellow
        return
    }
    $files = Get-ChildItem -Path $publicDir -Filter "*.json" -ErrorAction SilentlyContinue
    if (-not $files) {
        Write-Host "    (no synced JSON files yet -- skipping)" -ForegroundColor Yellow
        return
    }
    foreach ($f in $files) {
        $hit = Select-String -Path $f.FullName -Pattern '\bNaN\b|\bInfinity\b' -CaseSensitive
        if ($hit) {
            $line = $hit[0].Line
            throw ("Bare NaN/Infinity in " + $f.Name + ": " + $line)
        }
    }
}

# 5. TypeScript: tsc --noEmit clean
Step "npx tsc --noEmit passes in apps/market_dashboard" {
    Push-Location $app
    try {
        npx tsc --noEmit
    } finally { Pop-Location }
}

# 6. ESLint clean
Step "npm run lint passes" {
    Push-Location $app
    try {
        npm run lint
    } finally { Pop-Location }
}

# 7. analysis/route.ts uses DEEPSEEK_API_KEY (not GEMINI_API_KEY)
Step "analysis/route.ts gates technical agent on DEEPSEEK_API_KEY" {
    $route = Join-Path $app "src/app/api/analysis/route.ts"
    $bad = Select-String -Path $route -Pattern 'process\.env\.GEMINI_API_KEY'
    if ($bad) {
        throw "analysis/route.ts still references GEMINI_API_KEY"
    }
    $good = Select-String -Path $route -Pattern 'process\.env\.DEEPSEEK_API_KEY'
    if (-not $good) {
        throw "analysis/route.ts should reference DEEPSEEK_API_KEY but does not"
    }
}

# 8. morning-verdict/rerun has id-then-role auth chain
Step "morning-verdict/rerun checks session.user.id before role" {
    $route = Join-Path $app "src/app/api/morning-verdict/rerun/route.ts"
    $idCheck   = Select-String -Path $route -Pattern '!session\?\.user\?\.id'
    $roleCheck = Select-String -Path $route -Pattern 'session\.user\.role !== "owner"'
    if (-not $idCheck -or -not $roleCheck) {
        throw "Expected both id and role checks in morning-verdict/rerun"
    }
    if ($idCheck[0].LineNumber -ge $roleCheck[0].LineNumber) {
        throw "id check (line $($idCheck[0].LineNumber)) must come before role check (line $($roleCheck[0].LineNumber))"
    }
}

# 9. ROADMAP exists
Step "ROADMAP.md present" {
    $r = Join-Path $app "docs/ROADMAP.md"
    if (-not (Test-Path $r)) { throw ("ROADMAP.md missing at " + $r) }
    if ((Get-Item $r).Length -lt 1000) { throw "ROADMAP.md suspiciously small" }
}

# 10. Vitest classifier tests pass (Feature 2 - Theme Radar)
Step "npm test passes (classifyTheme unit tests)" {
    Push-Location $app
    try {
        npm test
    } finally { Pop-Location }
}

# 11. Theme Radar route + nav wired
Step "Theme Radar files present and wired" {
    $files = @(
        (Join-Path $app "src/lib/themes.ts"),
        (Join-Path $app "src/hooks/useMarketSnapshot.ts"),
        (Join-Path $app "src/components/market-desk/ThemeRadar.tsx"),
        (Join-Path $app "src/app/dashboard/themes/page.tsx"),
        (Join-Path $app "src/lib/__tests__/themes.test.ts"),
        (Join-Path $app "vitest.config.ts")
    )
    foreach ($f in $files) {
        if (-not (Test-Path $f)) { throw ("Missing: " + $f) }
    }
    $shell = Join-Path $app "src/components/market-desk/MarketDeskShell.tsx"
    $navHit = Select-String -Path $shell -Pattern '/dashboard/themes'
    if (-not $navHit) { throw "MarketDeskShell.tsx does not link /dashboard/themes" }
}

# 12. breadth_scan.py exposes drop-rate flags + helper (WK-3 observability)
Step "breadth_scan.py has drop-rate observability (WK-3)" {
    $bs = Join-Path $be "scripts/breadth_scan.py"
    $needles = @(
        '--drop-rate-warn',
        '--drop-rate-fail',
        '_compute_drop_stats',
        'WARNING: drop rate'
    )
    foreach ($pattern in $needles) {
        $hit = Select-String -Path $bs -Pattern ([regex]::Escape($pattern))
        if (-not $hit) { throw ("breadth_scan.py missing pattern: " + $pattern) }
    }
}

# 13. Cron schedules dodge :00/:30 peak slots (WK-4)
Step "Workflow cron minutes off-peak (WK-4)" {
    $rd = Join-Path $repo ".github/workflows/refresh_data.yml"
    $ri = Join-Path $repo ".github/workflows/refresh_data_intraday.yml"
    $yh = Join-Path $repo ".github/workflows/yahoo_fallback_quotes.yml"
    # Disallow any '0 13', '0 14', '30 13', etc. cron expressions
    $bad = Select-String -Path $rd, $ri, $yh -Pattern "^\s*-\s*cron:\s*'(0|30)\s"
    if ($bad) { throw "Found peak-slot cron entries: $($bad.Line -join '; ')" }
}

# 16. Feature 1 Rotation Graph wired (classifier + Recharts + route + nav)
Step "Rotation Graph wired (Feature 1)" {
    $files = @(
        (Join-Path $app "src/lib/rrg.ts"),
        (Join-Path $app "src/components/market-desk/RotationGraph.tsx"),
        (Join-Path $app "src/app/dashboard/rrg/page.tsx"),
        (Join-Path $app "src/lib/__tests__/rrg.test.ts")
    )
    foreach ($f in $files) {
        if (-not (Test-Path $f)) { throw ("Missing: " + $f) }
    }
    $shell = Join-Path $app "src/components/market-desk/MarketDeskShell.tsx"
    if (-not (Select-String -Path $shell -Pattern '/dashboard/rrg')) {
        throw "MarketDeskShell.tsx does not link /dashboard/rrg"
    }
    $rrg = Join-Path $app "src/lib/rrg.ts"
    foreach ($pattern in @('classifyRrg', 'toRrgPoints', 'rrgQuadrantCounts', 'QUADRANT_META')) {
        if (-not (Select-String -Path $rrg -Pattern ([regex]::Escape($pattern)))) {
            throw "rrg.ts missing export: $pattern"
        }
    }
    $component = Join-Path $app "src/components/market-desk/RotationGraph.tsx"
    if (-not (Select-String -Path $component -Pattern 'ScatterChart')) {
        throw "RotationGraph.tsx does not import ScatterChart"
    }
}

# 15. Feature 3 RVOL Overview wired (build_data fields + frontend + nav)
Step "RVOL Overview wired (Feature 3)" {
    $bd = Join-Path $be "scripts/build_data.py"
    foreach ($pattern in @('"rvol":', '"off_52w_high_pct":', "fetch_history_with_fallback(ticker_symbol, 400)")) {
        $hit = Select-String -Path $bd -Pattern ([regex]::Escape($pattern))
        if (-not $hit) { throw ("build_data.py missing pattern: " + $pattern) }
    }
    $files = @(
        (Join-Path $app "src/lib/rvol.ts"),
        (Join-Path $app "src/components/market-desk/RvolOverview.tsx"),
        (Join-Path $app "src/app/dashboard/rvol/page.tsx"),
        (Join-Path $app "src/lib/__tests__/rvol.test.ts")
    )
    foreach ($f in $files) {
        if (-not (Test-Path $f)) { throw ("Missing: " + $f) }
    }
    $shell = Join-Path $app "src/components/market-desk/MarketDeskShell.tsx"
    if (-not (Select-String -Path $shell -Pattern '/dashboard/rvol')) {
        throw "MarketDeskShell.tsx does not link /dashboard/rvol"
    }
    $types = Join-Path $app "src/types/market-dashboard.ts"
    foreach ($pattern in @('rvol\?', 'off_52w_high_pct\?')) {
        if (-not (Select-String -Path $types -Pattern $pattern)) {
            throw "TickerRow type missing optional field $pattern"
        }
    }
}

# 14. WK-1 split: daily heavy + intraday light workflows exist with correct steps
Step "Workflow split into daily heavy + intraday light (WK-1)" {
    $rd = Join-Path $repo ".github/workflows/refresh_data.yml"
    $ri = Join-Path $repo ".github/workflows/refresh_data_intraday.yml"
    if (-not (Test-Path $ri)) { throw "refresh_data_intraday.yml is missing" }
    # Daily must invoke all 5 scripts
    $dailyContent = Get-Content $rd -Raw
    foreach ($script in @('build_data.py','breadth_scan.py','tv_screener_fetch.py','morning_brief.py','trader_verdict.py')) {
        if ($dailyContent -notmatch "python\s+scripts/$([regex]::Escape($script))") {
            throw "daily refresh_data.yml missing invocation of $script"
        }
    }
    # Intraday must NOT invoke the heavy LLM scripts (check actual run: lines, not comments)
    $intraLines = Get-Content $ri | Where-Object { $_ -notmatch '^\s*#' }
    $intraText  = $intraLines -join "`n"
    foreach ($script in @('breadth_scan.py','morning_brief.py','trader_verdict.py')) {
        if ($intraText -match "python\s+scripts/$([regex]::Escape($script))") {
            throw "intraday workflow should NOT invoke $script (heavy LLM/data-source)"
        }
    }
    # Intraday must invoke build_data + tv_screener
    foreach ($script in @('build_data.py','tv_screener_fetch.py')) {
        if ($intraText -notmatch "python\s+scripts/$([regex]::Escape($script))") {
            throw "intraday workflow missing invocation of $script"
        }
    }
}

Write-Host ""
if ($script:failures.Count -gt 0) {
    Write-Host ("FAILED: " + $script:failures.Count + " check(s) -- " + ($script:failures -join '; ')) -ForegroundColor Red
    exit 1
} else {
    Write-Host "ALL CHECKS PASSED" -ForegroundColor Green
    exit 0
}
