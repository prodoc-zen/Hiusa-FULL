[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z0-9.-]+$')]
    [string] $HostAddress = 'localhost',

    [switch] $Force,

    [switch] $PromptForGroqKey
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

function Copy-EnvironmentTemplate {
    param(
        [Parameter(Mandatory)] [string] $ExamplePath,
        [Parameter(Mandatory)] [string] $TargetPath
    )

    if ((Test-Path -LiteralPath $TargetPath) -and -not $Force) {
        Write-Host "Preserved existing $TargetPath"
        return $false
    }

    Copy-Item -LiteralPath $ExamplePath -Destination $TargetPath -Force
    Write-Host "Created $TargetPath"
    return $true
}

function Get-EnvironmentValue {
    param(
        [Parameter(Mandatory)] [string] $Path,
        [Parameter(Mandatory)] [string] $Name
    )

    $line = Get-Content -LiteralPath $Path | Where-Object { $_ -like "$Name=*" } | Select-Object -First 1
    if ($null -eq $line) {
        return ''
    }

    return $line.Substring($Name.Length + 1)
}

function Set-EnvironmentValue {
    param(
        [Parameter(Mandatory)] [string] $Path,
        [Parameter(Mandatory)] [string] $Name,
        [Parameter(Mandatory)] [AllowEmptyString()] [string] $Value
    )

    $found = $false
    $updatedLines = foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -like "$Name=*") {
            $found = $true
            "$Name=$Value"
        } else {
            $line
        }
    }

    if (-not $found) {
        $updatedLines += "$Name=$Value"
    }

    Set-Content -LiteralPath $Path -Value $updatedLines -Encoding utf8
}

function New-SharedServiceKey {
    $bytes = New-Object byte[] 32
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    } finally {
        $generator.Dispose()
    }

    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

$serverExample = Join-Path $projectRoot 'server\.env.example'
$serverEnvironment = Join-Path $projectRoot 'server\.env'
$clientExample = Join-Path $projectRoot 'client\.env.example'
$clientEnvironment = Join-Path $projectRoot 'client\.env'
$aiExample = Join-Path $projectRoot 'ai-service\.env.example'
$aiEnvironment = Join-Path $projectRoot 'ai-service\.env'

$serverCreated = Copy-EnvironmentTemplate $serverExample $serverEnvironment
$null = Copy-EnvironmentTemplate $clientExample $clientEnvironment
$null = Copy-EnvironmentTemplate $aiExample $aiEnvironment

$serverSharedKey = Get-EnvironmentValue $serverEnvironment 'HIUSA_AI_SERVICE_KEY'
$aiSharedKey = Get-EnvironmentValue $aiEnvironment 'HIUSA_AI_SERVICE_KEY'
$serverHasRealKey = $serverSharedKey -ne '' -and -not $serverSharedKey.StartsWith('CHANGE_ME_')
$aiHasRealKey = $aiSharedKey -ne '' -and -not $aiSharedKey.StartsWith('CHANGE_ME_')

if ($serverHasRealKey -and $aiHasRealKey -and $serverSharedKey -ne $aiSharedKey) {
    throw 'Existing server and Python HIUSA_AI_SERVICE_KEY values do not match. Resolve them manually or rerun with -Force.'
}

$sharedKey = if ($serverHasRealKey) {
    $serverSharedKey
} elseif ($aiHasRealKey) {
    $aiSharedKey
} else {
    New-SharedServiceKey
}

Set-EnvironmentValue $serverEnvironment 'HIUSA_AI_SERVICE_KEY' $sharedKey
Set-EnvironmentValue $aiEnvironment 'HIUSA_AI_SERVICE_KEY' $sharedKey

Set-EnvironmentValue $serverEnvironment 'APP_URL' "http://${HostAddress}:8000"
Set-EnvironmentValue $serverEnvironment 'FRONTEND_URL' "http://${HostAddress}:5173"
Set-EnvironmentValue $serverEnvironment 'FRONTEND_URLS' "http://localhost:5173,http://127.0.0.1:5173,http://${HostAddress}:5173,http://localhost:5174,http://127.0.0.1:5174,http://${HostAddress}:5174"
Set-EnvironmentValue $clientEnvironment 'VITE_API_URL' "http://${HostAddress}:8000/api"

if ($PromptForGroqKey) {
    $secureGroqKey = Read-Host 'Enter the Groq API key (input is hidden)' -AsSecureString
    $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureGroqKey)
    try {
        $plainGroqKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
        if ([string]::IsNullOrWhiteSpace($plainGroqKey)) {
            throw 'The Groq API key cannot be blank.'
        }
        Set-EnvironmentValue $serverEnvironment 'GROQ_API_KEY' $plainGroqKey
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
        $plainGroqKey = $null
    }
}

$artisanPath = Join-Path $projectRoot 'server\artisan'
$vendorAutoload = Join-Path $projectRoot 'server\vendor\autoload.php'
$phpCommand = Get-Command php -ErrorAction SilentlyContinue

if (($serverCreated -or (Get-EnvironmentValue $serverEnvironment 'APP_KEY') -eq '') -and $phpCommand -and (Test-Path -LiteralPath $vendorAutoload)) {
    Push-Location (Split-Path -Parent $artisanPath)
    try {
        & php artisan key:generate --force
        & php artisan config:clear
    } finally {
        Pop-Location
    }
} elseif ((Get-EnvironmentValue $serverEnvironment 'APP_KEY') -eq '') {
    Write-Warning 'PHP dependencies are not ready. After composer install, run: cd server; php artisan key:generate; php artisan config:clear'
}

Write-Host ''
Write-Host 'Environment preparation complete.'
Write-Host "Host address: $HostAddress"
Write-Host 'The Laravel/Python service keys were generated and synchronized without printing them.'
if (-not $PromptForGroqKey -and (Get-EnvironmentValue $serverEnvironment 'GROQ_API_KEY') -eq '') {
    Write-Host 'Next: add GROQ_API_KEY to server/.env or rerun with -PromptForGroqKey.'
}
Write-Host 'Configure your database credentials before running migrations.'
