<#
.SYNOPSIS
  Serve this machine's HIUSA copy to other devices on the same Wi-Fi or LAN so
  teammates can test it from their own phones and laptops.

.DESCRIPTION
  Starts (if they are not already running) the XAMPP MariaDB on 3307, the
  Laravel API on 0.0.0.0:8000 and the Vite client on 0.0.0.0:5173, then prints
  the address to share. The client is pointed at this machine's LAN address so
  other devices reach the API too. The API already accepts requests from
  private network addresses on port 5173 (FRONTEND_ORIGIN_PATTERNS in
  server/.env).

  Run it from a normal terminal in the repository root:
      powershell -ExecutionPolicy Bypass -File scripts\serve-lan.ps1
  Run it as Administrator once to also open the two firewall ports. Stop
  everything and close the ports again with:
      powershell -ExecutionPolicy Bypass -File scripts\serve-lan.ps1 -Stop

  This serves the DEVELOPMENT database with its demo accounts and known
  passwords. Use it only on a network you trust. Never expose it to the
  internet.
#>
param(
  [switch]$Stop,
  [string]$HostIp,
  [int]$ApiPort = 8000,
  [int]$WebPort = 5173
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

function Stop-Port([int]$Port) {
  Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}

if ($Stop) {
  Stop-Port $ApiPort
  Stop-Port $WebPort
  if (Test-Path $pidFile) { Remove-Item $pidFile -Force }
  if (Test-Admin) {
    Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    Write-Host 'Stopped the API and the client and closed the firewall ports.'
  } else {
    Write-Host 'Stopped the API and the client. Run as Administrator to also remove the firewall rule.'
  }
  Write-Host 'MariaDB was left running. Stop it from the XAMPP control panel if you want to.'
  exit 0
}

$candidates = @(Get-NetIPConfiguration |
  Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' })
if (-not $HostIp) {
  if (-not $candidates) { throw 'No network connection with a default gateway was found. Connect to Wi-Fi first, or pass -HostIp.' }
  $chosen = $candidates | Where-Object { $_.InterfaceAlias -match 'Wi-?Fi|WLAN|Wireless' } | Select-Object -First 1
  if (-not $chosen) { $chosen = $candidates | Select-Object -First 1 }
  $HostIp = $chosen.IPv4Address.IPAddress
}
$otherAddresses = @($candidates | ForEach-Object { $_.IPv4Address.IPAddress } | Where-Object { $_ -ne $HostIp })
if ($HostIp -notmatch '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)') {
  throw "The address $HostIp is not a private network address. The API only accepts private ranges."
}

if (-not (Test-Port 3307)) {
  $mysqld = 'C:\xampp\mysql\bin\mysqld.exe'
  if (-not (Test-Path $mysqld)) { throw 'XAMPP MariaDB was not found. Start the database on port 3307 first.' }
  Start-Process -FilePath $mysqld -ArgumentList '--defaults-file=C:\xampp\mysql\bin\my.ini', '--standalone' -WindowStyle Hidden
  for ($i = 0; $i -lt 30 -and -not (Test-Port 3307); $i++) { Start-Sleep -Seconds 1 }
  if (-not (Test-Port 3307)) { throw 'MariaDB did not start on port 3307.' }
}

Stop-Port $ApiPort
Stop-Port $WebPort

$php = if (Test-Path 'C:\xampp\php\php.exe') { 'C:\xampp\php\php.exe' } else { 'php' }
$api = Start-Process -FilePath $php -ArgumentList 'artisan', 'serve', '--host=0.0.0.0', "--port=$ApiPort" `
  -WorkingDirectory (Join-Path $root 'server') -WindowStyle Minimized -PassThru

$env:VITE_API_URL = "http://${HostIp}:${ApiPort}/api"
$web = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "npm run dev -- --host 0.0.0.0 --port $WebPort --strictPort" `
  -WorkingDirectory (Join-Path $root 'client') -WindowStyle Minimized -PassThru

"$($api.Id)`n$($web.Id)" | Set-Content -Path $pidFile

if (Test-Admin) {
  if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP `
      -LocalPort $ApiPort, $WebPort -Profile Any | Out-Null
  }
  $firewall = 'Firewall: ports opened for the test.'
} else {
  $firewall = "Firewall: not changed. If other devices cannot connect, run this script once as Administrator (or allow ports $WebPort and $ApiPort when Windows asks)."
}

for ($i = 0; $i -lt 60 -and -not ((Test-Port $ApiPort) -and (Test-Port $WebPort)); $i++) { Start-Sleep -Seconds 1 }
if (-not ((Test-Port $ApiPort) -and (Test-Port $WebPort))) {
  Write-Warning 'The API or the client did not come up in 60 seconds. Check the two minimized windows for errors.'
}

Write-Host ''
Write-Host "Share this address with your teammates (same Wi-Fi):  http://${HostIp}:${WebPort}"
if ($otherAddresses.Count -gt 0) {
  Write-Host "This computer is on more than one network. Teammates must be on the network of $HostIp. For the other network use -HostIp, for example: -HostIp $($otherAddresses[0])"
}
Write-Host $firewall
Write-Host 'Test accounts and journeys: docs/MEMBER_TESTING.md'
Write-Host 'Stop with: powershell -ExecutionPolicy Bypass -File scripts\serve-lan.ps1 -Stop'
