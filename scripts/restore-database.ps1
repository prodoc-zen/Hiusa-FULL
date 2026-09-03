<#
.SYNOPSIS
    Restores a HIUSA mysqldump backup into a target database.

.DESCRIPTION
    THIS OVERWRITES THE TARGET DATABASE. Every table the dump file creates
    replaces whatever is currently in -Database with the same name. There is
    no undo except restoring a different, earlier backup. Nothing runs
    without passing -Force.

    No password is ever hardcoded here - supply one with -Password, the
    HIUSA_DB_PASSWORD environment variable, or a blank password by omitting
    both.

    See docs/OPERATIONS.md for the full backup/restore procedure and the
    rule that a verified backup is taken before every production migration.

.PARAMETER DbHost
    Database host. Defaults to 127.0.0.1.

.PARAMETER Port
    Database port. Defaults to 3307 (this project's XAMPP MariaDB dev port).

.PARAMETER User
    Database user. Defaults to root.

.PARAMETER Database
    Database name to restore INTO. Defaults to hiusa_db. Everything in this
    database that collides with the dump's tables is overwritten.

.PARAMETER BackupFile
    Path to the .sql dump produced by backup-database.ps1 (or any plain
    mysqldump output). Mandatory.

.PARAMETER Password
    Database password as a SecureString. Prompted if neither this nor
    HIUSA_DB_PASSWORD is supplied and the session is interactive.

.PARAMETER Force
    Required to actually run the restore. Without it, the script prints
    what it would do and exits without touching the database.

.EXAMPLE
    .\scripts\restore-database.ps1 -BackupFile .\backups\hiusa_db_backup_20260828_101500.sql -Force
#>
[CmdletBinding()]
param(
    [string] $DbHost = '127.0.0.1',
    [int] $Port = 3307,
    [string] $User = 'root',
    [string] $Database = 'hiusa_db',
    [Parameter(Mandatory)] [string] $BackupFile,
    [System.Security.SecureString] $Password,
    [switch] $Force
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $BackupFile)) {
    throw "Backup file not found: $BackupFile"
}
$BackupFile = (Resolve-Path -LiteralPath $BackupFile).Path

function Resolve-MysqlPath {
    $command = Get-Command mysql -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $candidates = @(
        'C:\xampp\mysql\bin\mysql.exe',
        'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe',
        'C:\Program Files\MariaDB 11.0\bin\mysql.exe'
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    throw 'mysql client was not found on PATH or in common XAMPP/MySQL/MariaDB install locations. Add it to PATH or edit the $candidates list in this script.'
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

Write-Warning "This OVERWRITES database '$Database' on ${DbHost}:${Port} with the contents of:"
Write-Warning "  $BackupFile"
Write-Warning 'Every table the dump creates replaces the current table of the same name. There is no undo except restoring a different backup.'

if (-not $Force) {
    Write-Host ''
    Write-Host 'Nothing was changed. Rerun with -Force to actually perform the restore.'
    exit 0
}

if (-not $Password) {
    if ($env:HIUSA_DB_PASSWORD) {
        $Password = ConvertTo-SecureString -String $env:HIUSA_DB_PASSWORD -AsPlainText -Force
    } elseif ([Environment]::UserInteractive) {
        $Password = Read-Host "Password for ${User}@${DbHost}:${Port} (blank if none)" -AsSecureString
    }
}

$mysqlPath = Resolve-MysqlPath
$plainPassword = Get-PlainPassword $Password

Write-Host "Restoring into $Database on ${DbHost}:${Port} as $User ..."

$previousMysqlPwd = $env:MYSQL_PWD
try {
    $env:MYSQL_PWD = $plainPassword
    Get-Content -LiteralPath $BackupFile -Raw | & $mysqlPath "--host=$DbHost" "--port=$Port" "--user=$User" $Database
    $exitCode = $LASTEXITCODE
} finally {
    $env:MYSQL_PWD = $previousMysqlPwd
    $plainPassword = $null
}

if ($exitCode -ne 0) {
    throw "mysql exited with code $exitCode while restoring. The database may be partially restored - check its state before trusting it."
}

Write-Host "Restore complete: $Database now matches $BackupFile."
