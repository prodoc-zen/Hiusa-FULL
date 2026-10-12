<#
.SYNOPSIS
    Resets the staging demo server (Lightsail 13.228.227.182) to a clean demo state.

.DESCRIPTION
    Encodes the proven reseed procedure as one command. It WIPES the demo
    database (migrate:fresh --seed) and rebuilds it, so everything entered on
    the site since the last reseed is lost. A backup is taken first.

    Steps, each printed before it runs; the run stops on the first failure:
      1  Preflight: ssh reachable, units known to systemd, backup directory present.
      2  Backup: mysqldump of hiusa_db and a tar.gz of server/storage/app and
         server/public/uploads into /var/backups/hiusa, verified with gzip -t and
         a CREATE TABLE count that must equal the live table count.
      3  Stop hiusa-queue and hiusa-scheduler, config:clear.
      4  migrate:fresh --seed --force with APP_ENV=staging.
      5  Add four extra colleges with colleges:sync.
      6  Create Department Head accounts 940006 to 940009 (checked in the same script).
      7  Give SAO 990001 a random 24 character password generated on the server and
         handed to PHP on stdin (never in a command line, an environment variable
         or a file). It is printed once, at the very end of the run.
      8  config:cache, start the queue and scheduler, confirm they are active.
      9  Verify from this machine over HTTP (page, /up, nine logins, old SAO
         password rejected, new SAO password accepted) and the server counts
         (39 users, 9 department heads, 1 SUPER_ADMIN, 9 colleges).
      10 Demo journey prep over the public API (skipped with -SkipDemoPrep, and not
         run if step 9 was red). It uses the demo accounts only, never the SAO:
         Admin 900001 proposes 'Demo Student Council Election' (open now, closes in
         3 days), Department Head 940001 approves it, the Admin adds party list
         'Demo Party', candidate 2100389 and finalizes it, so students can vote.
         Then the Admin creates the task 'Prepare the registration desk' for
         Officer 900004 and, best effort, an 'Org membership fee' invoice of
         150.00 for Student 2100142. Each sub-step prints PASS or FAIL. It is
         idempotent: an existing active election, task or invoice with those
         titles is reused. A failed election or task fails the run (exit 1); the
         invoice is best effort.

    SAFETY
      * The default is a DRY RUN: it prints every step and the commands and
        connects to nothing (no ssh process is started).
      * A real run needs -Execute and the exact word RESET typed at a prompt
        (-Force together with -Execute skips the prompt).
      * The script refuses any host other than 13.228.227.182 unless
        -AllowOtherHost is given.
      * The restore commands are printed, never run.
      * However the run ends (success, failed step, Ctrl+C) a summary is printed:
        whether the wipe step had started, the backup file names (only if the
        backup step succeeded), the restore commands, the SAO password if step 7
        completed (or unverified, or a warning if its state is unknown or still the
        public default), retry advice for the step that ended the run, and the
        recovery commands that start the queue and scheduler. If the wipe step was
        interrupted, keep that run's backup (the last good one) and run the script
        again; step 2 accepts an empty database for that case.
      * -BaseUrl must be https and on the same host as -HostName, or the run is
        refused (-AllowOtherHost waives only the https rule, with a warning).
      * Verification uses https and normal certificate validation (TLS 1.2, and
        1.3 when available). Certificate checks are never skipped.

    USAGE
      .\scripts\reseed-staging.ps1                      dry run, prints the plan
      .\scripts\reseed-staging.ps1 -Execute             real run, asks for RESET
      .\scripts\reseed-staging.ps1 -Execute -Force      real run, no prompt
      .\scripts\reseed-staging.ps1 -DemoPrepOnly        dry run of step 10 only
      .\scripts\reseed-staging.ps1 -DemoPrepOnly -Execute   run step 10 only

    Takes roughly five minutes (migrate:fresh --seed and the dump dominate; the
    login checks may wait up to a minute for the per-IP login throttle).
    Exit code: 0 all steps and checks green, 1 a step or check failed (this
    includes a failed election or task in step 10), 2 refused or aborted before
    touching the server.

.PARAMETER HostName
    Server address. Defaults to 13.228.227.182; any other value is refused
    unless -AllowOtherHost is given.

.PARAMETER User
    SSH user. Defaults to ubuntu.

.PARAMETER KeyPath
    SSH private key. Defaults to the HIUSA_SSH_KEY environment variable, else
    $env:USERPROFILE\.ssh\hiusa-lightsail.pem. The key is only passed to ssh -i.

.PARAMETER BaseUrl
    Where the verification requests go. Defaults to https://<HostName>. Must be
    https and on the host named by -HostName; -AllowOtherHost waives the https rule
    only (a test copy), with a warning.

.PARAMETER Execute
    Actually run against the server. Without it nothing is contacted.

.PARAMETER Force
    With -Execute, skip the RESET prompt.

.PARAMETER AllowOtherHost
    Permit a -HostName other than 13.228.227.182.

.PARAMETER SkipDemoPrep
    Leave out step 10 (the demo election, officer task and student invoice).

.PARAMETER DemoPrepOnly
    Run only step 10 (demo journey prep) against the live site over the public
    API: no ssh, no backup, no wipe, no RESET prompt (it writes only demo data and
    is idempotent). Still a dry run unless -Execute is given, and refused for any
    host other than 13.228.227.182. Cannot be combined with -SkipDemoPrep.

.PARAMETER DumpScripts
    Dry run helper: write each remote script (step1.sh ... step9.sh) and each
    embedded PHP snippet to this directory so they can be linted with bash -n
    and php -l. Contacts nothing.
#>
[CmdletBinding()]
param(
    [string]$HostName = '13.228.227.182',
    [string]$User = 'ubuntu',
    [string]$KeyPath = $(if ($env:HIUSA_SSH_KEY) { $env:HIUSA_SSH_KEY } else { Join-Path $env:USERPROFILE '.ssh\hiusa-lightsail.pem' }),
    [string]$BaseUrl = '',
    [switch]$Execute,
    [switch]$Force,
    [switch]$AllowOtherHost,
    [switch]$SkipDemoPrep,
    [switch]$DemoPrepOnly,
    [string]$DumpScripts = ''
)

$ErrorActionPreference = 'Stop'

$StagingHost = '13.228.227.182'
$DemoPassword = 'Demo@12345'
$OldAdminPassword = 'Admin@123456'

if ($HostName -ne $StagingHost -and -not $AllowOtherHost) {
    Write-Host "REFUSED: this script only resets the staging server $StagingHost, not '$HostName'. Pass -AllowOtherHost to override." -ForegroundColor Red
    exit 2
}
if ($DemoPrepOnly -and $SkipDemoPrep) {
    Write-Host 'REFUSED: -DemoPrepOnly runs only step 10, so it cannot be combined with -SkipDemoPrep.' -ForegroundColor Red
    exit 2
}
if (-not $BaseUrl) { $BaseUrl = "https://$HostName" }
$BaseUrl = $BaseUrl.TrimEnd('/')

# The verification requests must go to the host being reset, over https. Only the scheme rule can be
# waived, and only with -AllowOtherHost (a test copy without TLS).
$baseUri = $null
if (-not [Uri]::TryCreate($BaseUrl, [UriKind]::Absolute, [ref]$baseUri)) {
    Write-Host "REFUSED: -BaseUrl '$BaseUrl' is not an absolute URL." -ForegroundColor Red
    exit 2
}
if (-not [string]::Equals($baseUri.Host, $HostName, [StringComparison]::OrdinalIgnoreCase)) {
    Write-Host "REFUSED: -BaseUrl host '$($baseUri.Host)' is not -HostName '$HostName'. The checks must hit the server being reset." -ForegroundColor Red
    exit 2
}
if ($baseUri.Scheme -ne 'https') {
    if (-not $AllowOtherHost) {
        Write-Host "REFUSED: -BaseUrl '$BaseUrl' must be https (the site answers 301 on http and Windows PowerShell 5.1 turns a redirected POST into a GET). Pass -AllowOtherHost to waive this for a test copy." -ForegroundColor Red
        exit 2
    }
    Write-Host "WARN: -BaseUrl '$BaseUrl' is not https; allowed only because -AllowOtherHost was given." -ForegroundColor Yellow
}

