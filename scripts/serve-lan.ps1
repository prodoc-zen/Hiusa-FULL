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
  Both modes also run Laravel's scheduler (`php artisan schedule:work`, hidden,
  log in .lan-db\scheduler.log, or public-build\scheduler.log with -Public), so
  elections open and close by their window, event reminders and no-shows,
  overdue tasks and scheduled SAO notices work on the test copy. It uses the same
  database as the API and has the AI helpers switched off (none of its jobs need
  them). -Stop stops it with the rest; in -Public a failed start or Ctrl+C
  before the link is printed does too.
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

  Test from anywhere over the internet (members in different places, one https
  link, no account needed):
      powershell -ExecutionPolicy Bypass -File scripts\serve-lan.ps1 -Public
  -Public builds the client for same-origin use, serves the build with
  `vite preview` on 127.0.0.1:5173 and starts the API on 127.0.0.1:8000 (neither
  is reachable from the network), then opens a free Cloudflare quick tunnel
  (`cloudflared tunnel --url`, no firewall changes) and prints its
  https://....trycloudflare.com link. The browser only talks to that one
  origin: the preview server forwards /api, /storage and /uploads to the API.
  The link is new on every start. cloudflared is found on PATH or in
  C:\Users\JM\tools\cloudflared. -Stop also ends the tunnel and removes the
  build and the tunnel log (.lan-db\public-build). It can be combined with
  -Reset. If any step of a -Public start fails, everything it started (tunnel,
  preview, API, database) is stopped again before the error is shown.
  The public copy sends no mail and calls no outside AI service (MAIL_MAILER=log,
  AI helpers off), and the SAO account 990001 gets a fresh random password on
  every start that is printed to this console only, never stored. After a
  public run, 990001 keeps that password on later LAN runs until -Reset.
  Ctrl+C before the link is printed also stops everything it had started.
  -EnableAi (only with -Public) switches the AI helpers on in the public copy.
  The API then reads the Groq key from server/.env itself (it is never passed
  on a command line or to the tunnel or the preview server), so testers use up
  the operator's Groq quota. The local Python AI engine (ai-service, port 8001,
  127.0.0.1 only) is started with a fresh random key shared with the API for
  this run only, and is stopped by -Stop, by a failed start and by Ctrl+C.
  Mail stays off either way (this script forces the log mailer). Without -EnableAi
  the Groq key, the AI engine and mail are all neutralised.
  -TunnelWaitSeconds (default 60) is how long to wait for the tunnel to print
  its link before the start is given up and cleaned up.

  WARNINGS. This serves a THROWAWAY SEEDED database with its demo accounts and
  known passwords, not the development database, over plain HTTP: anyone on the
  network can read passwords and tokens that cross it, and anyone who signs in
  as the SAO account has full SAO power over that throwaway database. Use it
  only on a network you trust, for a short test. Do not copy real student data,
  emails or fingerprints into it. Uploaded files land on this computer's disk
  (server/public/uploads), not in the database. Never expose it to the
  internet, except with -Public below.

  WARNINGS for -Public. The link is PUBLIC: anyone who has it can open the app
  and try the demo accounts and their known passwords, with full SAO power for
  the SAO account, over a tunnel run by a third party. Throwaway data only:
  never put real student data, emails or fingerprints in it. Uploaded files
  land on this computer's disk (server/public/uploads and server/storage), not
  in the database. Quick tunnels have no uptime guarantee. Stop it with -Stop
  as soon as the test ends.
#>
param(
  [switch]$Stop,
  [switch]$Reset,
  [switch]$AllowPublicNetwork,
  [switch]$Public,
  [switch]$EnableAi,
  [string]$HostIp,
  [int]$ApiPort = 8000,
  [int]$WebPort = 5173,
  [int]$DbPort = 3317,
  [int]$TunnelWaitSeconds = 60
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

# -Public mode: the client build and the tunnel log (it holds the public link)
# live in one folder that -Stop deletes. cloudflared is taken from PATH or from
# the folder it is downloaded to.
$publicDir = Join-Path $dbDir 'public-build'
$publicDist = Join-Path $publicDir 'dist'
$publicLog = Join-Path $publicDir 'cloudflared.log'
$publicConfig = Join-Path $publicDir 'cloudflared.yml'
$publicApiLog = Join-Path $publicDir 'api.log'
$publicApiErrLog = Join-Path $publicDir 'api-error.log'
$cloudflaredFolder = 'C:\Users\JM\tools\cloudflared'
# -EnableAi: the local Python AI engine (server/.env points HIUSA_AI_SERVICE_URL at port 8001).
$aiDir = Join-Path $root 'ai-service'
$aiPython = Join-Path $aiDir '.venv\Scripts\python.exe'
$aiPort = 8001
$publicAiLog = Join-Path $publicDir 'ai.log'
$publicAiErrLog = Join-Path $publicDir 'ai-error.log'

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
  $raw = Get-Content -Path $dbPassFile -Raw
  if (-not $raw) { return $null }
  return $raw.Trim()
}

