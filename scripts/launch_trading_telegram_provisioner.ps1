[CmdletBinding()]
param([switch]$PrepareOnly)

$ErrorActionPreference = "Stop"

$macroSnapRoot = Join-Path (
    Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
) "macrosnap"
$candidateEnvFiles = @(
    (Join-Path $macroSnapRoot ".env.local")
    (Join-Path $macroSnapRoot ".env")
)

$ownerChatId = $null
foreach ($envFile in $candidateEnvFiles) {
    if (-not (Test-Path -LiteralPath $envFile)) {
        continue
    }
    $line = Get-Content -LiteralPath $envFile |
        Where-Object {
            $_ -match "^\s*TELEGRAM_ALLOWED_CHAT_ID\s*="
        } |
        Select-Object -First 1
    if ($line) {
        $ownerChatId = (($line -split "=", 2)[1].Trim()).Trim('"').Trim("'")
        break
    }
}

if ([string]::IsNullOrWhiteSpace($ownerChatId)) {
    throw "The existing MacroSnap owner Telegram ID could not be found."
}

$provisioner = Join-Path $PSScriptRoot "provision_trading_telegram_secrets.ps1"
if ($PrepareOnly) {
    & $provisioner `
        -ExpectedOwnerChatId $ownerChatId `
        -ExpectedBotUsername "JsTradingDeskBot" `
        -PrepareOnly
}
else {
    & $provisioner `
        -ExpectedOwnerChatId $ownerChatId `
        -ExpectedBotUsername "JsTradingDeskBot"
}
exit $LASTEXITCODE