# The site answers 301 on http, and Windows PowerShell 5.1 turns a redirected POST into a GET,
# so every request goes to https. Certificate validation stays on.
$protocols = [Net.SecurityProtocolType]::Tls12
if ([enum]::GetNames([Net.SecurityProtocolType]) -contains 'Tls13') {
    $protocols = $protocols -bor [Net.SecurityProtocolType]::Tls13
}
[Net.ServicePointManager]::SecurityProtocol = $protocols

$Stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$BackupDir = '/var/backups/hiusa'
$DbDump = "$BackupDir/hiusa_db-pre-demo-reseed-$Stamp.sql.gz"
$FilesDump = "$BackupDir/hiusa_files-pre-demo-reseed-$Stamp.tar.gz"
# The dump is root-owned mode 600, so both the read and the mysql client need sudo; without
# sudo on zcat, mysql reads empty input and exits 0 having restored nothing.
$RestoreDb = "sudo zcat $DbDump | sudo mysql hiusa_db"
$RestoreCheck = 'sudo mysql hiusa_db -e "SELECT COUNT(*) FROM users"'
$RestoreFiles = "sudo tar -xzpf $FilesDump -C /var/www/hiusa/server"

$script:Live = $false
$script:RemoteExe = 'ssh'
$script:RemoteArgs = ''
$script:SaoPw = $null
$script:BackupTaken = $false
$script:ServicesTouched = $false
$script:WipeStarted = $false
$script:WipeDone = $false
$script:Step7Started = $false
$script:Step7Done = $false
$script:CurrentStep = 0
$script:RemoteProc = $null
$script:RemoteKilled = $false
$script:ExitCode = 1

# ---------------------------------------------------------------------------
# Remote scripts. Each body runs under `bash -s` on the server, wrapped in a
# function so bash reads all of it before running anything (a command that
# reads stdin, such as mysql or tinker, cannot swallow the rest of the script).
# ---------------------------------------------------------------------------

$Step1 = @'
echo "connected: $(whoami)@$(hostname)"
sudo -n true
for s in hiusa-queue hiusa-scheduler nginx php8.3-fpm mysql; do
  load=$(systemctl show -p LoadState --value "$s")
  act=$(systemctl is-active "$s" || true)
  echo "unit $s load=$load active=$act"
  if [ "$load" != "loaded" ]; then echo "FAIL: unit $s is not known to systemd"; exit 1; fi
done
if [ ! -d /var/backups/hiusa ]; then echo "FAIL: /var/backups/hiusa does not exist"; exit 1; fi
if [ ! -x /usr/local/bin/hiusa-artisan ]; then echo "FAIL: /usr/local/bin/hiusa-artisan is missing"; exit 1; fi
if [ ! -d /var/www/hiusa/server/storage/app ]; then echo "FAIL: /var/www/hiusa/server/storage/app is missing"; exit 1; fi
df -h /var/backups/hiusa | tail -n 1
echo "preflight ok"
'@

$Step2 = @'
if [ -e "$DB" ] || [ -e "$FILES" ]; then echo "FAIL: backup name already exists"; exit 1; fi
sudo mysqldump --single-transaction --routines --triggers hiusa_db | gzip | sudo tee "$DB" > /dev/null
paths="storage/app"
if [ -d /var/www/hiusa/server/public/uploads ]; then
  paths="$paths public/uploads"
else
  echo "WARN: server/public/uploads does not exist, archiving storage/app only"
fi
sudo tar -czf "$FILES" -C /var/www/hiusa/server $paths
sudo chmod 600 "$DB" "$FILES"
sudo gzip -t "$DB"
sudo gzip -t "$FILES"
exists=$(sudo mysql -N -B -e "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='hiusa_db'")
if [ "$exists" != "1" ]; then echo "FAIL: database hiusa_db does not exist"; exit 1; fi
live=$(sudo mysql -N -B -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='hiusa_db' AND table_type='BASE TABLE'")
dumped=$(sudo zcat "$DB" | grep -c '^CREATE TABLE' || true)
echo "tables live=$live dump=$dumped"
if [ "$live" = "0" ]; then
  echo "WARN: hiusa_db exists but has no tables (an earlier wipe was probably interrupted). There is nothing to lose, so the table count check is skipped."
  echo "WARN: this dump is empty. If you need the data, restore the backup of the earlier run instead."
elif [ "$live" != "$dumped" ]; then
  echo "FAIL: the dump does not hold as many CREATE TABLE lines as the live database has tables"
  exit 1
fi
sudo ls -l "$DB" "$FILES"
echo "backup ok"
'@

$Step3 = @'
sudo systemctl stop hiusa-queue hiusa-scheduler
for s in hiusa-queue hiusa-scheduler; do
  if systemctl is-active --quiet "$s"; then echo "FAIL: $s is still active"; exit 1; fi
  echo "stopped $s"
done
sudo -u www-data /usr/local/bin/hiusa-artisan config:clear
'@

$Step4 = @'
sudo -u www-data env APP_ENV=staging APP_DEBUG=false /usr/local/bin/hiusa-artisan migrate:fresh --seed --force
'@

$Step5 = @'
F=$(mktemp)
trap 'rm -f "$F"' EXIT
cat > "$F" <<'LISTEOF'
College of Criminal Justice Education
College of Hospitality, Tourism and Customs Administration |
College of Maritime Education
College of Nursing
LISTEOF
chmod 644 "$F"
sudo -u www-data /usr/local/bin/hiusa-artisan colleges:sync "$F" < /dev/null
rm -f "$F"
echo "colleges file removed"
'@

$PhpDeans = @'
$heads = [
    [940006, 'College of Criminal Justice Education', 'Dean CJE', 'dean.cje@hiusa.local'],
    [940007, 'College of Hospitality, Tourism and Customs Administration', 'Dean CHTCA', 'dean.chtca@hiusa.local'],
    [940008, 'College of Maritime Education', 'Dean CME', 'dean.cme@hiusa.local'],
    [940009, 'College of Nursing', 'Dean CON', 'dean.con@hiusa.local'],
];
foreach ($heads as $h) {
    $orgId = \App\Models\Organization::where('organization_type', 'COLLEGE')->whereIn('college_id', \App\Models\College::where('name', $h[1])->select('id'))->value('id');
    if (! $orgId) {
        echo 'RESULT '.$h[0]." FAIL no home organization for the college\n";
        continue;
    }
    \App\Models\User::updateOrCreate(['school_id' => $h[0]], [
        'organization_id' => $orgId,
        'first_name' => 'Demo',
        'last_name' => $h[2],
        'email' => $h[3],
        'password_hash' => 'Demo@12345',
        'role' => 'DEPARTMENT_HEAD',
        'department' => $h[1],
        'is_member' => true,
        'account_status' => 'active',
    ]);
}
foreach ($heads as $h) {
    $u = \App\Models\User::where('school_id', $h[0])->first();
    $n = \Illuminate\Support\Facades\DB::table('account_profiles')->where('user_school_id', $h[0])->count();
    $ok = $u && $u->role === 'DEPARTMENT_HEAD' && $u->department === $h[1] && $u->email === $h[3] && (bool) $u->is_member
        && $n === 1 && \Illuminate\Support\Facades\Hash::check('Demo@12345', $u->password_hash);
    echo 'RESULT '.$h[0].' '.($ok ? 'OK' : 'FAIL').' profiles='.$n."\n";
}
'@

$Step6 = @'
IFS= read -r -d '' PHP <<'PHPEOF' || true
__PHP__
PHPEOF
OUT=$(sudo -u www-data env HOME=/tmp XDG_CONFIG_HOME=/tmp /usr/local/bin/hiusa-artisan tinker --execute="$PHP" 2>&1 < /dev/null) || { echo "$OUT"; echo "FAIL: tinker exited non-zero"; exit 1; }
echo "$OUT"
ok=$(printf '%s\n' "$OUT" | grep -c 'RESULT 94000[6-9] OK profiles=1' || true)
if [ "$ok" -ne 4 ]; then echo "FAIL: expected 4 RESULT OK lines, found $ok (empty output is not success)"; exit 1; fi
echo "department heads ok"
'@.Replace('__PHP__', $PhpDeans.TrimEnd())

$PhpSao = @'
$pw = trim((string) file_get_contents('php://stdin'));
if (strlen($pw) < 24) {
    echo "RESULT SAO FAIL no password on stdin\n";
} else {
    $u = \App\Models\User::where('school_id', 990001)->first();
    if (! $u) {
        echo "RESULT SAO FAIL account 990001 not found\n";
    } else {
        $u->update(['password_hash' => $pw, 'must_change_password' => false]);
        $u = \App\Models\User::where('school_id', 990001)->first();
        $new = \Illuminate\Support\Facades\Hash::check($pw, $u->password_hash);
        $old = \Illuminate\Support\Facades\Hash::check('Admin@123456', $u->password_hash);
        $ok = $new && ! $old && ! $u->must_change_password;
        echo 'RESULT SAO '.($ok ? 'OK' : 'FAIL').' new_matches='.($new ? 'yes' : 'no').' old_matches='.($old ? 'yes' : 'no')."\n";
    }
}
'@

$Step7 = @'
set +o pipefail
PW=$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 24)
set -o pipefail
if [ "${#PW}" -ne 24 ]; then echo "FAIL: could not generate a 24 character password"; exit 1; fi
IFS= read -r -d '' PHP <<'PHPEOF' || true
__PHP__
PHPEOF
# The password goes to PHP on stdin (printf is a shell builtin), so it is never in a command line,
# the auth log, ps or the environment. tinker --execute does not read stdin itself.
OUT=$(printf '%s' "$PW" | sudo -u www-data env HOME=/tmp XDG_CONFIG_HOME=/tmp /usr/local/bin/hiusa-artisan tinker --execute="$PHP" 2>&1) || { echo "$OUT"; echo "FAIL: tinker exited non-zero"; exit 1; }
echo "$OUT"
ok=$(printf '%s\n' "$OUT" | grep -c 'RESULT SAO OK new_matches=yes old_matches=no' || true)
if [ "$ok" -ne 1 ]; then echo "FAIL: the SAO password check did not report OK (empty output is not success)"; exit 1; fi
echo "SAO password set and verified on the server"
echo "SAOPW:$PW"
'@.Replace('__PHP__', $PhpSao.TrimEnd())

