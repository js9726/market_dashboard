[CmdletBinding()]
param(
    [string]$SecretRoot = (Join-Path $env:LOCALAPPDATA "Jie\secrets"),
    [Parameter(Mandatory = $true)]
    [string]$ExpectedOwnerChatId,
    [string]$ExpectedBotUsername = "JsTradingDeskBot",
    [switch]$PrepareOnly
)

$ErrorActionPreference = "Stop"

$ownerSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$systemSid = [System.Security.Principal.SecurityIdentifier]::new(
    [System.Security.Principal.WellKnownSidType]::LocalSystemSid,
    $null
)
$bundlePath = Join-Path $SecretRoot "trading-telegram"
$tokenPath = Join-Path $bundlePath "bot-token.dpapi"
$ingestKeyPath = Join-Path $bundlePath "screener-ingest-key.dpapi"
$configPath = Join-Path $bundlePath "config.json"
$receiptPath = Join-Path $bundlePath "provisioning-receipt.json"

function Set-PrivateDirectoryAcl {
    param([Parameter(Mandatory = $true)][string]$Path)

    & icacls.exe $Path /inheritance:r | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not disable ACL inheritance for $Path"
    }
    & icacls.exe $Path /grant:r `
        ("*{0}:(OI)(CI)F" -f $script:ownerSid.Value) `
        ("*{0}:(OI)(CI)F" -f $script:systemSid.Value) | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not apply the private directory ACL for $Path"
    }
}

function Set-PrivateFileAcl {
    param([Parameter(Mandatory = $true)][string]$Path)

    & icacls.exe $Path /inheritance:r | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not disable ACL inheritance for $Path"
    }
    & icacls.exe $Path /grant:r `
        ("*{0}:F" -f $script:ownerSid.Value) `
        ("*{0}:F" -f $script:systemSid.Value) | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not apply the private file ACL for $Path"
    }
}

function Assert-PrivateAcl {
    param([Parameter(Mandatory = $true)][string]$Path)

    $acl = Get-Acl -LiteralPath $Path
    if (-not $acl.AreAccessRulesProtected) {
        throw "ACL inheritance is still enabled for $Path"
    }

    $allowedSids = @($script:ownerSid.Value, $script:systemSid.Value)
    foreach ($rule in $acl.Access) {
        if ($rule.AccessControlType -ne "Allow") {
            continue
        }
        $sid = $rule.IdentityReference.Translate(
            [System.Security.Principal.SecurityIdentifier]
        ).Value
        if ($sid -notin $allowedSids) {
            throw "Unexpected ACL principal on $Path"
        }
    }
}

function Write-PrivateText {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Value
    )

    [System.IO.File]::WriteAllText(
        $Path,
        $Value,
        [System.Text.UTF8Encoding]::new($false)
    )
    Set-PrivateFileAcl -Path $Path
    Assert-PrivateAcl -Path $Path
}

function Convert-SecureStringToPlainText {
    param([Parameter(Mandatory = $true)][SecureString]$Value)

    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function New-RandomSecureString {
    $bytes = [byte[]]::new(48)
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
        $plain = [Convert]::ToBase64String($bytes)
        return ConvertTo-SecureString -String $plain -AsPlainText -Force
    }
    finally {
        [Array]::Clear($bytes, 0, $bytes.Length)
        if ($null -ne $plain) {
            $plain = $null
        }
        $generator.Dispose()
    }
}

New-Item -ItemType Directory -Path $SecretRoot -Force | Out-Null
Set-PrivateDirectoryAcl -Path $SecretRoot
Assert-PrivateAcl -Path $SecretRoot
New-Item -ItemType Directory -Path $bundlePath -Force | Out-Null
Set-PrivateDirectoryAcl -Path $bundlePath
Assert-PrivateAcl -Path $bundlePath

if ($PrepareOnly) {
    Write-Host "Prepared ACL-locked secret bundle: $bundlePath"
    exit 0
}

$plainToken = $null
try {
    Write-Host ""
    Write-Host "The token will be hidden while you type or paste it." -ForegroundColor Cyan
    $secureToken = Read-Host "Paste the NEW JsTradingDeskBot token" -AsSecureString
    $plainToken = Convert-SecureStringToPlainText -Value $secureToken
    if ([string]::IsNullOrWhiteSpace($plainToken)) {
        throw "No token was entered."
    }

    try {
        $me = Invoke-RestMethod -Method Get -Uri (
            "https://api.telegram.org/bot{0}/getMe" -f $plainToken
        )
    }
    catch {
        throw "Telegram rejected the replacement token."
    }
    if (-not $me.ok -or $me.result.username -ne $ExpectedBotUsername) {
        throw "The token does not belong to @$ExpectedBotUsername."
    }

    Write-PrivateText -Path $tokenPath -Value (
        ConvertFrom-SecureString -SecureString $secureToken
    )

    if (-not (Test-Path -LiteralPath $ingestKeyPath)) {
        $secureIngestKey = New-RandomSecureString
        Write-PrivateText -Path $ingestKeyPath -Value (
            ConvertFrom-SecureString -SecureString $secureIngestKey
        )
    }

    Write-Host ""
    Write-Host "Token verified for @$ExpectedBotUsername." -ForegroundColor Green
    Write-Host "Now send /start to @$ExpectedBotUsername in Telegram."
    [void](Read-Host "After sending /start, press Enter here")

    try {
        $updates = Invoke-RestMethod -Method Get -Uri (
            "https://api.telegram.org/bot{0}/getUpdates?allowed_updates=%5B%22message%22%5D" -f
            $plainToken
        )
    }
    catch {
        throw "Telegram updates could not be read. Confirm the bot has no webhook yet."
    }

    $ownerStart = @(
        $updates.result |
            Where-Object {
                $_.message -and
                [string]$_.message.chat.type -eq "private" -and
                [string]$_.message.chat.id -eq [string]$ExpectedOwnerChatId -and
                [string]$_.message.from.id -eq [string]$ExpectedOwnerChatId -and
                [string]$_.message.text -match "^/start(?:@\w+)?(?:\s|$)"
            } |
            Sort-Object -Property update_id -Descending
    )
    if ($ownerStart.Count -eq 0) {
        throw "No /start message from the expected owner account was found."
    }

    $config = [ordered]@{
        schemaVersion = 1
        botUsername = [string]$me.result.username
        botId = [string]$me.result.id
        ownerChatId = [string]$ExpectedOwnerChatId
        encryption = "Windows DPAPI CurrentUser"
        provisionedAt = [DateTimeOffset]::Now.ToString("o")
    }
    Write-PrivateText -Path $configPath -Value (
        $config | ConvertTo-Json -Depth 4
    )

    $receipt = [ordered]@{
        ok = $true
        botUsername = [string]$me.result.username
        ownerStartVerified = $true
        tokenStoredAs = "DPAPI ciphertext"
        aclPrincipals = @("current Windows user", "SYSTEM")
        createdAt = [DateTimeOffset]::Now.ToString("o")
    }
    Write-PrivateText -Path $receiptPath -Value (
        $receipt | ConvertTo-Json -Depth 4
    )

    Write-Host ""
    Write-Host "Provisioning complete." -ForegroundColor Green
    Write-Host "Secret bundle: $bundlePath"
    Write-Host "The token was not stored as plaintext."
}
catch {
    Write-Host ""
    Write-Host ("Provisioning failed: {0}" -f $_.Exception.Message) -ForegroundColor Red
    exit 1
}
finally {
    $plainToken = $null
    $secureToken = $null
    $secureIngestKey = $null
}
