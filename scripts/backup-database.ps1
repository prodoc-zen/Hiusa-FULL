<#
.SYNOPSIS
    Takes a timestamped mysqldump backup of the HIUSA database.

.DESCRIPTION
    Read-only against the source database (mysqldump does not modify the
    database it reads). No password is ever hardcoded here - supply one with
    -Password, the HIUSA_DB_PASSWORD environment variable, or a blank
    password by omitting both (some local dev installs have none).

    See docs/OPERATIONS.md for the full backup/restore procedure, including
    how to verify a dump is actually restorable rather than merely present.

.PARAMETER DbHost
    Database host. Defaults to 127.0.0.1.

.PARAMETER Port
    Database port. Defaults to 3307 (this project's XAMPP MariaDB dev port -
    see server/.env.example for why 3306 is not assumed).

.PARAMETER User
    Database user. Defaults to root.

.PARAMETER Database
    Database name. Defaults to hiusa_db.

.PARAMETER Password
    Database password as a SecureString. Prompted with -AsSecureString if
    neither this nor HIUSA_DB_PASSWORD is supplied and the session is
    interactive; pass an empty SecureString (press Enter at the prompt) for
    a blank password.

.PARAMETER OutputDir
    Directory the timestamped .sql file is written into. Defaults to
    <project root>\backups. Created if it does not exist.

.PARAMETER Force
    Overwrite an existing backup file at the computed output path. Without
    it, the script refuses to clobber a same-second backup that already
    exists rather than silently overwriting it.

.EXAMPLE
    .\scripts\backup-database.ps1
    Backs up hiusa_db from 127.0.0.1:3307 as root, prompting for the password.

.EXAMPLE
    $env:HIUSA_DB_PASSWORD = 'root'
    .\scripts\backup-database.ps1 -OutputDir C:\backups\hiusa
#>
[CmdletBinding()]
param(
    [string] $DbHost = '127.0.0.1',
    [int] $Port = 3307,
    [string] $User = 'root',
    [string] $Database = 'hiusa_db',
    [System.Security.SecureString] $Password,
    [string] $OutputDir,
    [switch] $Force
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

if (-not $OutputDir) {
    $OutputDir = Join-Path $projectRoot 'backups'
}

function Resolve-MysqldumpPath {
    $command = Get-Command mysqldump -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $candidates = @(
        'C:\xampp\mysql\bin\mysqldump.exe',
        'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe',
        'C:\Program Files\MariaDB 11.0\bin\mysqldump.exe'
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    throw 'mysqldump was not found on PATH or in common XAMPP/MySQL/MariaDB install locations. Add it to PATH or edit the $candidates list in this script.'
}

function Get-PlainPassword {
    param([System.Security.SecureString] $SecurePassword)

    if (-not $SecurePassword) {
        return ''
    }

    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePassword)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

if (-not $Password) {
    if ($env:HIUSA_DB_PASSWORD) {
        $Password = ConvertTo-SecureString -String $env:HIUSA_DB_PASSWORD -AsPlainText -Force
    } elseif ([Environment]::UserInteractive) {
        $Password = Read-Host "Password for ${User}@${DbHost}:${Port} (blank if none)" -AsSecureString
    }
}

$mysqldumpPath = Resolve-MysqldumpPath

if (-not (Test-Path -LiteralPath $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

$timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$outputFile = Join-Path $OutputDir "${Database}_backup_${timestamp}.sql"

if ((Test-Path -LiteralPath $outputFile) -and -not $Force) {
    throw "Refusing to overwrite existing backup file: $outputFile (rerun with -Force if this is intentional)."
}

$plainPassword = Get-PlainPassword $Password

$mysqldumpArgs = @(
    "--host=$DbHost",
    "--port=$Port",
    "--user=$User",
    '--single-transaction',
    '--quick',
    '--routines',
    '--triggers',
    '--result-file', $outputFile,
    $Database
)

Write-Host "Backing up $Database from ${DbHost}:${Port} as $User ..."

# Passed via environment (MYSQL_PWD) rather than a command-line argument so
# the password never appears in process listings or shell history.
$previousMysqlPwd = $env:MYSQL_PWD
try {
    $env:MYSQL_PWD = $plainPassword
    & $mysqldumpPath @mysqldumpArgs
    $exitCode = $LASTEXITCODE
} finally {
    $env:MYSQL_PWD = $previousMysqlPwd
    $plainPassword = $null
}

if ($exitCode -ne 0) {
    if (Test-Path -LiteralPath $outputFile) {
        Remove-Item -LiteralPath $outputFile -Force
    }
    throw "mysqldump exited with code $exitCode. No backup was kept."
}

$fileInfo = Get-Item -LiteralPath $outputFile
if ($fileInfo.Length -eq 0) {
    Remove-Item -LiteralPath $outputFile -Force
    throw 'mysqldump produced an empty file. No backup was kept.'
}

Write-Host "Backup written: $outputFile ($([math]::Round($fileInfo.Length / 1KB, 1)) KB)"
Write-Host 'Verify it is restorable before trusting it - see docs/OPERATIONS.md.'
