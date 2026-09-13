$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$healthUrl = 'http://127.0.0.1:9100/health'

try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    if ($health.status -eq 'ok' -and $health.service -eq 'hiusa-sourceafis-matcher') {
        Write-Host "Fingerprint matcher is already running at $healthUrl." -ForegroundColor Green
        return
    }
} catch {
    # No healthy matcher is listening, so continue with normal startup.
}

if (-not (Test-Path '.env')) {
    throw 'Missing .env. Copy .env.example to .env and configure MATCHER_API_KEY first.'
}

Get-Content -LiteralPath '.env' | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) { return }
    $separator = $line.IndexOf('=')
    if ($separator -lt 1) { return }
    [Environment]::SetEnvironmentVariable($line.Substring(0, $separator).Trim(), $line.Substring($separator + 1).Trim(), 'Process')
}

if (-not $env:MATCHER_API_KEY -or $env:MATCHER_API_KEY.StartsWith('replace-')) {
    throw 'Set a real MATCHER_API_KEY before starting the matcher.'
}

dotnet run --configuration Release --no-launch-profile
