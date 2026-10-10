<#
.SYNOPSIS
  Serve this machine's HIUSA copy to other devices on the same Wi-Fi or LAN so
  teammates can test it from their own phones and laptops.

.DESCRIPTION
  Starts (if they are not already running) the XAMPP MariaDB on 3307 (bound to
  this computer only), the Laravel API on 0.0.0.0:8000 with debug off and the
  Vite client on 0.0.0.0:5173, then prints the address to share. The client is
  pointed at this machine's LAN address so other devices reach the API too. The
  API accepts requests from private network addresses on port 5173
  (FRONTEND_ORIGIN_PATTERNS in server/.env).

  Run it from a normal terminal in the repository root:
      powershell -ExecutionPolicy Bypass -File scripts\serve-lan.ps1
  Run it as Administrator once to also open the two firewall ports, for
  devices on your own subnet only and only on Private and Domain networks.
  If Windows classes your Wi-Fi as Public, either switch the network to
  Private in Windows settings (recommended) or pass -AllowPublicNetwork.
  Stop everything and close the ports again with:
      powershell -ExecutionPolicy Bypass -File scripts\serve-lan.ps1 -Stop

  WARNINGS. This serves the DEVELOPMENT database with its demo accounts and
  known passwords, over plain HTTP: anyone on the network can read passwords
  and tokens that cross it, and anyone who signs in as the SAO account has
  full SAO power on that database. Use it only on a network you trust, for a
  short test, with a database that holds no real student data, emails or
  fingerprints. Uploaded files land on this computer's disk. Never expose it
  to the internet.
#>
param(
  [switch]$Stop,
  [switch]$AllowPublicNetwork,
  [string]$HostIp,
  [int]$ApiPort = 8000,
  [int]$WebPort = 5173,
  [int]$DbPort = 3307
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root '.lan-pids'
$ruleName = 'HIUSA LAN test'

function Test-Admin {
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-Port([int]$Port) {
  return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Stop-OwnProcesses {
  if (-not (Test-Path $pidFile)) { return }
  Get-Content $pidFile | Where-Object { $_ -match '^\d+$' } | ForEach-Object {
    & taskkill.exe /PID $_ /T /F 2>&1 | Out-Null
  }
  Remove-Item $pidFile -Force
}

if ($Stop) {
  Stop-OwnProcesses
  if (Test-Admin) {
    Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    Write-Host 'Stopped the API and the client and closed the firewall ports.'
  } else {
    Write-Host 'Stopped the API and the client. Run as Administrator to also remove the firewall rule.'
  }
  Write-Host 'MariaDB was left running. Stop it from the XAMPP control panel if you want to.'
  exit 0
}

Stop-OwnProcesses
foreach ($port in @($ApiPort, $WebPort)) {
  if (Test-Port $port) {
    throw "Port $port is already in use by a process this script did not start. Close it first, or pass a different -ApiPort or -WebPort."
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

if (-not (Test-Port $DbPort)) {
  $mysqld = 'C:\xampp\mysql\bin\mysqld.exe'
  if (-not (Test-Path $mysqld)) { throw "XAMPP MariaDB was not found. Start the database on port $DbPort first." }
  Start-Process -FilePath $mysqld -ArgumentList '--defaults-file=C:\xampp\mysql\bin\my.ini', '--standalone', '--bind-address=127.0.0.1' -WindowStyle Hidden
  for ($i = 0; $i -lt 30 -and -not (Test-Port $DbPort); $i++) { Start-Sleep -Seconds 1 }
  if (-not (Test-Port $DbPort)) { throw "MariaDB did not start on port $DbPort." }
}

$env:APP_DEBUG = 'false'
$php = if (Test-Path 'C:\xampp\php\php.exe') { 'C:\xampp\php\php.exe' } else { 'php' }
$api = Start-Process -FilePath $php -ArgumentList 'artisan', 'serve', '--host=0.0.0.0', "--port=$ApiPort" `
  -WorkingDirectory (Join-Path $root 'server') -WindowStyle Minimized -PassThru

$env:VITE_API_URL = "http://${HostIp}:${ApiPort}/api"
$web = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "npm run dev -- --host 0.0.0.0 --port $WebPort --strictPort" `
  -WorkingDirectory (Join-Path $root 'client') -WindowStyle Minimized -PassThru

"$($api.Id)`n$($web.Id)" | Set-Content -Path $pidFile

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
Write-Host 'Reminder: plain HTTP, demo passwords, development database. Trusted network only.'
Write-Host 'Test accounts and journeys: docs/MEMBER_TESTING.md'
Write-Host 'Stop with: powershell -ExecutionPolicy Bypass -File scripts\serve-lan.ps1 -Stop'
