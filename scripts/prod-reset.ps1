<#
.SYNOPSIS
    Local test run of the production reset (scripts/prod-reset-seed.php) against XAMPP MariaDB on port 3307.

.DESCRIPTION
    Mirrors steps 4 to 7 of scripts/prod-reset.sh without the server parts (marker, backup, systemd).
    It saves the SAO hash and email to a temp file, runs migrate:fresh (plus --seed for seeded mode)
    with APP_ENV=staging, then runs the PHP body through tinker. It never prints the hash.

    Point -ServerDir at a checkout whose server/.env uses mysql 127.0.0.1:3307 and a COPY database
    (for example hiusa_prodcopy). Never aim it at 3306 or at hiusa_db. Take a mysqldump first.

.EXAMPLE
    .\scripts\prod-reset.ps1 -Mode first-time -ServerDir D:\Claude\worktrees\hiusa-r27f\server
    .\scripts\prod-reset.ps1 -Mode seeded     -ServerDir D:\Claude\worktrees\hiusa-r27f\server
#>
param(
    [Parameter(Mandatory)][ValidateSet('first-time', 'seeded')][string]$Mode,
    [Parameter(Mandatory)][string]$ServerDir,
    [string]$Database = 'hiusa_prodcopy',
    [string]$MysqlBin = 'C:\xampp\mysql\bin'
)
$ErrorActionPreference = 'Stop'
if ($Database -eq 'hiusa_db') { throw 'Refusing hiusa_db; use a copy database.' }
$envFile = Join-Path $ServerDir '.env'
$envText = Get-Content $envFile -Raw
if ($envText -notmatch '(?m)^DB_PORT=3307\s*$' -or $envText -notmatch "(?m)^DB_DATABASE=$Database\s*$") { throw "server/.env must point at 3307 and $Database." }

$mysql = Join-Path $MysqlBin 'mysql.exe'
$hashFile = Join-Path $env:TEMP "hiusa-sao-hash-$([guid]::NewGuid().ToString('N')).txt"
try {
    $rows = & $mysql --user=root --password=root --port=3307 --host=127.0.0.1 -N -B -e "select password_hash from $Database.users where school_id=990001; select email from $Database.users where school_id=990001"
    if (@($rows).Count -ne 2) { throw 'SAO 990001 not found; nothing wiped.' }
    [IO.File]::WriteAllText($hashFile, ((@($rows) -join "`n") + "`n"))
    Write-Host "saved SAO hash (length $(@($rows)[0].Length))"

    $counts = & $mysql --user=root --password=root --port=3307 --host=127.0.0.1 -N -B -e "select count(*) from $Database.users; select count(*) from $Database.elections"
    Write-Host "before the wipe: users=$($counts[0]) elections=$($counts[1])"

    Push-Location $ServerDir
    $env:APP_ENV = 'staging'; $env:APP_DEBUG = 'false'
    $env:HIUSA_RESET_MODE = $Mode; $env:HIUSA_RESET_HASH_FILE = $hashFile
    if ($Mode -eq 'seeded') { php artisan migrate:fresh --seed --force } else { php artisan migrate:fresh --force }
    if ($LASTEXITCODE -ne 0) { throw 'migrate:fresh failed' }
    $seed = (Resolve-Path (Join-Path $PSScriptRoot 'prod-reset-seed.php')).Path -replace '\\', '/'
    $out = php artisan tinker --execute="require '$seed';" 2>&1 | Out-String
    $verify = ($out -split "`r?`n") | Where-Object { $_ -like 'VERIFY *' }
    if (-not $verify) { Write-Host ($out -replace '\$2[aby]\$\S+', '[hash]'); throw 'no VERIFY line' }
    Write-Host $verify
}
finally {
    Pop-Location -ErrorAction SilentlyContinue
    Remove-Item $hashFile -Force -ErrorAction SilentlyContinue
    Remove-Item Env:HIUSA_RESET_MODE, Env:HIUSA_RESET_HASH_FILE, Env:APP_ENV, Env:APP_DEBUG -ErrorAction SilentlyContinue
}