$Step8 = @'
sudo -u www-data /usr/local/bin/hiusa-artisan config:cache
sudo systemctl start hiusa-queue hiusa-scheduler
sleep 3
for s in hiusa-queue hiusa-scheduler; do
  if ! systemctl is-active --quiet "$s"; then echo "FAIL: $s is not active"; exit 1; fi
  echo "active $s"
done
'@

$Step9Counts = @'
sudo mysql -N -B hiusa_db -e "SELECT CONCAT('COUNT role_', role, ' ', COUNT(*)) FROM users GROUP BY role; SELECT CONCAT('COUNT users_total ', COUNT(*)) FROM users; SELECT CONCAT('COUNT colleges ', COUNT(*)) FROM colleges;"
'@

function Build-RemoteScript {
    param([string]$Body, [string]$Prelude = '')
    $text = "set -euo pipefail`nmain() {`n" + $Prelude + $Body + "`n}`nmain`n"
    return ($text -replace "`r`n", "`n")
}

function Invoke-Remote {
    param([string]$Body, [string]$Prelude = '')
    if (-not $script:Live) { throw 'Invoke-Remote was called outside a live run.' }
    $text = Build-RemoteScript -Body $Body -Prelude $Prelude
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $script:RemoteExe
    $psi.Arguments = $script:RemoteArgs
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $psi.CreateNoWindow = $true
    # Windows PowerShell 5.1 has no StandardInputEncoding: Process builds the stdin writer
    # from Console.InputEncoding, whose UTF-8 byte order mark would reach bash as junk
    # on line 1. Swap in a BOM-less UTF-8 for the Start call only.
    $previousInput = [Console]::InputEncoding
    try {
        [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
        $proc = [System.Diagnostics.Process]::Start($psi)
    } finally {
        [Console]::InputEncoding = $previousInput
    }
    # Kept so the run-end block can stop it if the run is interrupted (Ctrl+C) or fails.
    $script:RemoteProc = $proc
    $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($text)
    $proc.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
    $proc.StandardInput.Close()
    $lines = New-Object System.Collections.Generic.List[string]
    while ($true) {
        # Poll instead of a blocking ReadLine so a Ctrl+C reaches PowerShell between polls.
        $pending = $proc.StandardOutput.ReadLineAsync()
        while (-not $pending.Wait(250)) { }
        $line = $pending.Result
        if ($null -eq $line) { break }
        if ($line.StartsWith('SAOPW:')) {
            # Held in memory only; printed once at the end of the run.
            $script:SaoPw = $line.Substring(6).Trim()
            continue
        }
        Write-Host "    $line"
        $lines.Add($line)
    }
    $proc.WaitForExit()
    $script:RemoteProc = $null
    return [pscustomobject]@{ ExitCode = $proc.ExitCode; Lines = $lines.ToArray() }
}

function Invoke-Http {
    param([string]$Method, [string]$Url, [hashtable]$Headers = @{}, $Body = $null, [string]$ContentType = 'application/json')
    for ($try = 0; $try -lt 3; $try++) {
        $status = 0
        $wait = 62
        $text = ''
        try {
            $req = @{ Uri = $Url; Method = $Method; UseBasicParsing = $true; Headers = $Headers; TimeoutSec = 60 }
            if ($Body) { $req.Body = $Body; $req.ContentType = $ContentType }
            $answer = Invoke-WebRequest @req
            $status = [int]$answer.StatusCode
            $text = [string]$answer.Content
        } catch {
            $resp = $_.Exception.Response
            if ($resp) {
                $status = [int]$resp.StatusCode
                $after = 0
                if ($status -eq 429 -and [int]::TryParse([string]$resp.Headers['Retry-After'], [ref]$after) -and $after -gt 0) {
                    $wait = [Math]::Min($after + 2, 65)
                }
                # Windows PowerShell 5.1 has already read the error body into ErrorDetails; the stream is empty.
                $text = ''
                if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $text = [string]$_.ErrorDetails.Message }
            } else {
                $text = $_.Exception.Message
            }
        }
        if ($status -ne 429) { return [pscustomobject]@{ Status = $status; Text = $text } }
        Write-Host "    throttled (429), waiting $wait s" -ForegroundColor Yellow
        Start-Sleep -Seconds $wait
    }
    return [pscustomobject]@{ Status = 429; Text = '' }
}

function Get-HttpStatus {
    param([string]$Method, [string]$Url, [hashtable]$Headers = @{}, [string]$Body = '')
    return (Invoke-Http -Method $Method -Url $Url -Headers $Headers -Body $Body).Status
}

