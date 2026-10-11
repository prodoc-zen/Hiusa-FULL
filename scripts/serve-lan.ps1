<#
.SYNOPSIS
  Serve this machine's HIUSA copy to other devices on the same Wi-Fi or LAN so
  teammates can test it from their own phones and laptops, against a throwaway
  seeded database that is not the development database.

.DESCRIPTION
  Starts (if they are not already running) a brand-new throwaway MariaDB on
  127.0.0.1:3317 (bound to this computer only, data in the gitignored .lan-db
  folder, database hiusa_lan), the Laravel API on 0.0.0.0:8000 with debug off
  and the Vite client on 0.0.0.0:5173, then prints the address to share. The
  client is pointed at this machine's LAN address so other devices reach the
  API too. The API accepts requests from private network addresses on port 5173
  (FRONTEND_ORIGIN_PATTERNS in server/.env).

  The first run creates the throwaway database with the XAMPP MariaDB programs
  (C:\xampp\mysql\bin) and runs `php artisan migrate:fresh --seed`, so the
  fresh seed accounts in docs/MEMBER_TESTING.md exist. Later runs reuse that
  database and keep what testers entered; pass -Reset to wipe and reseed it.
  The API gets its connection settings (DB_HOST, DB_PORT, DB_DATABASE, ...) as
  process environment variables, so server/.env is never edited and the
  development database (XAMPP on 3306 or 3307, hiusa_db) is never touched.

  Run it from a normal terminal in the repository root:
      powershell -ExecutionPolicy Bypass -File scripts\serve-lan.ps1
  Run it as Administrator once to also open the two firewall ports, for
  devices on your own subnet only and only on Private and Domain networks.
  If Windows classes your Wi-Fi as Public, either switch the network to
  Private in Windows settings (recommended) or pass -AllowPublicNetwork.
  Wipe the throwaway database and seed it again (also stops a running copy):
      powershell -ExecutionPolicy Bypass -File scripts\serve-lan.ps1 -Reset
  Stop everything (API, client and the throwaway database) and close the ports
  again with:
      powershell -ExecutionPolicy Bypass -File scripts\serve-lan.ps1 -Stop

  WARNINGS. This serves a THROWAWAY SEEDED database with its demo accounts and
  known passwords, not the development database, over plain HTTP: anyone on the
  network can read passwords and tokens that cross it, and anyone who signs in
  as the SAO account has full SAO power over that throwaway database. Use it
  only on a network you trust, for a short test. Do not copy real student data,
  emails or fingerprints into it. Uploaded files land on this computer's disk
  (server/public/uploads), not in the database. Never expose it to the
  internet.
