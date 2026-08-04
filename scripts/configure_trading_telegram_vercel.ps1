[CmdletBinding()]
param(
    [string]$BundlePath = (
        Join-Path $env:LOCALAPPDATA "Jie\secrets\trading-telegram"
    ),
    [string]$AppDirectory
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($AppDirectory)) {
    $AppDirectory = Join-Path $PSScriptRoot "..\apps\market_dashboard"
}

$tokenPath = Join-Path $BundlePath "bot-token.dpapi"
$ingestKeyPath = Join-Path $BundlePath "screener-ingest-key.dpapi"
$configPath = Join-Path $BundlePath "config.json"
$receiptPath = Join-Path $BundlePath "vercel-provisioning-receipt.json"

function Assert-ProtectedPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Required protected file is missing: $Path"
    }
    $acl = Get-Acl -LiteralPath $Path
    if (-not $acl.AreAccessRulesProtected) {
        throw "ACL inheritance is enabled for protected file: $Path"
    }
}

function Read-DpapiSecret {
    param([Parameter(Mandatory = $true)][string]$Path)

    Assert-ProtectedPath -Path $Path
    $secure = ConvertTo-SecureString (
        Get-Content -LiteralPath $Path -Raw
    )
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function Set-VercelSensitiveEnvironmentVariable {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Value
    )

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = "cmd.exe"
    $startInfo.Arguments = (
        '/d /s /c "npx.cmd vercel env add {0} production --force --sensitive --yes"' -f
        $Name
    )
    $startInfo.WorkingDirectory = (
        Resolve-Path -LiteralPath $script:AppDirectory
    ).Path
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true

    $process = [System.Diagnostics.Process]::Start($startInfo)
    try {
        $process.StandardInput.Write($Value)
        $process.StandardInput.Close()
        $process.WaitForExit()
        if ($process.ExitCode -ne 0) {
            throw "Vercel rejected $Name with exit code $($process.ExitCode)."
        }
    }
    finally {
        $process.Dispose()
    }
}

Assert-ProtectedPath -Path $configPath
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if ($config.botUsername -ne "JsTradingDeskBot") {
    throw "Protected bundle does not belong to JsTradingDeskBot."
}
if ([string]$config.ownerChatId -notmatch "^-?\d+$") {
    throw "Protected bundle has an invalid owner chat ID."
}

$botToken = $null
$ingestKey = $null
try {
    $botToken = Read-DpapiSecret -Path $tokenPath
    $ingestKey = Read-DpapiSecret -Path $ingestKeyPath

    Set-VercelSensitiveEnvironmentVariable `
        -Name "TELEGRAM_GO_BOT_TOKEN" `
        -Value $botToken
    Set-VercelSensitiveEnvironmentVariable `
        -Name "TELEGRAM_GO_CHAT_ID" `
        -Value ([string]$config.ownerChatId)
    Set-VercelSensitiveEnvironmentVariable `
        -Name "SCREENER_INGEST_KEY" `
        -Value $ingestKey
}
finally {
    $botToken = $null
    $ingestKey = $null
}

$receipt = [ordered]@{
    ok = $true
    project = "market-dashboard"
    environment = "production"
    configuredNames = @(
        "TELEGRAM_GO_BOT_TOKEN"
        "TELEGRAM_GO_CHAT_ID"
        "SCREENER_INGEST_KEY"
    )
    configuredAt = [DateTimeOffset]::Now.ToString("o")
}
$receiptJson = $receipt | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText(
    $receiptPath,
    $receiptJson,
    [System.Text.UTF8Encoding]::new($false)
)

$sourceAcl = Get-Acl -LiteralPath $configPath
Set-Acl -LiteralPath $receiptPath -AclObject $sourceAcl

Write-Host "Configured encrypted Market Dashboard production variables."
Write-Host "No secret value was printed or written to the repository."