# ---------------------------------------------------------------------------
# Step 10: demo journey prep, over the public API only. It mirrors the proven
# sequence in client/e2e/journeys/student.spec.js (seedOpenElection, ensureInvoice)
# and officer.spec.js (O3 task). Accounts and the shared demo password are the
# ones step 9 already verified; the SAO is never used.
# ---------------------------------------------------------------------------
function Write-Sub {
    param([string]$Result, [string]$Name, [string]$Detail = '')
    $color = switch ($Result) { 'PASS' { 'Green' } 'FAIL' { 'Red' } default { 'Yellow' } }
    Write-Host ("    {0} {1}: {2}" -f $Result, $Name, $Detail) -ForegroundColor $color
}

function Stop-DemoPrep {
    param([string]$Name, [string]$Reason)
    Write-Sub -Result 'FAIL' -Name $Name -Detail $Reason
    throw "$Name failed: $Reason"
}

function Get-ApiReason {
    param($Answer)
    $why = ''
    if ($Answer.Body -and $Answer.Body.message) {
        $why = [string]$Answer.Body.message
    } elseif ($Answer.Text) {
        $why = [string]$Answer.Text
        if ($why.Length -gt 200) { $why = $why.Substring(0, 200) }
    }
    return "HTTP $($Answer.Status) $why".Trim()
}

function ConvertTo-Items {
    param($Value)
    $out = New-Object System.Collections.Generic.List[object]
    foreach ($item in @($Value)) { if ($null -ne $item) { $out.Add($item) } }
    return $out.ToArray()
}

function Invoke-Api {
    param([string]$Token, [string]$Method, [string]$Path, $Body = $null, [string]$ContentType = 'application/json')
    $headers = @{ Accept = 'application/json' }
    if ($Token) { $headers.Authorization = "Bearer $Token" }
    $payload = $Body
    if ($Body -is [System.Collections.IDictionary]) { $payload = ConvertTo-Json -Compress -Depth 5 $Body }
    $answer = Invoke-Http -Method $Method -Url "$BaseUrl/api$Path" -Headers $headers -Body $payload -ContentType $ContentType
    $parsed = $null
    if ($answer.Text) { try { $parsed = ConvertFrom-Json -InputObject $answer.Text } catch { $parsed = $null } }
    return [pscustomobject]@{ Status = $answer.Status; Body = $parsed; Text = $answer.Text }
}

function Get-ApiToken {
    param([int]$SchoolId)
    $answer = Invoke-Api -Token '' -Method Post -Path '/login' -Body @{ school_id = $SchoolId; password = $DemoPassword }
    if ($answer.Status -ne 200 -or -not $answer.Body -or -not $answer.Body.access_token) {
        Stop-DemoPrep -Name "login $SchoolId" -Reason (Get-ApiReason $answer)
    }
    return [string]$answer.Body.access_token
}

# Same bytes as minimalPdf() in client/e2e/support/live.js: a valid one page PDF.
function New-InformativeLetterPdf {
    $text = 'BT /F1 18 Tf 40 100 Td (Informative letter) Tj ET'
    $objects = @(
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
        "<< /Length $($text.Length) >>`nstream`n$text`nendstream",
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
    )
    $body = "%PDF-1.4`n"
    $offsets = @()
    for ($i = 0; $i -lt $objects.Count; $i++) {
        $offsets += $body.Length
        $body += "$($i + 1) 0 obj`n$($objects[$i])`nendobj`n"
    }
    $xref = $body.Length
    $body += "xref`n0 $($objects.Count + 1)`n0000000000 65535 f `n"
    foreach ($offset in $offsets) { $body += ('{0:D10} 00000 n ' -f $offset) + "`n" }
    $body += "trailer`n<< /Size $($objects.Count + 1) /Root 1 0 R >>`nstartxref`n$xref`n%%EOF`n"
    return $body
}