#>
param(
  [switch]$Stop,
  [switch]$Reset,
  [switch]$AllowPublicNetwork,
  [string]$HostIp,
  [int]$ApiPort = 8000,
  [int]$WebPort = 5173,
  [int]$DbPort = 3317
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root '.lan-pids'
$ruleName = 'HIUSA LAN test'

$dbDir = Join-Path $root '.lan-db'
$dbData = Join-Path $dbDir 'data'
$dbPassFile = Join-Path $dbDir 'app.pass'
$dbSeededFile = Join-Path $dbDir 'seeded'
$dbName = 'hiusa_lan'
$dbUser = 'root'
$mariaBin = 'C:\xampp\mysql\bin'

# Ports that belong to the development databases. This script never uses them.
$protectedDbPorts = @(3306, 3307, 3399)

function Test-Admin {
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-Port([int]$Port) {
  return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Get-DbPassword {
  if (-not (Test-Path $dbPassFile)) { return $null }
  return (Get-Content -Path $dbPassFile -Raw).Trim()
}

# Stops the throwaway MariaDB recorded in .lan-pids. It only acts on a process
# that is a mysqld.exe whose command line names this repository's .lan-db data
# folder, so a recycled process id can never take down another database.
function Stop-ThrowawayDb([int]$ProcessId, [int]$Port) {
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if (-not $proc -or $proc.Name -ne 'mysqld.exe' -or $proc.CommandLine -notlike "*$dbData*") { return }
  $mysqladmin = Join-Path $mariaBin 'mysqladmin.exe'
  $password = Get-DbPassword
  if ((Test-Path $mysqladmin) -and $password) {
    $env:MYSQL_PWD = $password
    try {
      & $mysqladmin --no-defaults -h 127.0.0.1 -P $Port -u $dbUser shutdown 2>&1 | Out-Null
    } catch {
    } finally {
      Remove-Item Env:\MYSQL_PWD -ErrorAction SilentlyContinue
    }
    for ($i = 0; $i -lt 30 -and (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Seconds 1 }
  }
  if (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) {
    & taskkill.exe /PID $ProcessId /T /F 2>&1 | Out-Null
  }
}

function Stop-OwnProcesses {
  if (-not (Test-Path $pidFile)) { return }
  # Lines: a bare process id (API, client) or "db=<pid>,<port>" (throwaway MariaDB, last so it outlives the API).
  Get-Content $pidFile | ForEach-Object {
    if ($_ -match '^\d+$') {
      & taskkill.exe /PID $_ /T /F 2>&1 | Out-Null
    } elseif ($_ -match '^db=(\d+),(\d+)$') {
      Stop-ThrowawayDb -ProcessId ([int]$Matches[1]) -Port ([int]$Matches[2])
    }
  }
  Remove-Item $pidFile -Force
}

function Remove-ThrowawayDb {
  $full = [System.IO.Path]::GetFullPath($dbDir)
  $rootFull = [System.IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
  if (-not $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase) -or
      (Split-Path -Leaf $full) -ne '.lan-db') {
    throw "Refusing to delete ${full}: it is not a .lan-db folder inside $root."
  }
  if (-not (Test-Path $full)) { return }
  if ((Get-Item $full -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
    throw "Refusing to delete ${full}: it is a link, not a plain folder."
  }
  Remove-Item -LiteralPath $full -Recurse -Force
}

if ($Stop) {
  Stop-OwnProcesses
  if (Test-Admin) {
    Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    Write-Host 'Stopped the API, the client and the throwaway database and closed the firewall ports.'
  } else {
    Write-Host 'Stopped the API, the client and the throwaway database. Run as Administrator to also remove the firewall rule.'
  }
  Write-Host 'The throwaway data is kept in .lan-db for the next run (use -Reset to wipe it). No other database was touched.'
  exit 0
}

if ($protectedDbPorts -contains $DbPort) {
  throw "Port $DbPort belongs to a development database. Pass a different -DbPort (the default is 3317)."
}

Stop-OwnProcesses
foreach ($port in @($ApiPort, $WebPort, $DbPort)) {
  if (Test-Port $port) {
    throw "Port $port is already in use by a process this script did not start. Close it first, or pass a different -ApiPort, -WebPort or -DbPort."
  }
}

$candidates = @(Get-NetIPConfiguration |
  Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' })
if (-not $HostIp) {
  if (-not $candidates) { throw 'No network connection with a default gateway was found. Connect to Wi-Fi first, or pass -HostIp.' }
  $chosen = $candidates | Where-Object { $_.InterfaceAlias -match 'Wi-?Fi|WLAN|Wireless' } | Select-Object -First 1
  if (-not $chosen) { $chosen = $candidates | Select-Object -First 1 }
  $HostIp = $chosen.IPv4Address.IPAddress
}
if ($HostIp -notmatch '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)') {
  throw "The address $HostIp is not a private network address. The API only accepts private ranges."
}
$otherAddresses = @($candidates | ForEach-Object { $_.IPv4Address.IPAddress } | Where-Object { $_ -ne $HostIp })

$publicNetwork = $false
$hostConfig = $candidates | Where-Object { $_.IPv4Address.IPAddress -eq $HostIp } | Select-Object -First 1
if ($hostConfig) {
  $category = (Get-NetConnectionProfile -InterfaceIndex $hostConfig.InterfaceIndex -ErrorAction SilentlyContinue).NetworkCategory
  $publicNetwork = ($category -eq 'Public')
}

$php = if (Test-Path 'C:\xampp\php\php.exe') { 'C:\xampp\php\php.exe' } else { 'php' }
$phpModules = & $php -m
if (-not ($phpModules -contains 'pdo_mysql')) {
  throw "PHP ($php) does not have the pdo_mysql extension loaded, so the API cannot reach MariaDB. Enable extension=pdo_mysql in that PHP's php.ini."
}

$mysqld = Join-Path $mariaBin 'mysqld.exe'
$installDb = Join-Path $mariaBin 'mysql_install_db.exe'
$mysqlClient = Join-Path $mariaBin 'mysql.exe'
foreach ($tool in @($mysqld, $installDb, $mysqlClient)) {
  if (-not (Test-Path $tool)) { throw "XAMPP MariaDB program not found: $tool. Install XAMPP, or put its mysql folder at $mariaBin." }
}

# The throwaway MariaDB. -Reset deletes only the repository's .lan-db folder.
if ($Reset) { Remove-ThrowawayDb }
New-Item -ItemType Directory -Force -Path $dbDir | Out-Null

if (-not (Test-Path (Join-Path $dbData 'mysql'))) {
  if (Test-Path $dbData) { Remove-Item -LiteralPath $dbData -Recurse -Force }
  Write-Host 'Creating the throwaway MariaDB data folder (first run only)...'
  $bytes = New-Object byte[] 24
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $dbPassword = (($bytes | ForEach-Object { 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[$_ % 56] }) -join '')
  Set-Content -Path $dbPassFile -Value $dbPassword -NoNewline
  Remove-Item -LiteralPath $dbSeededFile -Force -ErrorAction SilentlyContinue
  & $installDb --silent "--datadir=$dbData" "--password=$dbPassword" "--port=$DbPort"
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $dbData 'mysql'))) { throw 'mysql_install_db failed to create the throwaway data folder.' }
}
$dbPassword = Get-DbPassword
if (-not $dbPassword) { throw "The throwaway database password file is missing. Run again with -Reset." }

$db = Start-Process -FilePath $mysqld -WindowStyle Hidden -PassThru -ArgumentList `
  '--no-defaults', "--datadir=`"$dbData`"", "--port=$DbPort", '--bind-address=127.0.0.1', '--skip-name-resolve', `
  '--standalone', '--character-set-server=utf8mb4', '--collation-server=utf8mb4_unicode_ci'
"db=$($db.Id),$DbPort" | Set-Content -Path $pidFile
for ($i = 0; $i -lt 120 -and -not (Test-Port $DbPort) -and -not $db.HasExited; $i++) { Start-Sleep -Seconds 1 }
if (-not (Test-Port $DbPort)) { throw "The throwaway MariaDB did not start on port $DbPort. Its log is in $dbData (the .err file)." }

$env:MYSQL_PWD = $dbPassword
try {
  & $mysqlClient --no-defaults -h 127.0.0.1 -P $DbPort -u $dbUser -e "CREATE DATABASE IF NOT EXISTS $dbName CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
  if ($LASTEXITCODE -ne 0) { throw "Could not create the $dbName database." }
} finally {
  Remove-Item Env:\MYSQL_PWD -ErrorAction SilentlyContinue
}

# Connection settings for the artisan and API processes. Process environment
# variables win over server/.env, which is left untouched.
$env:DB_CONNECTION = 'mysql'
$env:DB_HOST = '127.0.0.1'
$env:DB_PORT = "$DbPort"
$env:DB_DATABASE = $dbName
$env:DB_USERNAME = $dbUser
$env:DB_PASSWORD = $dbPassword
$env:APP_DEBUG = 'false'

if (-not (Test-Path $dbSeededFile)) {
  Write-Host "Migrating and seeding $dbName (first run, or after -Reset)..."
  Push-Location (Join-Path $root 'server')
  try {
    & $php artisan migrate:fresh --seed --force
    if ($LASTEXITCODE -ne 0) { throw "php artisan migrate:fresh --seed failed (exit $LASTEXITCODE). Run again with -Reset." }
  } finally {
    Pop-Location
  }
  Set-Content -Path $dbSeededFile -Value (Get-Date -Format 's')
}

# --no-reload keeps artisan serve from stripping the DB_* variables above and
# re-reading server/.env (which may point at another database).
$api = Start-Process -FilePath $php -ArgumentList 'artisan', 'serve', '--host=0.0.0.0', "--port=$ApiPort", '--no-reload' `
  -WorkingDirectory (Join-Path $root 'server') -WindowStyle Minimized -PassThru

$env:VITE_API_URL = "http://${HostIp}:${ApiPort}/api"
$web = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "npm run dev -- --host 0.0.0.0 --port $WebPort --strictPort" `
  -WorkingDirectory (Join-Path $root 'client') -WindowStyle Minimized -PassThru

"$($api.Id)`n$($web.Id)`ndb=$($db.Id),$DbPort" | Set-Content -Path $pidFile

if (Test-Admin) {
  if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
    $profiles = if ($AllowPublicNetwork) { 'Any' } else { 'Private,Domain' }
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP `
      -LocalPort $ApiPort, $WebPort -Profile $profiles -RemoteAddress LocalSubnet | Out-Null
  }
  $firewall = 'Firewall: ports opened for your local subnet only.'
  if ($publicNetwork -and -not $AllowPublicNetwork) {
    $firewall += ' This network is classed as Public, so the rule does not apply here: switch the network to Private in Windows settings, or run again with -AllowPublicNetwork.'
  }
} else {
  $firewall = "Firewall: not changed. If other devices cannot connect, run this script once as Administrator (or allow ports $WebPort and $ApiPort when Windows asks)."
}

for ($i = 0; $i -lt 60 -and -not ((Test-Port $ApiPort) -and (Test-Port $WebPort)); $i++) { Start-Sleep -Seconds 1 }
if (-not ((Test-Port $ApiPort) -and (Test-Port $WebPort))) {
  Write-Warning 'The API or the client did not come up in 60 seconds. Check the two minimized windows for errors.'
}

Write-Host ''
Write-Host "Share this address with your teammates (same network):  http://${HostIp}:${WebPort}"
if ($otherAddresses.Count -gt 0) {
  Write-Host "This computer is on more than one network. Teammates must be on the network of $HostIp. For the other network use -HostIp, for example: -HostIp $($otherAddresses[0])"
}
Write-Host $firewall
Write-Host "Reminder: plain HTTP, demo passwords, throwaway seeded database $dbName on 127.0.0.1:$DbPort (not the development database). Trusted network only."
Write-Host 'Test accounts and journeys: docs/MEMBER_TESTING.md (use the fresh seed table)'
Write-Host 'Wipe and reseed with: powershell -ExecutionPolicy Bypass -File scripts\serve-lan.ps1 -Reset'
Write-Host 'Stop with: powershell -ExecutionPolicy Bypass -File scripts\serve-lan.ps1 -Stop'
