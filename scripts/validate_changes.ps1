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
Step "Core Python scripts import without error" {
    Push-Location (Join-Path $be "scripts")
    try {
        python -c "import importlib; [importlib.import_module(m) for m in ['build_data','breadth_scan','morning_brief','trader_verdict','tv_screener_fetch','live_quote_daemon']]; print('imports OK')"
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
    $rd = Join-Path $repo ".github/workflows/refresh_premarket.yml"
    $ri = Join-Path $repo ".github/workflows/refresh_data_intraday.yml"
    # Disallow any '0 13', '0 14', '30 13', etc. cron expressions.
    # The Yahoo fallback workflow was retired in favour of dashboard-bridge live quotes.
    $bad = Select-String -Path $rd, $ri -Pattern "^\s*-\s*cron:\s*'(0|30)\s"
    if ($bad) { throw "Found peak-slot cron entries: $($bad.Line -join '; ')" }
}

# 22. G1 Trade Audits wired (DB-backed wiki sync + parser + API + UI)
Step "Trade Audits wired (DB-backed wiki integration)" {
    $sync = Join-Path $app "scripts/sync-wiki.mjs"
    if (-not (Test-Path -LiteralPath $sync)) { throw ("Missing sync-wiki.mjs: " + $sync) }
    $files = @(
        (Join-Path $app "src/lib/wiki/audits.ts"),
        (Join-Path $app "src/lib/__tests__/audits.test.ts"),
        (Join-Path $app "src/app/api/wiki/audits/route.ts"),
        (Join-Path $app "src/app/api/wiki/audits/[period]/route.ts"),
        (Join-Path $app "src/app/api/wiki/audits/ingest/route.ts"),
        (Join-Path $app "src/app/api/wiki/trades/[date]/[ticker]/[stage]/route.ts"),
        (Join-Path $app "src/components/audits/AuditsView.tsx"),
        (Join-Path $app "src/app/dashboard/audits/page.tsx"),
        (Join-Path $app "prisma/migrations/20260521100000_add_wiki_audit_cache/migration.sql")
    )
    foreach ($f in $files) {
        if (-not (Test-Path -LiteralPath $f)) { throw ("Missing: " + $f) }
    }
    $pkg = Join-Path $app "package.json"
    if (-not (Select-String -Path $pkg -Pattern '"sync:wiki"')) {
        throw "package.json missing sync:wiki script"
    }
    $shell = Join-Path $app "src/components/market-desk/MarketDeskShell.tsx"
    if (-not (Select-String -Path $shell -Pattern '/dashboard/trades')) {
        throw "MarketDeskShell.tsx does not link /dashboard/trades"
    }
    $parser = Join-Path $app "src/lib/wiki/audits.ts"
    foreach ($p in @('parseAudit', 'AuditReport', 'WikiManifest')) {
        if (-not (Select-String -Path $parser -Pattern ([regex]::Escape($p)))) {
            throw "audits.ts missing export: $p"
        }
    }
    $schema = Join-Path $app "prisma/schema.prisma"
    foreach ($p in @('model WikiAudit', 'model WikiTradeVerdict')) {
        if (-not (Select-String -Path $schema -Pattern ([regex]::Escape($p)))) {
            throw "schema.prisma missing: $p"
        }
    }
    $middleware = Join-Path $app "src/middleware.ts"
    if (-not (Select-String -Path $middleware -Pattern '/api/wiki/audits/ingest')) {
        throw "middleware.ts must allow bearer-token wiki audit ingest"
    }
}

# 21. Feature 9 Design system adoption (logos + intentional persistent ThemeToggle)
Step "Design system adoption (Feature 9)" {
    foreach ($asset in @('icons.svg', 'logo-market-desk.svg', 'logo-twi-mark.svg', 'logo-twi-wordmark.svg')) {
        $p = Join-Path $app ("public/ds/" + $asset)
        if (-not (Test-Path -LiteralPath $p)) { throw ("Missing public/ds asset: " + $asset) }
    }
    $shell = Join-Path $app "src/components/market-desk/MarketDeskShell.tsx"
    # Persistent user ThemeToggle is intentional for this branch. It still must
    # bind data-mode on html/body so design tokens resolve.
    if (-not (Select-String -Path $shell -Pattern 'setAttribute\("data-mode"')) {
        throw "MarketDeskShell.tsx no longer sets data-mode on the document body"
    }
    foreach ($needle in @('ThemeToggle', 'localStorage', 'mds-theme-mode')) {
        if (-not (Select-String -Path $shell -Pattern ([regex]::Escape($needle)))) {
            throw "MarketDeskShell.tsx missing persistent theme toggle marker: $needle"
        }
    }
}

# 23. Morning Brief freshness: freshest successful provider wins everywhere.
Step "Morning Brief freshest provider selection wired" {
    $selector = Join-Path $app "src/lib/brief/provider-selection.ts"
    $selectorTest = Join-Path $app "src/lib/__tests__/brief-provider-selection.test.ts"
    foreach ($f in @($selector, $selectorTest)) {
        if (-not (Test-Path -LiteralPath $f)) { throw ("Missing: " + $f) }
    }
    foreach ($p in @('selectFreshestBriefProvider', 'selectBriefProvider', 'normalizeBriefProvider')) {
        if (-not (Select-String -Path $selector -Pattern ([regex]::Escape($p)))) {
            throw "provider-selection.ts missing export: $p"
        }
    }
    foreach ($f in @(
        (Join-Path $app "src/components/market-desk/MorningBriefHero.tsx"),
        (Join-Path $app "src/components/market-desk/SpotlightAndIdeas.tsx"),
        (Join-Path $app "src/components/market-desk/TvScreenerHits.tsx")
    )) {
        if (-not (Select-String -Path $f -Pattern 'selectFreshestBriefProvider|selectBriefProvider|selectFreshestBriefWithContent')) {
            throw "$f is not using shared brief provider selection"
        }
    }
    $ingest = Join-Path $app "src/app/api/morning-verdict/ingest/route.ts"
    if (-not (Select-String -Path $ingest -Pattern 'normalizeBriefProvider')) {
        throw "morning-verdict ingest must normalize provider aliases"
    }
}

# 24. Cross-platform app build wrapper exists.
Step "Next build script is cross-platform" {
    $build = Join-Path $app "scripts/build.mjs"
    if (-not (Test-Path -LiteralPath $build)) { throw "Missing scripts/build.mjs" }
    $pkg = Join-Path $app "package.json"
    if (-not (Select-String -Path $pkg -Pattern '"build": "node scripts/build.mjs"')) {
        throw "package.json build script must call node scripts/build.mjs"
    }
}

# 20. Feature 4 Multi-Agent Analysis (pipeline + moderator + route + UI)
Step "Multi-Agent Analysis wired (Feature 4)" {
    $files = @(
        (Join-Path $app "src/lib/analysis/agents.ts"),
        (Join-Path $app "src/lib/__tests__/moderator.test.ts"),
        (Join-Path $app "src/app/api/analysis/multi-agent/route.ts"),
        (Join-Path $app "src/components/analysis/MultiAgentAnalysisCard.tsx"),
        (Join-Path $app "src/components/analysis/MultiAgentRunner.tsx"),
        (Join-Path $app "src/app/dashboard/analysis/page.tsx")
    )
    foreach ($f in $files) {
        if (-not (Test-Path -LiteralPath $f)) { throw ("Missing: " + $f) }
    }
    $lib = Join-Path $app "src/lib/analysis/agents.ts"
    foreach ($p in @('runDataAgent', 'runRiskAgent', 'runModerator', 'AGENT_WEIGHTS')) {
        if (-not (Select-String -Path $lib -Pattern ([regex]::Escape($p)))) {
            throw "agents.ts missing export: $p"
        }
    }
    $shell = Join-Path $app "src/components/market-desk/MarketDeskShell.tsx"
    if (-not (Select-String -Path $shell -Pattern '/dashboard/analysis')) {
        throw "MarketDeskShell.tsx does not link /dashboard/analysis"
    }
}

# 19. Feature 7.2 Image attachments via Vercel Blob (handleUpload + UI + sanitiser)
Step "Image attachments via Vercel Blob (Feature 7.2)" {
    $pkg = Join-Path $app "package.json"
    if (-not (Select-String -Path $pkg -Pattern '"@vercel/blob"')) {
        throw "package.json missing @vercel/blob dependency"
    }
    $files = @(
        (Join-Path $app "src/lib/journal/attachments.ts"),
        (Join-Path $app "src/lib/__tests__/attachments.test.ts"),
        (Join-Path $app "src/app/api/journal/entry/attachments/route.ts")
    )
    foreach ($f in $files) {
        if (-not (Test-Path -LiteralPath $f)) { throw ("Missing: " + $f) }
    }
    $route = Join-Path $app "src/app/api/journal/entry/attachments/route.ts"
    foreach ($p in @('handleUpload', 'BLOB_READ_WRITE_TOKEN', 'allowedContentTypes')) {
        if (-not (Select-String -Path $route -Pattern ([regex]::Escape($p)))) {
            throw "attachments/route.ts missing: $p"
        }
    }
    $entry = Join-Path $app "src/app/api/journal/entry/route.ts"
    if (-not (Select-String -Path $entry -Pattern 'sanitiseAttachmentUrls')) {
        throw "/api/journal/entry does not validate attachmentUrls"
    }
    $daily = Join-Path $app "src/components/journal/DailyJournal.tsx"
    foreach ($p in @('@vercel/blob/client', 'uploadAttachment', 'MAX_ATTACHMENTS_PER_ENTRY')) {
        if (-not (Select-String -Path $daily -Pattern ([regex]::Escape($p)))) {
            throw "DailyJournal.tsx missing: $p"
        }
    }
}

# 18. Feature 5+8 Profile + Leaderboard wired (Prisma + API + UI + middleware + tests)
Step "Profile + Leaderboard wired (Features 5 + 8)" {
    $schema = Join-Path $app "prisma/schema.prisma"
    foreach ($field in @('username\s+String\?\s+@unique', 'bio\s+String\?', 'dashboardTagline\s+String\?', 'publicProfileEnabled\s+Boolean')) {
        if (-not (Select-String -Path $schema -Pattern $field)) {
            throw "prisma/schema.prisma missing field matching $field"
        }
    }
    $migration = Join-Path $app "prisma/migrations/20260520180000_add_profile_fields/migration.sql"
    if (-not (Test-Path $migration)) { throw ("Missing migration: " + $migration) }
    $files = @(
        (Join-Path $app "src/lib/profile/tiers.ts"),
        (Join-Path $app "src/lib/profile/composite.ts"),
        (Join-Path $app "src/lib/__tests__/tiers.test.ts"),
        (Join-Path $app "src/lib/__tests__/composite.test.ts"),
        (Join-Path $app "src/app/api/user/profile/route.ts"),
        (Join-Path $app "src/app/api/leaderboard/route.ts"),
        (Join-Path $app "src/components/profile/ProfileEditForm.tsx"),
        (Join-Path $app "src/components/profile/LeaderboardTable.tsx"),
        (Join-Path $app "src/app/dashboard/profile/page.tsx"),
        (Join-Path $app "src/app/dashboard/leaderboard/page.tsx"),
        (Join-Path $app "src/app/profile/[username]/page.tsx")
    )
    foreach ($f in $files) {
        # -LiteralPath so the [username] dynamic segment isn't treated as a glob.
        if (-not (Test-Path -LiteralPath $f)) { throw ("Missing: " + $f) }
    }
    $mw = Join-Path $app "src/middleware.ts"
    if (-not (Select-String -Path $mw -Pattern '/profile/')) {
        throw "middleware.ts does not allow-list /profile/ public pages"
    }
    $shell = Join-Path $app "src/components/market-desk/MarketDeskShell.tsx"
    foreach ($nav in @('/dashboard/leaderboard', '/dashboard/profile')) {
        if (-not (Select-String -Path $shell -Pattern $nav)) {
            throw "MarketDeskShell.tsx missing nav entry: $nav"
        }
    }
}

# 17. Feature 7.1 Daily Journal Entry wired (Prisma + API + UI + tests)
Step "Daily Journal Entry wired (Feature 7.1)" {
    $schema = Join-Path $app "prisma/schema.prisma"
    if (-not (Select-String -Path $schema -Pattern '^model JournalEntry')) {
        throw "prisma/schema.prisma missing JournalEntry model"
    }
    $migration = Join-Path $app "prisma/migrations/20260520120000_add_journal_entries/migration.sql"
    if (-not (Test-Path $migration)) { throw ("Missing migration: " + $migration) }
    $files = @(
        (Join-Path $app "src/lib/journal/mood.ts"),
        (Join-Path $app "src/components/journal/MoodEmojiPicker.tsx"),
        (Join-Path $app "src/components/journal/DailyJournal.tsx"),
        (Join-Path $app "src/app/api/journal/entry/route.ts"),
        (Join-Path $app "src/lib/__tests__/mood.test.ts")
    )
    foreach ($f in $files) {
        if (-not (Test-Path $f)) { throw ("Missing: " + $f) }
    }
    $shell = Join-Path $app "src/components/journal/JournalShell.tsx"
    if (-not (Select-String -Path $shell -Pattern "DailyJournal")) {
        throw "JournalShell.tsx does not render DailyJournal"
    }
    if (-not (Select-String -Path $shell -Pattern "id: `"daily`"")) {
        throw "JournalShell.tsx missing 'daily' sub-tab"
    }
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
    $rd = Join-Path $repo ".github/workflows/refresh_premarket.yml"
    $ri = Join-Path $repo ".github/workflows/refresh_data_intraday.yml"
    if (-not (Test-Path $rd)) { throw "refresh_premarket.yml is missing" }
    if (-not (Test-Path $ri)) { throw "refresh_data_intraday.yml is missing" }
    # Daily pre-market must invoke market data, screeners, and morning brief.
    $dailyLines = Get-Content $rd | Where-Object { $_ -notmatch '^\s*#' }
    $dailyContent = $dailyLines -join "`n"
    foreach ($script in @('build_data.py','tv_screener_fetch.py','morning_brief.py')) {
        if ($dailyContent -notmatch "python\s+scripts/$([regex]::Escape($script))") {
            throw "daily refresh_premarket.yml missing invocation of $script"
        }
    }
    foreach ($script in @('breadth_scan.py','trader_verdict.py')) {
        if ($dailyContent -match "python\s+scripts/$([regex]::Escape($script))") {
            throw "refresh_premarket.yml should not invoke retired heavy script $script"
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