# Kills a process and its children. Never throws: taskkill prints to stderr for
# a process that is already gone, which Windows PowerShell 5.1 turns into a
# terminating error under $ErrorActionPreference = 'Stop'.
function Stop-ProcessTree([int]$ProcessId) {
  try {
    & cmd.exe /c "taskkill.exe /PID $ProcessId /T /F >nul 2>&1" | Out-Null
  } catch {
  }
  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

# Stops the throwaway MariaDB recorded in .lan-pids. It only acts on a process
# that is a mysqld.exe whose command line names this repository's .lan-db data
# folder, so a recycled process id can never take down another database.
function Stop-ThrowawayDb([int]$ProcessId, [int]$Port) {
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if (-not $proc) { return }
  if ($proc.Name -eq 'mysqld.exe' -and -not $proc.CommandLine) {
    $script:unverified += $ProcessId
    return
  }
  if ($proc.Name -ne 'mysqld.exe' -or $proc.CommandLine -notlike "*$dbData*") { return }
  $mysqladmin = Join-Path $mariaBin 'mysqladmin.exe'
  $password = Get-DbPassword
  if ((Test-Path $mysqladmin) -and $password) {
    $env:MYSQL_PWD = $password
    try {
      # Bounded: against a server that accepts connections but never answers, mysqladmin would wait for ever.
      $admin = Start-Process -FilePath $mysqladmin -WindowStyle Hidden -PassThru -ArgumentList `
        '--no-defaults', '--connect-timeout=10', '-h', '127.0.0.1', '-P', "$Port", '-u', $dbUser, 'shutdown'
      if (-not $admin.WaitForExit(20000)) { Stop-Process -Id $admin.Id -Force -ErrorAction SilentlyContinue }
    } catch {
    } finally {
      Remove-Item Env:\MYSQL_PWD -ErrorAction SilentlyContinue
    }
    for ($i = 0; $i -lt 30 -and (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Seconds 1 }
  }
  if (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) {
    Stop-ProcessTree $ProcessId
  }
}

function Get-Cloudflared {
  $found = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($found) { return $found.Source }
  $local = Join-Path $cloudflaredFolder 'cloudflared.exe'
  if (Test-Path $local) { return $local }
  return $null
}

# True only for a process this script starts: the artisan server, the npm
# wrapper or its node child, or the tunnel. A recycled process id that now
# belongs to anything else is never killed.
function Test-OwnedProcess($Proc) {
  $cmdLine = [string]$Proc.CommandLine
  switch ([string]$Proc.Name) {
    'php.exe' { return ($cmdLine -like '*artisan*serve*--no-reload*' -or ($cmdLine -like '*artisan*' -and $cmdLine -like '*schedule:work*')) }
    'python.exe' { return ($cmdLine -like '*run.py*' -and $cmdLine -like "*$aiDir*") }
    'cmd.exe' { return ($cmdLine -like '*npm run*') }
    'node.exe' { return ($cmdLine -like "*$root*") }
    'cloudflared.exe' { return ($cmdLine -like "*$publicConfig*") }
  }
  return $false
}

# The kinds of process this script starts, by image name.
$ownedNames = @('php.exe', 'cmd.exe', 'node.exe', 'cloudflared.exe', 'python.exe')

# Process ids that are ours by name but whose command line Windows would not
# show (started from an Administrator console, read from a normal one).
$unverified = @()

# Returns $true when every listed process is gone or was stopped, $false when
# some could not be verified (then .lan-pids is kept).
function Stop-OwnProcesses {
  if (-not (Test-Path $pidFile)) { return $true }
  $script:unverified = @()
  # Lines: a bare process id (API, client, tunnel) or "db=<pid>,<port>" (throwaway MariaDB, last so it outlives the API).
  $lines = @()
  try { $lines = @(Get-Content -Path $pidFile -ErrorAction Stop) } catch { Write-Warning "Could not read ${pidFile}: $($_.Exception.Message)" }
  $killed = @()
  foreach ($line in $lines) {
    try {
      $text = ([string]$line).Trim()
      if ($text -match '^\d{1,9}$') {
        $procId = [int]$text
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $procId" -ErrorAction SilentlyContinue
        if (-not $proc) { continue }
        if (($ownedNames -contains [string]$proc.Name) -and -not $proc.CommandLine) {
          $script:unverified += $procId
        } elseif (Test-OwnedProcess $proc) {
          Stop-ProcessTree $procId
          $killed += $procId
        } else {
          Write-Host "Skipped process id ${procId}: it is a $($proc.Name), not something this script started."
        }
      } elseif ($text -match '^db=(\d{1,9}),(\d{1,5})$') {
        $dbProcId = [int]$Matches[1]
        Stop-ThrowawayDb -ProcessId $dbProcId -Port ([int]$Matches[2])
        if ($script:unverified -notcontains $dbProcId) { $killed += $dbProcId }
      }
    } catch {
      Write-Warning "Could not stop a process listed in ${pidFile}: $($_.Exception.Message)"
    }
  }
  # Give the killed processes a moment to let go of their files (the tunnel log).
  $alive = @($killed | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue } | Where-Object { $_ })
  if ($alive.Count -gt 0) {
    try { Wait-Process -InputObject $alive -Timeout 10 -ErrorAction SilentlyContinue } catch { }
  }
  if ($script:unverified.Count -gt 0) {
    Write-Warning "Could not verify process id(s) $($script:unverified -join ', ') from this console: Windows hides the command line of a process started from an Administrator console. They were NOT stopped and $pidFile was kept. Run -Stop from an Administrator console."
    return $false
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  return $true
}

# Starts Laravel's scheduler (server/routes/console.php: elections open and close
# by their window, event reminders and no-shows, overdue tasks, scheduled SAO
# notices, cache pruning), which nothing else runs on a test copy. It gets the
# same database settings as the API. None of the scheduled jobs call Groq or the
# AI engine, so those are switched off for it in every mode (and put back after
# the start, so the API keeps its own values). Its output goes to a log next to
# the other logs of the mode: public-build in -Public, .lan-db otherwise.
function Start-Scheduler {
  $logDir = if ($Public) { $publicDir } else { $dbDir }
  $schedulerOut = Join-Path $logDir 'scheduler.log'
  $schedulerErr = Join-Path $logDir 'scheduler-error.log'
  $names = @('HIUSA_AI_SERVICE_ENABLED', 'HIUSA_AI_SERVICE_KEY', 'GROQ_API_KEY', 'GROQ_API_URL')
  $saved = @{}
  foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
  $env:HIUSA_AI_SERVICE_ENABLED = 'false'
  $env:HIUSA_AI_SERVICE_KEY = '(null)'
  $env:GROQ_API_KEY = '(null)'
  $env:GROQ_API_URL = 'http://127.0.0.1:9/disabled'
  try {
    return Start-Process -FilePath $php -ArgumentList 'artisan', 'schedule:work' `
      -WorkingDirectory (Join-Path $root 'server') -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput $schedulerOut -RedirectStandardError $schedulerErr
  } finally {
    Restore-Env $saved
  }
}

# Rewrites .lan-pids from the processes started so far, so a failed start can
# always be cleaned up by Stop-OwnProcesses.
function Write-PidFile {
  $lines = @()
  foreach ($p in @($script:scheduler, $script:api, $script:ai, $script:web, $script:tunnel)) { if ($p) { $lines += "$($p.Id)" } }
  if ($script:db) { $lines += "db=$($script:db.Id),$DbPort" }
  Set-Content -Path $pidFile -Value $lines
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

function Remove-PublicBuild {
  $full = [System.IO.Path]::GetFullPath($publicDir)
  $rootFull = [System.IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
  if (-not $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase) -or
      (Split-Path -Leaf $full) -ne 'public-build') {
    throw "Refusing to delete ${full}: it is not a public-build folder inside $root."
  }
  if (-not (Test-Path $full)) { return }
  if ((Get-Item $full -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
    throw "Refusing to delete ${full}: it is a link, not a plain folder."
  }
  # A file still held by a process that is shutting down must not stop the rest
  # of -Stop (the firewall cleanup), so a failed delete is only a warning.
  try {
    Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction Stop
  } catch {
    Write-Warning "Could not remove ${full}: $($_.Exception.Message) Delete it by hand (it holds the public link and a copy of the client build)."
  }
}

# Process state of a -Public start, so Write-PidFile and the cleanup see it.
$db = $null
$api = $null
$scheduler = $null
$ai = $null
$web = $null
$tunnel = $null

if ($EnableAi -and -not $Public) {
  throw '-EnableAi only works together with -Public (it switches the AI helpers on in the public copy).'
}

if ($Stop) {
  $clean = Stop-OwnProcesses
  if (Test-Admin) {
    Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  }
  if (-not $clean) {
    Write-Host 'NOT everything was stopped: the processes listed above are still running (the public tunnel may be one of them). Run -Stop from an Administrator console.'
    exit 1
  }
  Remove-PublicBuild
  if (Test-Admin) {
    Write-Host 'Stopped the API, the client, the public tunnel (if any) and the throwaway database and closed the firewall ports.'
  } else {
    Write-Host 'Stopped the API, the client, the public tunnel (if any) and the throwaway database. Run as Administrator to also remove the firewall rule.'
  }
  Write-Host 'The throwaway data is kept in .lan-db for the next run (use -Reset to wipe it). No other database was touched.'
  exit 0
}

if ($protectedDbPorts -contains $DbPort) {
  throw "Port $DbPort belongs to a development database. Pass a different -DbPort (the default is 3317)."
}

if (-not (Stop-OwnProcesses)) {
  throw 'A copy started from an Administrator console is still running and could not be stopped from this one. Run -Stop from an Administrator console first.'
}
Remove-PublicBuild
foreach ($port in @($ApiPort, $WebPort, $DbPort)) {
  if (Test-Port $port) {
    throw "Port $port is already in use by a process this script did not start. Close it first, or pass a different -ApiPort, -WebPort or -DbPort."
  }
}
if ($EnableAi) {
  if (@($ApiPort, $WebPort, $DbPort) -contains $aiPort) {
    throw "-EnableAi needs port $aiPort for the AI engine; pick other -ApiPort, -WebPort and -DbPort values."
  }
  if (Test-Port $aiPort) {
    throw "Port $aiPort (the local AI engine) is already in use by a process this script did not start. Close it first: server/.env points the API at 127.0.0.1:$aiPort."
  }
  if (-not (Test-Path $aiPython)) {
    throw "The AI engine's Python was not found at $aiPython. Create the ai-service virtual environment first (see ai-service/README.md)."
  }
}

if (-not $Public) {
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
}

$php = if (Test-Path 'C:\xampp\php\php.exe') { 'C:\xampp\php\php.exe' } else { 'php' }
$phpModules = & $php -m
if (-not ($phpModules -contains 'pdo_mysql')) {
  throw "PHP ($php) does not have the pdo_mysql extension loaded, so the API cannot reach MariaDB. Enable extension=pdo_mysql in that PHP's php.ini."
}

$cloudflared = $null
if ($Public) {
  $cloudflared = Get-Cloudflared
  if (-not $cloudflared) {
    throw "cloudflared was not found on PATH or in $cloudflaredFolder. Install it with: winget install --id Cloudflare.cloudflared -e (or download cloudflared-windows-amd64.exe from the cloudflare/cloudflared GitHub release into that folder as cloudflared.exe)."
  }
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

function Restore-Env([hashtable]$Saved) {
  foreach ($name in $Saved.Keys) { [Environment]::SetEnvironmentVariable($name, $Saved[$name], 'Process') }
}

# Takes the secrets out of this process's environment and returns them, so a
# child started next (build, preview server, tunnel, AI engine) cannot inherit
# them. Put them back with Restore-Env. The caller's own Groq key is included:
# the API reads the real one from server/.env itself.
function Hide-Secrets {
  $held = @{}
  foreach ($name in @('DB_CONNECTION', 'DB_HOST', 'DB_PORT', 'DB_DATABASE', 'DB_USERNAME', 'DB_PASSWORD', 'APP_KEY', 'MYSQL_PWD', 'GROQ_API_KEY')) {
    $held[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    [Environment]::SetEnvironmentVariable($name, $null, 'Process')
  }
  return $held
}

# Letters and digits, drawn without modulo bias.
function New-RandomPassword([int]$Length = 24) {
  $alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $text = New-Object System.Text.StringBuilder
  $one = New-Object byte[] 1
  while ($text.Length -lt $Length) {
    $rng.GetBytes($one)
    if ($one[0] -lt 248) { [void]$text.Append($alphabet[$one[0] % 62]) }
  }
  $rng.Dispose()
  return $text.ToString()
}

# -Public sets many process environment variables. Remember what the caller had
# so it is put back at the end and nothing leaks into a later run in the same
# console (a LAN run after a public run included).
$envSaved = @{}
if ($Public) {
  $publicEnvNames = @(
    'DB_CONNECTION', 'DB_HOST', 'DB_PORT', 'DB_DATABASE', 'DB_USERNAME', 'DB_PASSWORD', 'APP_DEBUG', 'APP_KEY', 'MYSQL_PWD',
    'VITE_API_URL', 'HIUSA_PUBLIC', 'HIUSA_API_TARGET', 'APP_URL', 'FRONTEND_URL', 'TRUSTED_PROXIES', 'HIUSA_SAO_PW',
    'MAIL_MAILER', 'MAIL_USERNAME', 'MAIL_PASSWORD', 'HIUSA_AI_SERVICE_ENABLED', 'HIUSA_AI_SERVICE_KEY', 'HIUSA_AI_SERVICE_URL', 'HIUSA_AI_SERVICE_AUTH_DISABLED',
    'HIUSA_AI_HOST', 'HIUSA_AI_PORT', 'HIUSA_AI_RELOAD', 'GROQ_API_KEY', 'GROQ_API_URL',
    'FINGERPRINT_MATCHER_DRIVER', 'FINGERPRINT_MATCHER_KEY', 'RESEND_API_KEY', 'POSTMARK_API_KEY', 'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY', 'SLACK_BOT_USER_OAUTH_TOKEN', 'LOG_SLACK_WEBHOOK_URL', 'LOG_CHANNEL'
  )
  foreach ($name in $publicEnvNames) { $envSaved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
}
$saoPassword = $null
# Set once the final box is printed. Until then an interruption (Ctrl+C
# included) must stop everything this start has begun, which the finally does.
$announced = $false

try {
  $db = Start-Process -FilePath $mysqld -WindowStyle Hidden -PassThru -ArgumentList `
    '--no-defaults', "--datadir=`"$dbData`"", "--port=$DbPort", '--bind-address=127.0.0.1', '--skip-name-resolve', `
    '--standalone', '--character-set-server=utf8mb4', '--collation-server=utf8mb4_unicode_ci'
  Write-PidFile
  for ($i = 0; $i -lt 120 -and -not (Test-Port $DbPort) -and -not $db.HasExited; $i++) { Start-Sleep -Seconds 1 }
  if (-not (Test-Port $DbPort)) { throw "The throwaway MariaDB did not start on port $DbPort. Its log is in $dbData (the .err file)." }

  $env:MYSQL_PWD = $dbPassword
  try {
    # The port can listen a moment before MariaDB (crash recovery after an
    # unclean stop) accepts connections, so retry until a 30 second deadline.
    # Each try is bounded to 10 seconds, so the worst case is about 40 seconds.
    $created = $false
    $createDeadline = (Get-Date).AddSeconds(30)
    while (-not $created -and (Get-Date) -lt $createDeadline) {
      $client = Start-Process -FilePath $mysqlClient -PassThru -WindowStyle Hidden -ArgumentList `
        '--no-defaults', '--connect-timeout=5', '-h', '127.0.0.1', '-P', "$DbPort", '-u', $dbUser, '-e', "`"CREATE DATABASE IF NOT EXISTS $dbName CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`""
      if ($client.WaitForExit(10000)) {
        $created = ($client.ExitCode -eq 0)
      } else {
        Stop-Process -Id $client.Id -Force -ErrorAction SilentlyContinue
      }
      if (-not $created) { Start-Sleep -Seconds 1 }
    }
    if (-not $created) { throw "Could not create the $dbName database." }
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

  if ($Public) {
    # The SAO account has full power over the throwaway data and the link is
    # public, so its documented seed password is replaced by a random one that
    # exists only in this console. It travels to artisan in an environment
    # variable (not a command line) and is removed again straight away.
    $saoPassword = New-RandomPassword 24
    $env:HIUSA_SAO_PW = $saoPassword
    Push-Location (Join-Path $root 'server')
    try {
      $tinkerCode = "`$u = App\Models\User::where('school_id', 990001)->firstOrFail(); `$u->password_hash = getenv('HIUSA_SAO_PW'); `$u->must_change_password = false; `$u->save(); echo 'sao-password-set';"
      $tinkerOut = & $php artisan tinker "--execute=$tinkerCode"
      if ($LASTEXITCODE -ne 0 -or (($tinkerOut -join ' ') -notmatch 'sao-password-set')) { throw "Could not set the per-run SAO password (exit $LASTEXITCODE). Nothing was published." }
    } finally {
      Pop-Location
      Remove-Item Env:\HIUSA_SAO_PW -ErrorAction SilentlyContinue
    }

    # Same-origin build served by `vite preview` (HIUSA_PUBLIC=1 turns on the /api,
    # /storage and /uploads proxy and the tunnel host name in client/vite.config.js),
    # then the tunnel, and only then the API, because the API needs the public link
    # for the file addresses it hands out (APP_URL) and for password reset links.
    New-Item -ItemType Directory -Force -Path $publicDir | Out-Null
    # A config file of our own keeps a stray ~/.cloudflared/config.yml from changing
    # the quick tunnel. It holds one harmless setting, because cloudflared logs an
    # error for a file with no settings at all.
    Set-Content -Path $publicConfig -Value 'loglevel: info'

    # The build, the preview server and the tunnel never need the database password
    # or the application key, so they do not get them. They are put back for the API.
    $held = Hide-Secrets
    try {
      $env:VITE_API_URL = '/api'
      Write-Host 'Building the client for the public link (this takes a minute)...'
      Push-Location (Join-Path $root 'client')
      try {
        & cmd.exe /c "npm run build -- --outDir `"$publicDist`" --emptyOutDir"
        if ($LASTEXITCODE -ne 0) { throw "npm run build failed (exit $LASTEXITCODE)." }
      } finally {
        Pop-Location
      }

      $env:HIUSA_PUBLIC = '1'
      $env:HIUSA_API_TARGET = "http://127.0.0.1:${ApiPort}"
      $web = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "npm run preview -- --host 127.0.0.1 --port $WebPort --strictPort --outDir `"$publicDist`"" `
        -WorkingDirectory (Join-Path $root 'client') -WindowStyle Hidden -PassThru
      Write-PidFile

      $tunnel = Start-Process -FilePath $cloudflared -WindowStyle Hidden -PassThru -ArgumentList `
        'tunnel', '--no-autoupdate', '--config', "`"$publicConfig`"", '--logfile', "`"$publicLog`"", '--url', "http://127.0.0.1:${WebPort}"
      Write-PidFile
    } finally {
      Restore-Env $held
    }

    # The quick tunnel prints its address (a random name under trycloudflare.com)
    # in its log; api.trycloudflare.com is the service it registers with, not the link.
    $publicUrl = $null
    for ($i = 0; $i -lt $TunnelWaitSeconds -and -not $publicUrl -and -not $tunnel.HasExited; $i++) {
      Start-Sleep -Seconds 1
      if (Test-Path $publicLog) {
        $logText = [string](Get-Content -Path $publicLog -Raw -ErrorAction SilentlyContinue)
        $publicUrl = [regex]::Matches($logText, 'https://[a-z0-9-]{1,63}\.trycloudflare\.com') |
          ForEach-Object { $_.Value } | Where-Object { $_ -ne 'https://api.trycloudflare.com' } | Select-Object -First 1
      }
    }
    if (-not $publicUrl) {
      throw "cloudflared did not print a trycloudflare.com address in $TunnelWaitSeconds seconds."
    }

    # Behind the tunnel the API sees plain HTTP from 127.0.0.1. Trusting the local
    # proxy chain lets it read the real client address (so the per-IP limits count
    # each tester separately) and the https host name.
    $env:APP_URL = $publicUrl
    $env:FRONTEND_URL = $publicUrl
    $env:TRUSTED_PROXIES = '127.0.0.1'
    # The public copy sends no mail and calls no outside service, whatever
    # server/.env holds: process variables win over it, and non-empty
    # placeholders keep the app from falling back to the .env values.
    $env:MAIL_MAILER = 'log'
    $env:MAIL_USERNAME = 'disabled-for-public-demo'
    $env:MAIL_PASSWORD = 'disabled-for-public-demo'
    if ($EnableAi) {
      # AI helpers on. The Groq key and address are deliberately NOT set here: the
      # API reads them from server/.env itself, so the key is never on a command
      # line, in a log, or in the environment of any other process. The local AI
      # engine gets a fresh key for this run, shared with the API only.
      $aiKey = New-RandomPassword 32
      $env:HIUSA_AI_SERVICE_ENABLED = 'true'
      $env:HIUSA_AI_SERVICE_KEY = $aiKey
      $env:HIUSA_AI_SERVICE_URL = "http://127.0.0.1:${aiPort}"
      $env:HIUSA_AI_SERVICE_AUTH_DISABLED = 'false'
      $env:HIUSA_AI_HOST = '127.0.0.1'
      $env:HIUSA_AI_PORT = "$aiPort"
      $env:HIUSA_AI_RELOAD = 'false'

      # Process variables win over ai-service/.env (python-dotenv does not override
      # them). The engine reads only the service key, the auth opt-out and the task
      # weights, and never gets the database password, the app key or the Groq key.
      $heldAi = Hide-Secrets
      try {
        $ai = Start-Process -FilePath $aiPython -ArgumentList 'run.py' -WorkingDirectory $aiDir -WindowStyle Hidden -PassThru `
          -RedirectStandardOutput $publicAiLog -RedirectStandardError $publicAiErrLog
        Write-PidFile
      } finally {
        Restore-Env $heldAi
      }
      $aiUp = $false
      for ($i = 0; $i -lt 30 -and -not $aiUp -and -not $ai.HasExited; $i++) {
        try {
          $aiUp = ((Invoke-WebRequest -Uri "http://127.0.0.1:${aiPort}/health" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200)
        } catch {
          Start-Sleep -Seconds 1
        }
      }
      if (-not $aiUp) {
        throw "The local AI engine did not answer on 127.0.0.1:$aiPort within 30 seconds. Its logs are $publicAiLog and $publicAiErrLog."
      }
    } else {
      $env:HIUSA_AI_SERVICE_ENABLED = 'false'
      # '(null)' reads as null in Laravel's env(), and the Groq client makes no call
      # without a key; the dead address is a second barrier.
      $env:HIUSA_AI_SERVICE_KEY = '(null)'
      $env:GROQ_API_KEY = '(null)'
      $env:GROQ_API_URL = 'http://127.0.0.1:9/disabled'
    }
    $env:FINGERPRINT_MATCHER_DRIVER = 'unavailable'
    $env:FINGERPRINT_MATCHER_KEY = '(null)'
    $env:RESEND_API_KEY = 'disabled-for-public-demo'
    $env:POSTMARK_API_KEY = 'disabled-for-public-demo'
    $env:AWS_ACCESS_KEY_ID = 'disabled-for-public-demo'
    $env:AWS_SECRET_ACCESS_KEY = 'disabled-for-public-demo'
    $env:SLACK_BOT_USER_OAUTH_TOKEN = 'disabled-for-public-demo'
    $env:LOG_SLACK_WEBHOOK_URL = 'disabled-for-public-demo'
    $env:LOG_CHANNEL = 'single'
    $api = Start-Process -FilePath $php -ArgumentList 'artisan', 'serve', '--host=127.0.0.1', "--port=$ApiPort", '--no-reload' `
      -WorkingDirectory (Join-Path $root 'server') -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput $publicApiLog -RedirectStandardError $publicApiErrLog
    Write-PidFile
  } else {
    # --no-reload keeps artisan serve from stripping the DB_* variables above and
    # re-reading server/.env (which may point at another database).
    $api = Start-Process -FilePath $php -ArgumentList 'artisan', 'serve', '--host=0.0.0.0', "--port=$ApiPort", '--no-reload' `
      -WorkingDirectory (Join-Path $root 'server') -WindowStyle Minimized -PassThru

    $env:VITE_API_URL = "http://${HostIp}:${ApiPort}/api"
    $web = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "npm run dev -- --host 0.0.0.0 --port $WebPort --strictPort" `
      -WorkingDirectory (Join-Path $root 'client') -WindowStyle Minimized -PassThru

    Write-PidFile
  }

  if (-not $Public) {
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
  }

  for ($i = 0; $i -lt 60 -and -not ((Test-Port $ApiPort) -and (Test-Port $WebPort)); $i++) { Start-Sleep -Seconds 1 }
  if (-not ((Test-Port $ApiPort) -and (Test-Port $WebPort))) {
    if ($Public) {
      throw "The API or the preview server did not come up in 60 seconds. The processes are hidden; their logs are $publicApiErrLog (API) and $publicLog (tunnel)."
    }
    Write-Warning 'The API or the client did not come up in 60 seconds. Check the two minimized windows for errors.'
  }

  # The scheduler starts last, once the API is up, and is recorded for -Stop and for cleanup.
  $scheduler = Start-Scheduler
  Write-PidFile
  Start-Sleep -Seconds 2
  $schedulerLine = 'Scheduler: running (elections open and close on their own, reminders and scheduled notices work)'
  if ($scheduler.HasExited) {
    $schedulerLogDir = if ($Public) { $publicDir } else { $dbDir }
    $schedulerErrPath = Join-Path $schedulerLogDir 'scheduler-error.log'
    if ($Public) { throw "The scheduler stopped right after it started. See $schedulerErrPath." }
    Write-Warning "The scheduler stopped right after it started, so elections will not open on their own and reminders will not run. See $schedulerErrPath."
    $schedulerLine = 'Scheduler: NOT running (see the warning above)'
  }

  Write-Host ''
  if ($Public) {
    # Quick tunnel names can take a few seconds to resolve; check from here before announcing it.
    $reachable = $false
    $probeEnd = (Get-Date).AddSeconds(45)
    while (-not $reachable -and (Get-Date) -lt $probeEnd) {
      try {
        $reachable = ((Invoke-WebRequest -Uri $publicUrl -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200)
      } catch {
        Start-Sleep -Seconds 1
      }
    }
    if (-not $reachable) {
      Write-Warning "The public link did not answer from this computer within 45 seconds. Wait a moment and try it; if it never opens, run -Stop and start again."
    }
    Write-Host '=================================================================='
    Write-Host "  PUBLIC LINK for your members (phones and laptops, anywhere):"
    Write-Host "  $publicUrl"
    Write-Host ''
    Write-Host "  SAO 990001 password for this run: $saoPassword"
    Write-Host '  (give it only to the person who plays the SAO; it is not saved anywhere)'
    Write-Host '=================================================================='
    $announced = $true
    Write-Host 'The link changes every time this is started. Anyone who has it can open the app and try the demo accounts: throwaway seeded data only, no real student data.'
    Write-Warning 'The other demo passwords in docs/MEMBER_TESTING.md (Demo@12345 for the Admin, Department Head, officer and student accounts) are public knowledge: anyone holding the link can use them. Share the link only with the team.'
    if ($EnableAi) {
      Write-Host 'AI helpers: ON (Groq text and the local AI engine). Mail: off.'
      Write-Host "Groq writes announcement drafts, event plans, budget advice, forecasts, task recommendations and financial report summaries with the Groq key in server/.env, so testers use up that quota. Password reset emails do not arrive (this script forces the log mailer)."
    } else {
      Write-Host 'Mail is switched off in this copy (password reset emails do not arrive) and the AI helpers are off.'
    }
    Write-Host "Reminder: the data is the throwaway database $dbName on 127.0.0.1:$DbPort (not the development database). Uploaded files land on this computer's disk. Quick tunnels have no uptime guarantee."
    Write-Host $schedulerLine
    Write-Host 'Test accounts and journeys: docs/MEMBER_TESTING.md (use the fresh seed table)'
    Write-Host 'Wipe and reseed with: powershell -ExecutionPolicy Bypass -File scripts\serve-lan.ps1 -Reset -Public'
    Write-Host 'STOP the public link when the test ends: powershell -ExecutionPolicy Bypass -File scripts\serve-lan.ps1 -Stop'
  } else {
    Write-Host "Share this address with your teammates (same network):  http://${HostIp}:${WebPort}"
    if ($otherAddresses.Count -gt 0) {
      Write-Host "This computer is on more than one network. Teammates must be on the network of $HostIp. For the other network use -HostIp, for example: -HostIp $($otherAddresses[0])"
    }
    Write-Host $firewall
    Write-Host "Reminder: plain HTTP, demo passwords, throwaway seeded database $dbName on 127.0.0.1:$DbPort (not the development database). Trusted network only."
    Write-Host $schedulerLine
    Write-Host 'Test accounts and journeys: docs/MEMBER_TESTING.md (use the fresh seed table)'
    Write-Host 'Wipe and reseed with: powershell -ExecutionPolicy Bypass -File scripts\serve-lan.ps1 -Reset'
    Write-Host 'Stop with: powershell -ExecutionPolicy Bypass -File scripts\serve-lan.ps1 -Stop'
  }
} catch {
  if ($Public) {
    # A failed public start must not leave a tunnel (or the API behind it) running.
    Write-Host "The public start failed: $($_.Exception.Message)"
    foreach ($logFile in @($publicLog, $publicApiErrLog)) {
      if (Test-Path $logFile) {
        Write-Host "Last lines of ${logFile}:"
        Get-Content -Path $logFile -Tail 8 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $_" }
      }
    }
  }
  throw
} finally {
  if ($Public) {
    # Failed or interrupted (Ctrl+C) before the link was announced: stop everything
    # this start has begun, so no tunnel is left running. Harmless if it already ran.
    if (-not $announced) {
      Write-Host 'The public start did not finish: stopping the tunnel, the API, the preview server and the throwaway database.'
      try { $null = Stop-OwnProcesses } catch { }
      try { Remove-PublicBuild } catch { }
    }
    Restore-Env $envSaved
  }
}