function New-MultipartBody {
    param([string]$Boundary, [System.Collections.Specialized.OrderedDictionary]$Fields, [string]$FileField, [string]$FileName, [string]$FileText)
    $nl = "`r`n"
    $sb = New-Object System.Text.StringBuilder
    foreach ($key in $Fields.Keys) {
        [void]$sb.Append("--$Boundary$nl" + "Content-Disposition: form-data; name=`"$key`"$nl$nl" + [string]$Fields[$key] + $nl)
    }
    [void]$sb.Append("--$Boundary$nl" + "Content-Disposition: form-data; name=`"$FileField`"; filename=`"$FileName`"$nl" + "Content-Type: application/pdf$nl$nl" + $FileText + $nl)
    [void]$sb.Append("--$Boundary--$nl")
    # Every byte is ASCII, so a string body goes on the wire unchanged.
    return $sb.ToString()
}

function Invoke-DemoElection {
    param([string]$AdminToken)
    $title = 'Demo Student Council Election'
    $candidateId = 2100389

    $list = Invoke-Api -Token $AdminToken -Method Get -Path '/elections'
    if ($list.Status -ne 200) { Stop-DemoPrep -Name 'election' -Reason ('GET /elections: ' + (Get-ApiReason $list)) }
    $found = @(ConvertTo-Items $list.Body | Where-Object { $_.title -eq $title })
    # A finalized election in any status but closed is reusable; a closed one cannot take votes, so a new one is made.
    $open = @($found | Where-Object { $_.finalized_at -and $_.status -eq 'active' }) | Select-Object -First 1
    if ($open) {
        Write-Sub -Result 'PASS' -Name 'election' -Detail "reused active election id $($open.id), nothing created"
        return
    }
    $waiting = @($found | Where-Object { $_.finalized_at -and $_.status -ne 'closed' }) | Select-Object -First 1
    if ($waiting) {
        Write-Sub -Result 'PASS' -Name 'election' -Detail "reused finalized election id $($waiting.id) (status $($waiting.status)), nothing created; it opens at its start time $($waiting.start_time)"
        return
    }

    $election = $found | Where-Object { -not $_.finalized_at -and ($_.status -eq 'pending_approval' -or $_.status -eq 'upcoming') } | Select-Object -First 1
    if ($election) {
        Write-Sub -Result 'PASS' -Name 'election proposed' -Detail "resuming unfinished election id $($election.id) (status $($election.status))"
    } else {
        # Window as the spec sends it: UTC ISO 8601 with milliseconds and a Z. It starts a few minutes
        # ago so it is open now, and ends three days out so it is still open on Wednesday.
        $iso = "yyyy-MM-dd'T'HH:mm:ss.fff'Z'"
        $culture = [System.Globalization.CultureInfo]::InvariantCulture
        $now = [DateTime]::UtcNow
        $fields = New-Object System.Collections.Specialized.OrderedDictionary
        $fields['title'] = $title
        $fields['start_time'] = $now.AddMinutes(-10).ToString($iso, $culture)
        $fields['end_time'] = $now.AddDays(3).ToString($iso, $culture)
        $fields['positions[0][title]'] = 'President'
        $fields['positions[0][max_winners]'] = '1'
        $boundary = '----hiusa' + [guid]::NewGuid().ToString('N')
        $multipart = New-MultipartBody -Boundary $boundary -Fields $fields -FileField 'informative_letter' -FileName 'informative-letter.pdf' -FileText (New-InformativeLetterPdf)
        $created = Invoke-Api -Token $AdminToken -Method Post -Path '/elections' -Body $multipart -ContentType "multipart/form-data; boundary=$boundary"
        if ($created.Status -ne 201 -or -not $created.Body -or -not $created.Body.id) { Stop-DemoPrep -Name 'election proposed' -Reason (Get-ApiReason $created) }
        $election = $created.Body
        Write-Sub -Result 'PASS' -Name 'election proposed' -Detail "id $($election.id), window $($fields['start_time']) to $($fields['end_time'])"
    }

    if ($election.status -eq 'pending_approval') {
        if (-not $election.approval_id) { Stop-DemoPrep -Name 'election approved' -Reason 'the election has no approval_id' }
        $headToken = Get-ApiToken -SchoolId 940001
        $approved = Invoke-Api -Token $headToken -Method Patch -Path "/approval-requests/$($election.approval_id)" -Body @{ status = 'approved' }
        if ($approved.Status -ne 200) { Stop-DemoPrep -Name 'election approved' -Reason (Get-ApiReason $approved) }
        Write-Sub -Result 'PASS' -Name 'election approved' -Detail 'Department Head 940001 approved it'
    }

    $lists = Invoke-Api -Token $AdminToken -Method Get -Path '/partylists'
    if ($lists.Status -ne 200) { Stop-DemoPrep -Name 'party list' -Reason ('GET /partylists: ' + (Get-ApiReason $lists)) }
    $party = ConvertTo-Items $lists.Body | Where-Object { $_.name -eq 'Demo Party' } | Select-Object -First 1
    if ($party) {
        Write-Sub -Result 'PASS' -Name 'party list' -Detail "reused 'Demo Party' id $($party.id)"
    } else {
        $madeParty = Invoke-Api -Token $AdminToken -Method Post -Path '/partylists' -Body @{ name = 'Demo Party'; acronym = 'DP' }
        if ($madeParty.Status -ne 201 -or -not $madeParty.Body -or -not $madeParty.Body.id) { Stop-DemoPrep -Name 'party list' -Reason (Get-ApiReason $madeParty) }
        $party = $madeParty.Body
        Write-Sub -Result 'PASS' -Name 'party list' -Detail "created 'Demo Party' (DP) id $($party.id)"
    }

    $posAnswer = Invoke-Api -Token $AdminToken -Method Get -Path "/elections/$($election.id)/positions"
    $position = $null
    if ($posAnswer.Status -eq 200) { $position = ConvertTo-Items $posAnswer.Body | Select-Object -First 1 }
    if (-not $position) { Stop-DemoPrep -Name 'candidate' -Reason ('no position to run for: ' + (Get-ApiReason $posAnswer)) }
    $candAnswer = Invoke-Api -Token $AdminToken -Method Get -Path "/elections/$($election.id)/candidates"
    if ($candAnswer.Status -ne 200) { Stop-DemoPrep -Name 'candidate' -Reason ('GET candidates: ' + (Get-ApiReason $candAnswer)) }
    $already = ConvertTo-Items $candAnswer.Body | Where-Object { [string]$_.user_id -eq [string]$candidateId } | Select-Object -First 1
    if ($already) {
        Write-Sub -Result 'PASS' -Name 'candidate' -Detail "reused student $candidateId"
    } else {
        $addCand = Invoke-Api -Token $AdminToken -Method Post -Path "/elections/$($election.id)/candidates" -Body @{ user_id = $candidateId; position_id = $position.id; partylist_id = $party.id }
        if ($addCand.Status -ne 201) { Stop-DemoPrep -Name 'candidate' -Reason (Get-ApiReason $addCand) }
        Write-Sub -Result 'PASS' -Name 'candidate' -Detail "student $candidateId added for '$($position.title)' under Demo Party"
    }

    if ($election.finalized_at) {
        Write-Sub -Result 'PASS' -Name 'finalize' -Detail 'already finalized'
    } else {
        $final = Invoke-Api -Token $AdminToken -Method Patch -Path "/elections/$($election.id)/finalize"
        if ($final.Status -ne 200) { Stop-DemoPrep -Name 'finalize' -Reason (Get-ApiReason $final) }
        Write-Sub -Result 'PASS' -Name 'finalize' -Detail 'ballot finalized'
    }

    # The status only flips to active when an election list is read.
    $opened = Invoke-Api -Token $AdminToken -Method Get -Path '/elections'
    $row = $null
    if ($opened.Status -eq 200) { $row = ConvertTo-Items $opened.Body | Where-Object { $_.id -eq $election.id } | Select-Object -First 1 }
    if (-not $row -or $row.status -ne 'active') {
        $seen = Get-ApiReason $opened
        if ($row) { $seen = "status '$($row.status)', window $($row.start_time) to $($row.end_time)" }
        Stop-DemoPrep -Name 'election active' -Reason "the finalized election did not open: $seen"
    }
    Write-Sub -Result 'PASS' -Name 'election active' -Detail "id $($election.id) is open for voting"
}

function Invoke-DemoTask {
    param([string]$AdminToken)
    $title = 'Prepare the registration desk'
    $officer = 900004
    $list = Invoke-Api -Token $AdminToken -Method Get -Path '/tasks?per_page=100'
    if ($list.Status -ne 200) { Stop-DemoPrep -Name 'task' -Reason ('GET /tasks: ' + (Get-ApiReason $list)) }
    $rows = @()
    if ($list.Body -and $list.Body.data) { $rows = ConvertTo-Items $list.Body.data }
    $existing = $rows | Where-Object { $_.title -eq $title -and [string]$_.assigned_to -eq [string]$officer } | Select-Object -First 1
    if ($existing) {
        Write-Sub -Result 'PASS' -Name 'task' -Detail "reused task id $($existing.id) for officer $officer, nothing created"
        return
    }

    $events = Invoke-Api -Token $AdminToken -Method Get -Path '/events?search=Sports%20Fest&per_page=100'
    $eventRows = @()
    if ($events.Status -eq 200 -and $events.Body -and $events.Body.data) { $eventRows = ConvertTo-Items $events.Body.data }
    $linkEvent = $eventRows | Where-Object { $_.title -eq 'Sports Fest 2024' -and @('approved', 'ongoing', 'completed') -contains $_.status } | Select-Object -First 1

    # The server only accepts an officer from its own recommendation list, so check that first.
    $recommend = Invoke-Api -Token $AdminToken -Method Post -Path '/tasks/recommendation' -Body @{ title = $title; task_type = 'regular'; category = 'coordination' }
    if ($recommend.Status -ne 200) { Stop-DemoPrep -Name 'task' -Reason ('recommendation: ' + (Get-ApiReason $recommend)) }
    $eligible = @()
    if ($recommend.Body -and $recommend.Body.delegation -and $recommend.Body.delegation.rankings) {
        $eligible = @(ConvertTo-Items $recommend.Body.delegation.rankings | ForEach-Object { [string]$_.officer_id })
    }
    if ($eligible -notcontains [string]$officer) { Stop-DemoPrep -Name 'task' -Reason "officer $officer is not eligible for a task (eligible: $($eligible -join ', '))" }

    $payload = [ordered]@{
        title = $title
        description = 'Set up the sign-in tables and check the attendance sheets before doors open.'
        deadline = [DateTime]::UtcNow.AddDays(5).ToString('yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture)
        status = 'pending'
        assigned_to = $officer
        task_kind = 'standalone'
        category = 'coordination'
        priority = 'medium'
        task_type = 'regular'
    }
    $linked = ''
    if ($linkEvent) {
        $payload.task_kind = 'event_related'
        $payload.event_id = $linkEvent.id
        $linked = ", linked to event '$($linkEvent.title)'"
    }
    $created = Invoke-Api -Token $AdminToken -Method Post -Path '/tasks' -Body $payload
    if ($created.Status -ne 201 -and $linkEvent) {
        # The event link is optional: fall back to a standalone task rather than fail the step.
        Write-Sub -Result 'SKIP' -Name 'task event link' -Detail ('not used: ' + (Get-ApiReason $created))
        $payload.task_kind = 'standalone'
        $payload.Remove('event_id')
        $linked = ''
        $created = Invoke-Api -Token $AdminToken -Method Post -Path '/tasks' -Body $payload
    }
    if ($created.Status -ne 201) { Stop-DemoPrep -Name 'task' -Reason (Get-ApiReason $created) }
    Write-Sub -Result 'PASS' -Name 'task' -Detail "'$title' assigned to officer $officer, due $($payload.deadline)$linked"
}

function Invoke-DemoInvoice {
    param([string]$AdminToken)
    $description = 'Org membership fee'
    $student = 2100142
    try {
        $list = Invoke-Api -Token $AdminToken -Method Get -Path '/invoices'
        if ($list.Status -ne 200) { throw ('GET /invoices: ' + (Get-ApiReason $list)) }
        $existing = ConvertTo-Items $list.Body | Where-Object { [string]$_.student_id -eq [string]$student -and $_.description -eq $description } | Select-Object -First 1
        if ($existing) {
            Write-Sub -Result 'PASS' -Name 'invoice' -Detail "reused invoice id $($existing.id) for student $student, nothing created"
            return
        }
        $due = [DateTime]::UtcNow.AddDays(7).ToString('yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture)
        $created = Invoke-Api -Token $AdminToken -Method Post -Path '/invoices' -Body @{ student_id = $student; description = $description; amount_due = '150.00'; due_date = $due }
        if ($created.Status -ne 201) { throw (Get-ApiReason $created) }
        Write-Sub -Result 'PASS' -Name 'invoice' -Detail "'$description' 150.00 for student $student, due $due"
    } catch {
        Write-Sub -Result 'FAIL' -Name 'invoice' -Detail "best effort, not fatal: $($_.Exception.Message)"
    }
}

# Returns 0 when the election and the task are in place, 1 when either failed. The invoice is best effort.
function Invoke-DemoPrepStep {
    try {
        $adminToken = Get-ApiToken -SchoolId 900001
        Invoke-DemoElection -AdminToken $adminToken
        Invoke-DemoTask -AdminToken $adminToken
        Invoke-DemoInvoice -AdminToken $adminToken
        return 0
    } catch {
        Write-Host "STEP 10 FAILED: $($_.Exception.Message)" -ForegroundColor Red
        return 1
    }
}

$Steps = @(
    @{ Title = 'Preflight: ssh, units, backup directory'; Body = $Step1; Prelude = '' },
    @{ Title = 'Backup: mysqldump and uploads archive, verified'; Body = $Step2; Prelude = "DB='$DbDump'`nFILES='$FilesDump'`n" },
    @{ Title = 'Stop hiusa-queue and hiusa-scheduler, config:clear'; Body = $Step3; Prelude = '' },
    @{ Title = 'migrate:fresh --seed (APP_ENV=staging)'; Body = $Step4; Prelude = '' },
    @{ Title = 'Add the four extra colleges (colleges:sync)'; Body = $Step5; Prelude = '' },
    @{ Title = 'Create Department Head accounts 940006 to 940009'; Body = $Step6; Prelude = '' },
    @{ Title = 'Set a random password on SAO 990001 (generated on the server)'; Body = $Step7; Prelude = '' },
    @{ Title = 'config:cache, start hiusa-queue and hiusa-scheduler'; Body = $Step8; Prelude = '' }
)
$VerifyStep = $Steps.Count + 1
$TotalSteps = $VerifyStep
if (-not $SkipDemoPrep) { $TotalSteps++ }

if ($DumpScripts) {
    $dir = New-Item -ItemType Directory -Force -Path $DumpScripts
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    for ($i = 0; $i -lt $Steps.Count; $i++) {
        $text = Build-RemoteScript -Body $Steps[$i].Body -Prelude $Steps[$i].Prelude
        [System.IO.File]::WriteAllText((Join-Path $dir.FullName ("step{0}.sh" -f ($i + 1))), $text, $utf8)
    }
    [System.IO.File]::WriteAllText((Join-Path $dir.FullName 'step9.sh'), (Build-RemoteScript -Body $Step9Counts), $utf8)
    [System.IO.File]::WriteAllText((Join-Path $dir.FullName 'step6.php'), ("<?php`n" + ($PhpDeans -replace "`r`n", "`n")), $utf8)
    [System.IO.File]::WriteAllText((Join-Path $dir.FullName 'step7.php'), ("<?php`n" + ($PhpSao -replace "`r`n", "`n")), $utf8)
    Write-Host "Wrote the remote scripts and PHP snippets to $($dir.FullName). Nothing was contacted."
    exit 0
}

# Stops the ssh child if it is still running, so an interrupted migrate:fresh is not left running unobserved.
function Stop-RemoteProc {
    $proc = $script:RemoteProc
    if ($proc) {
        try {
            if (-not $proc.HasExited) {
                $proc.Kill()
                $script:RemoteKilled = $true
            }
        } catch { }
        $script:RemoteProc = $null
    }
}

# Printed whenever a live run ends, however it ends. It never calls exit: it runs inside a finally.
function Write-RunEnd {
    $ok = ($script:ExitCode -eq 0)
    Write-Host ''
    Write-Host '---- How this run ended ----' -ForegroundColor Cyan
    if (-not $script:WipeStarted) {
        Write-Host 'The database was NOT wiped: step 4 (migrate:fresh) never started.'
    } elseif ($script:WipeDone) {
        Write-Host 'The database WAS wiped and reseeded (step 4 completed).'
    } else {
        Write-Host 'The wipe (step 4, migrate:fresh) STARTED and did not report completion. The database may be empty or half built; assume nothing about its contents.' -ForegroundColor Red
        if ($script:RemoteKilled) {
            Write-Host 'The local ssh connection was stopped just now; the command on the server may need up to a minute to finish or die. Wait before running the script again.' -ForegroundColor Yellow
        }
    }
    if ($script:BackupTaken) {
        Write-Host ''
        Write-Host 'Backups on the server:' -ForegroundColor Cyan
        Write-Host "  database: $DbDump"
        Write-Host "  files:    $FilesDump"
        Write-Host 'To restore (NOT run by this script):' -ForegroundColor Cyan
        Write-Host "  $RestoreDb"
        Write-Host "  $RestoreFiles"
        Write-Host 'Then check the database is not empty:' -ForegroundColor Cyan
        Write-Host "  $RestoreCheck"
    } else {
        Write-Host 'No backup was taken by this run (step 2 did not pass), so there is nothing to restore from it.' -ForegroundColor Yellow
    }
    if ($script:WipeStarted -and -not $script:WipeDone) {
        Write-Host ''
        Write-Host "Keep this run's backup ($DbDump and $FilesDump): it is the last good one. A rerun's own backup holds the half-built database." -ForegroundColor Red
        Write-Host 'Run this script again with -Execute: a rerun wipes and reseeds from scratch. If the rerun stops at step 2 (for example the database no longer exists), restore this run''s backup first with the commands above, then run the script again.' -ForegroundColor Red
    } elseif (-not $ok) {
        # Retry advice by the step that was running when the run ended.
        Write-Host ''
        if ($script:CurrentStep -ge 10) {
            Write-Host 'Only step 10 (demo data) did not finish. The site is reset. Retry just that step, with no wipe: .\scripts\reseed-staging.ps1 -DemoPrepOnly -Execute' -ForegroundColor Yellow
        } elseif ($script:CurrentStep -ge 5) {
            Write-Host "The run ended in step $($script:CurrentStep). Fix the cause above, then run the script again with -Execute (it wipes and reseeds from scratch)." -ForegroundColor Yellow
        } elseif ($script:CurrentStep -ge 1) {
            Write-Host "The run ended in step $($script:CurrentStep), before anything was wiped. Fix the cause above, then run the script again with -Execute." -ForegroundColor Yellow
        }
    }
    Write-Host ''
    if ($script:ServicesTouched) {
        Write-Host 'The queue and scheduler were stopped by this run and may still be stopped. To bring the site back:' -ForegroundColor Yellow
    } else {
        Write-Host 'Recovery commands (only needed if the queue or scheduler is stopped or the config cache is missing):' -ForegroundColor Cyan
    }
    Write-Host '  sudo -u www-data /usr/local/bin/hiusa-artisan config:cache && sudo systemctl start hiusa-queue hiusa-scheduler'
    # The SAO account (990001): print what is known so the password is never lost.
    if ($script:SaoPw) {
        Write-Host ''
        if ($script:Step7Done) {
            Write-Host "SAO 990001 new password (shown once, store it now): $($script:SaoPw)" -ForegroundColor Yellow
        } else {
            Write-Host "SAO 990001 password, UNVERIFIED (step 7 did not finish its check; it was read from the server, shown once, store it and test it): $($script:SaoPw)" -ForegroundColor Yellow
        }
        $script:SaoPw = $null
    } elseif ($script:Step7Started) {
        Write-Host ''
        Write-Host 'SAO 990001: step 7 started and no password was reported. The password was probably changed on the server and is unknown. Run the script again with -Execute (it sets a new one).' -ForegroundColor Red
    } elseif ($script:WipeDone) {
        Write-Host ''
        Write-Host 'SAO 990001 is on the PUBLIC DEFAULT password Admin@123456 (the reseed restored it and step 7 never ran). Run the script again with -Execute, or set a password with the tinker procedure in CLAUDE.md ("Tinker on the server"). Do not leave the site like this.' -ForegroundColor Red
    }
}

function Write-StepHeader {
    param([int]$Number, [string]$Title)
    Write-Host ''
    Write-Host "[$Number/$TotalSteps] $Title" -ForegroundColor Cyan
}

$sshTarget = "$User@$HostName"
$sshOptions = "-i `"$KeyPath`" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o ServerAliveInterval=30"

function Write-DemoPrepPlan {
    $skipNote = if ($DemoPrepOnly) { '' } else { 'Skipped if step 9 is red. ' }
    Write-Host "    ${skipNote}API base: $BaseUrl/api. Passwords are the demo password, the SAO is never used."
    Write-Host '    Idempotent: an existing finalized "Demo Student Council Election" (any status but closed), task or invoice with the same title is reused.'
    Write-Host '    POST /login 900001 and 940001 (token held in memory only)'
    Write-Host '    GET  /elections                                  reuse a finalized "Demo Student Council Election" that is not closed (upcoming: opens at its start time)'
    Write-Host '    POST /elections (multipart, as the Admin form)   title, start now-10min UTC, end now+3 days UTC, positions[0] President x1, informative_letter PDF   expect 201'
    Write-Host '    PATCH /approval-requests/{approval_id}           Department Head 940001, status approved   expect 200'
    Write-Host '    POST /partylists                                 name "Demo Party", acronym DP   expect 201'
    Write-Host '    POST /elections/{id}/candidates                  user_id 2100389, first position, Demo Party   expect 201'
    Write-Host '    PATCH /elections/{id}/finalize                   expect 200'
    Write-Host '    GET  /elections                                  election status must read active'
    Write-Host '    GET  /tasks, /events, POST /tasks/recommendation, POST /tasks   "Prepare the registration desk", assigned_to 900004, status pending, deadline +5 days, linked to "Sports Fest 2024" when found   expect 201'
    Write-Host '    GET  /invoices, POST /invoices                   best effort: "Org membership fee" 150.00 for student 2100142 due +7 days   expect 201'
    Write-Host '    A failed election or task fails the run (exit 1); the invoice never does.'
}

# Steps 1 to 10 of a live run. Returns the exit code: 0 all green, 1 a step or check failed.
function Invoke-ResetSteps {
    Write-Host "Backup names for this run: $DbDump and $FilesDump"
    for ($i = 0; $i -lt $Steps.Count; $i++) {
        $number = $i + 1
        Write-StepHeader -Number $number -Title $Steps[$i].Title
        $script:CurrentStep = $number
        if ($number -eq 3) { $script:ServicesTouched = $true }
        if ($number -eq 4) { $script:WipeStarted = $true }
        if ($number -eq 7) { $script:Step7Started = $true }
        $result = Invoke-Remote -Body $Steps[$i].Body -Prelude $Steps[$i].Prelude
        if ($result.ExitCode -ne 0) {
            Write-Host "STEP $number FAILED (exit code $($result.ExitCode)). Stopping." -ForegroundColor Red
            return 1
        }
        # The backup is only trusted once its verification passed (step 2 exits non-zero otherwise).
        if ($number -eq 2) { $script:BackupTaken = $true }
        if ($number -eq 4) { $script:WipeDone = $true }
        if ($number -eq 8) { $script:ServicesTouched = $false }
        if ($number -eq 7) {
            if (-not $script:SaoPw) {
                Write-Host 'STEP 7 FAILED: the server did not return a password.' -ForegroundColor Red
                return 1
            }
            $script:Step7Done = $true
        }
        Write-Host "  step $number ok" -ForegroundColor Green
    }

    $script:CurrentStep = $VerifyStep
    Write-StepHeader -Number $VerifyStep -Title 'Verify over HTTP and with server counts'
    $rows = New-Object System.Collections.Generic.List[object]
    function Add-Row {
        param([string]$Check, $Expected, $Actual)
        $rows.Add([pscustomobject]@{ Check = $Check; Expected = [string]$Expected; Actual = [string]$Actual; Pass = ([string]$Expected -eq [string]$Actual) })
    }

    Add-Row 'GET /' 200 (Get-HttpStatus -Method Get -Url "$BaseUrl/" -Headers @{ Accept = 'text/html' })
    Add-Row 'GET /up' 200 (Get-HttpStatus -Method Get -Url "$BaseUrl/up")
    foreach ($id in 940001, 940006, 940007, 940008, 940009, 900001, 990002, 900004, 2100142) {
        $pwText = if ($id -eq 990002) { $OldAdminPassword } else { $DemoPassword }
        $json = ConvertTo-Json -Compress @{ school_id = $id; password = $pwText }
        Add-Row "POST /api/login $id" 200 (Get-HttpStatus -Method Post -Url "$BaseUrl/api/login" -Headers @{ Accept = 'application/json' } -Body $json)
    }
    $json = ConvertTo-Json -Compress @{ school_id = 990001; password = $OldAdminPassword }
    Add-Row 'POST /api/login 990001 old default password' 422 (Get-HttpStatus -Method Post -Url "$BaseUrl/api/login" -Headers @{ Accept = 'application/json' } -Body $json)
    $json = ConvertTo-Json -Compress @{ school_id = 990001; password = $script:SaoPw }
    Add-Row 'POST /api/login 990001 new password' 200 (Get-HttpStatus -Method Post -Url "$BaseUrl/api/login" -Headers @{ Accept = 'application/json' } -Body $json)
    $json = $null

    Write-Host '  reading counts from the server'
    $counts = Invoke-Remote -Body $Step9Counts
    $map = @{}
    foreach ($line in $counts.Lines) {
        if ($line -match '^COUNT (\S+) (\d+)$') { $map[$Matches[1]] = $Matches[2] }
    }
    if ($counts.ExitCode -ne 0) { Add-Row 'server counts query' 'exit 0' "exit $($counts.ExitCode)" }
    foreach ($pair in @(@('users total', 'users_total', 39), @('DEPARTMENT_HEAD users', 'role_DEPARTMENT_HEAD', 9), @('SUPER_ADMIN users', 'role_SUPER_ADMIN', 1), @('colleges', 'colleges', 9))) {
        $actual = if ($map.ContainsKey($pair[1])) { $map[$pair[1]] } else { 'missing' }
        Add-Row $pair[0] $pair[2] $actual
    }

    Write-Host ''
    Write-Host ('{0,-6} {1,-48} {2,-9} {3}' -f 'RESULT', 'CHECK', 'EXPECTED', 'ACTUAL')
    $failed = 0
    foreach ($row in $rows) {
        $mark = if ($row.Pass) { 'GREEN' } else { 'RED'; $failed++ }
        $color = if ($row.Pass) { 'Green' } else { 'Red' }
        Write-Host ('{0,-6} {1,-48} {2,-9} {3}' -f $mark, $row.Check, $row.Expected, $row.Actual) -ForegroundColor $color
    }
    Write-Host ''
    if ($failed -gt 0) {
        Write-Host "$failed check(s) RED." -ForegroundColor Red
        return 1
    }
    Write-Host 'All checks GREEN.' -ForegroundColor Green

    if ($SkipDemoPrep) {
        Write-Host 'Step 10 skipped (-SkipDemoPrep): no demo election, officer task or student invoice was created.' -ForegroundColor Yellow
    } else {
        $script:CurrentStep = 10
        Write-StepHeader -Number $TotalSteps -Title 'Demo journey prep over the API (election, officer task, student invoice)'
        $prepCode = @(Invoke-DemoPrepStep)[-1]
        if ($prepCode -ne 0) {
            Write-Host 'STEP 10 FAILED: the demo election or the officer task is not in place. The site is reset but not demo-ready.' -ForegroundColor Red
            return 1
        }
        Write-Host "  step $TotalSteps ok" -ForegroundColor Green
    }
    Write-Host 'The staging demo site is reset.' -ForegroundColor Green
    return 0
}

# The live run. Whatever ends it (success, a failed step, an exception, Ctrl+C) the finally block stops the
# ssh child and prints the run-end summary; the exit code is returned to the caller, never set inside finally.
function Invoke-ResetRun {
    $script:ExitCode = 1
    try {
        $script:ExitCode = @(Invoke-ResetSteps)[-1]
    } catch {
        Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
        $script:ExitCode = 1
    } finally {
        Stop-RemoteProc
        Write-RunEnd
    }
    return $script:ExitCode
}

# ---------------------------------------------------------------------------
# Dry run: print the plan and stop. Nothing below this block runs without -Execute.
# ---------------------------------------------------------------------------
if (-not $Execute) {
    if ($DemoPrepOnly) {
        Write-Host "DRY RUN (-DemoPrepOnly) against $BaseUrl. Nothing is contacted and no ssh process is started." -ForegroundColor Yellow
        Write-Host 'Only step 10 would run: no ssh, no backup, no wipe, no RESET prompt.'
        Write-StepHeader -Number $TotalSteps -Title 'Demo journey prep over the API (election, officer task, student invoice)'
        Write-DemoPrepPlan
        Write-Host ''
        Write-Host 'DRY RUN complete. Re-run with -DemoPrepOnly -Execute to prepare the demo data.' -ForegroundColor Yellow
        exit 0
    }
    Write-Host "DRY RUN against $HostName. Nothing is contacted and no ssh process is started." -ForegroundColor Yellow
    Write-Host "Each step below runs as: ssh $sshOptions $sshTarget bash -s   (script on stdin)"
    Write-Host "Verification requests go to $BaseUrl (https, certificate validation on)."
    Write-Host "Backup names for this run: $DbDump and $FilesDump"
    for ($i = 0; $i -lt $Steps.Count; $i++) {
        Write-StepHeader -Number ($i + 1) -Title $Steps[$i].Title
        foreach ($line in (($Steps[$i].Prelude + $Steps[$i].Body) -split "`r?`n")) { Write-Host "    | $line" }
    }
    Write-StepHeader -Number $VerifyStep -Title 'Verify over HTTP and with server counts'
    Write-Host "    GET  $BaseUrl/ (Accept: text/html)            expect 200"
    Write-Host "    GET  $BaseUrl/up                              expect 200"
    foreach ($id in 940001, 940006, 940007, 940008, 940009, 900001, 990002, 900004, 2100142) {
        $pwText = if ($id -eq 990002) { $OldAdminPassword } else { $DemoPassword }
        Write-Host "    POST $BaseUrl/api/login school_id=$id password=$pwText   expect 200"
    }
    Write-Host "    POST $BaseUrl/api/login school_id=990001 password=$OldAdminPassword   expect 422 (old SAO default rejected)"
    Write-Host "    POST $BaseUrl/api/login school_id=990001 with the new random password   expect 200"
    Write-Host '    server counts (read-only SQL): users total 39, DEPARTMENT_HEAD 9, SUPER_ADMIN 1, colleges 9'
    foreach ($line in ($Step9Counts -split "`r?`n")) { Write-Host "    | $line" }
    if ($SkipDemoPrep) {
        Write-Host ''
        Write-Host 'Step 10 (demo journey prep) is skipped because -SkipDemoPrep was given.'
    } else {
        Write-StepHeader -Number $TotalSteps -Title 'Demo journey prep over the API (election, officer task, student invoice)'
        Write-DemoPrepPlan
    }
    Write-Host ''
    Write-Host 'To restore from the backup (printed, never run by this script):' -ForegroundColor Cyan
    Write-Host "  $RestoreDb"
    Write-Host "  $RestoreFiles"
    Write-Host "  $RestoreCheck   (should print a non-zero count)"
    Write-Host 'To bring the queue and scheduler back if a run stops half way (printed at the end of every live run):' -ForegroundColor Cyan
    Write-Host '  sudo -u www-data /usr/local/bin/hiusa-artisan config:cache && sudo systemctl start hiusa-queue hiusa-scheduler'
    Write-Host ''
    Write-Host 'DRY RUN complete. Re-run with -Execute to reset the staging server.' -ForegroundColor Yellow
    exit 0
}

# ---------------------------------------------------------------------------
# Demo prep only: step 10 against the live API. It writes only demo data, so no RESET prompt.
# ---------------------------------------------------------------------------
if ($DemoPrepOnly) {
    Write-Host "Running step 10 only (demo journey prep) against $BaseUrl. No ssh, no backup, no wipe." -ForegroundColor Cyan
    Write-StepHeader -Number $TotalSteps -Title 'Demo journey prep over the API (election, officer task, student invoice)'
    $prepCode = @(Invoke-DemoPrepStep)[-1]
    if ($prepCode -ne 0) {
        Write-Host 'STEP 10 FAILED: the demo election or the officer task is not in place.' -ForegroundColor Red
        exit 1
    }
    Write-Host "  step $TotalSteps ok" -ForegroundColor Green
    exit 0
}

# ---------------------------------------------------------------------------
# Live run
# ---------------------------------------------------------------------------
Write-Host "About to WIPE and reseed the demo database on $HostName (everything entered since the last reseed is lost)." -ForegroundColor Red
Write-Host "A backup goes to $BackupDir first."
if (-not $Force) {
    $answer = Read-Host 'Type RESET to continue'
    if ($answer -cne 'RESET') {
        Write-Host 'Aborted: RESET was not typed. Nothing was contacted.' -ForegroundColor Yellow
        exit 2
    }
}

$sshCommand = Get-Command ssh -ErrorAction SilentlyContinue
if (-not $sshCommand) { Write-Host 'ssh was not found on PATH.' -ForegroundColor Red; exit 2 }
if (-not (Test-Path -LiteralPath $KeyPath)) {
    Write-Host "SSH key not found at $KeyPath (set HIUSA_SSH_KEY or pass -KeyPath)." -ForegroundColor Red
    exit 2
}
$script:RemoteExe = $sshCommand.Source
$script:RemoteArgs = "$sshOptions $sshTarget bash -s"
$script:Live = $true

$runCode = @(Invoke-ResetRun)[-1]
exit $runCode
