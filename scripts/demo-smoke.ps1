<#
.SYNOPSIS
  Pre-demo health check for the HIUSA staging site. Run it about 30 minutes
  before the demo. Prints a PASS/FAIL table and exits 1 when anything critical
  fails, 0 when the verdict is READY.

.DESCRIPTION
  Read-mostly. It signs in as the six demo roles, reads one dashboard endpoint
  per role, probes the upload limit with one oversized request that the server
  must refuse, and reads the semester and record counts. Nothing is created,
  changed or deleted. The only writes are the sign-in tokens it creates (it
  signs them out again at the end) and, with -CheckGroq, one announcement
  draft (one row in ai_outputs and one use of that Admin's daily draft quota).

  Checks (each request has a 30 second timeout; the 15 MB upload gets 60):
    1  GET / (HTML with id="root"), GET /up, TLS certificate validity and days left
    2  POST /api/login for SAO 990001 (needs HIUSA_SAO_PW), Department Head
       940001, Admin 900001, Officer 900004, Student 2100142, Adviser 990002,
       and the old default SAO password must be REJECTED with 422
    3  One authenticated dashboard read per role (200 with JSON)
    4  Engines: forecast generation is NOT called (it writes a row every time),
       AI service /health through -Ssh, Groq draft only with -CheckGroq
    5  15 MB multipart POST as the Department Head to /api/college/organizations,
       expected 422 (413 means nginx client_max_body_size or PHP post_max_size
       is too small), then an 11 MB single-file POST to /api/elections as the
       Admin (missing title, so nothing is created) that must reach Laravel's
       10 MB file rule; a PHP upload_max_filesize below 11 MB fails it
    6  With -Ssh: systemctl is-active, disk percent, scheduler journal tail
    7  Active semester state (an ACTIVE semester is a FAIL: the demo needs a
       reseed, unless -AllowActiveSemester) and record counts
    8  Demo state the reseed script step 10 creates, all read-only GETs: the
       finalized ACTIVE 'Demo Student Council Election' is visible to student
       2100142, an open task exists for officer 900004, 'Leadership Seminar 2024'
       is ongoing, 'Sports Fest 2024' is approved and 2100142 is not registered

.PARAMETER Url
  Base address of the site. Default https://13.228.227.182. The certificate is
  always validated; there is no switch to skip it.

.PARAMETER CheckGroq
  Also call POST /api/announcements/generate-draft once as Admin 900001 with a
  trivial prompt and report the latency. Spends one Groq call.

.PARAMETER Ssh
  Also run the read-only server checks over SSH. The key is read from the
  HIUSA_SSH_KEY environment variable, else the hiusa-lightsail.pem file in your
  .ssh folder. The key path is never printed.

.PARAMETER SshUser
  Login name for -Ssh. Default ubuntu.

.PARAMETER NoPrompt
  Never ask for the SAO password. Without HIUSA_SAO_PW the missing SAO password
  is a FAIL; with -NoPrompt it is only a WARN. Use -NoPrompt only to say "I know
  I am skipping the SAO checks".

.PARAMETER AllowActiveSemester
  Accept an already ACTIVE academic semester (a WARN instead of a FAIL). Without
  it an active semester fails the run, because the demo activates the semester
  live and the seeded events, tasks and election vanish once one is active. The
  fix is scripts\reseed-staging.ps1 -Execute.

.EXAMPLE
  $env:HIUSA_SAO_PW = '...'   # or leave it unset and type it at the prompt
  .\scripts\demo-smoke.ps1
  .\scripts\demo-smoke.ps1 -Ssh -CheckGroq

.NOTES
  Environment variables read: HIUSA_SAO_PW, HIUSA_SSH_KEY, USERPROFILE, TEMP.
  The SAO password is never printed or written to disk.

  Rate limits to know: sign-in allows 10 per minute per address and 5 per
  minute per account, so wait a minute between runs. The old-default-password
  probe counts as one failed attempt on 990001 (5 failures in 15 minutes lock
  that account for the rest of the window). A successful SAO sign-in clears the
  counter, so run with HIUSA_SAO_PW set; do not run it more than four times
  within 15 minutes without it.
#>
[CmdletBinding()]
param(
    [string]$Url = 'https://13.228.227.182',
    [switch]$CheckGroq,
    [switch]$Ssh,
    [string]$SshUser = 'ubuntu',
    [switch]$NoPrompt,
    [switch]$AllowActiveSemester
)

Set-StrictMode -Version 1.0
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Net.Http
$protocols = [Net.SecurityProtocolType]::Tls12
if ([enum]::GetNames([Net.SecurityProtocolType]) -contains 'Tls13') {
    $protocols = $protocols -bor [Net.SecurityProtocolType]::Tls13
}
[Net.ServicePointManager]::SecurityProtocol = $protocols

$Url = $Url.TrimEnd('/')
$TimeoutSec = 30
$UploadTimeoutSec = 60
$DemoPassword = 'Demo@12345'
$AdviserPassword = 'Admin@123456'
$OldDefaultSaoPassword = 'Admin@123456'

$script:Rows = New-Object System.Collections.ArrayList
$script:Step = ''
$script:Tokens = @{}
$script:TempFiles = New-Object System.Collections.ArrayList

function Add-Row {
    param([string]$Check, [string]$Status, [string]$Detail)
    [void]$script:Rows.Add([pscustomobject]@{ Step = $script:Step; Check = $Check; Status = $Status; Detail = $Detail })
    $color = switch ($Status) { 'PASS' { 'Green' } 'FAIL' { 'Red' } 'WARN' { 'Yellow' } default { 'Gray' } }
    Write-Host ('  [{0}] {1}: {2}' -f $Status, $Check, $Detail) -ForegroundColor $color
}

function Start-Step {
    param([string]$Id, [string]$Title)
    $script:Step = $Id
    Write-Host ''
    Write-Host ('Check {0}: {1}' -f $Id, $Title) -ForegroundColor Cyan
}

function Get-InnerMessage {
    param($ErrorObject)
    $e = $ErrorObject.Exception
    while ($e.InnerException) { $e = $e.InnerException }
    return $e.Message
}

function Limit-Text {
    param([string]$Text, [int]$Max = 110)
    $one = (($Text -replace '[^ -~]', '?') -replace '\s+', ' ').Trim()
    if ($one.Length -gt $Max) { return $one.Substring(0, $Max - 3) + '...' }
    return $one
}

# One HTTP call with default certificate validation. Status 0 means no HTTP
# answer (refused, reset, timeout, TLS failure); Error then says why.
function Invoke-Api {
    param(
        [string]$Method = 'GET',
        [string]$Path,
        [string]$Token,
        $Json,
        [System.Net.Http.HttpContent]$Content,
        [string]$Accept = 'application/json',
        [int]$Timeout = 30
    )
    $result = [pscustomobject]@{ Status = 0; Body = ''; ContentType = ''; Ms = 0; Error = $null; Data = $null; RetryAfter = 0 }
    $handler = New-Object System.Net.Http.HttpClientHandler
    $client = New-Object System.Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds($Timeout)
    $watch = [Diagnostics.Stopwatch]::StartNew()
    try {
        $request = New-Object System.Net.Http.HttpRequestMessage((New-Object System.Net.Http.HttpMethod($Method)), ($Url + $Path))
        [void]$request.Headers.Accept.ParseAdd($Accept)
        if ($Token) {
            $request.Headers.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', $Token)
        }
        if ($null -ne $Json) {
            $request.Content = New-Object System.Net.Http.StringContent(($Json | ConvertTo-Json -Compress), [Text.Encoding]::UTF8, 'application/json')
        } elseif ($null -ne $Content) {
            $request.Content = $Content
        }
        $response = $client.SendAsync($request).GetAwaiter().GetResult()
        $result.Status = [int]$response.StatusCode
        $result.Body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        if ($response.Content.Headers.ContentType) { $result.ContentType = [string]$response.Content.Headers.ContentType.MediaType }
        if ($response.Headers.RetryAfter -and $response.Headers.RetryAfter.Delta) { $result.RetryAfter = [int]$response.Headers.RetryAfter.Delta.TotalSeconds }
        $response.Dispose()
    } catch [System.Threading.Tasks.TaskCanceledException] {
        $result.Error = 'no answer within {0} s (timeout)' -f $Timeout
    } catch {
        $result.Error = Get-InnerMessage $_
    } finally {
        $watch.Stop()
        $result.Ms = [int]$watch.ElapsedMilliseconds
        $client.Dispose()
    }
    if ($result.Body -and $result.ContentType -like '*json*') {
        try { $result.Data = $result.Body | ConvertFrom-Json } catch { $result.Data = $null }
    }
    return $result
}

function Get-ServerMessage {
    param($Response)
    if ($null -eq $Response.Data) { return '' }
    $data = $Response.Data
    if ($data.PSObject.Properties['message'] -and $data.message) { return [string]$data.message }
    if ($data.PSObject.Properties['errors'] -and $data.errors) {
        foreach ($property in $data.errors.PSObject.Properties) { return [string](@($property.Value)[0]) }
    }
    return ''
}

function Describe-Failure {
    param($Response)
    if ($Response.Status -eq 0) { return $Response.Error }
    $message = Get-ServerMessage $Response
    if ($message) { return ('HTTP {0}: {1}' -f $Response.Status, (Limit-Text $message 90)) }
    return ('HTTP {0}' -f $Response.Status)
}

function Get-SaoPassword {
    if ($env:HIUSA_SAO_PW) { return $env:HIUSA_SAO_PW }
    if ($NoPrompt) { return $null }
    try {
        $secure = Read-Host -Prompt 'SAO 990001 password (Enter to skip the SAO checks)' -AsSecureString
    } catch {
        return $null
    }
    if ($null -eq $secure -or $secure.Length -eq 0) { return $null }
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Invoke-Login {
    param([int]$SchoolId, [string]$Password)
    $response = Invoke-Api -Method POST -Path '/api/login' -Json @{ school_id = $SchoolId; password = $Password }
    # A short per-minute throttle is worth waiting out once; an account lock (minutes) is not.
    if ($response.Status -eq 429 -and $response.RetryAfter -gt 0 -and $response.RetryAfter -le 65) {
        Write-Host ('  (sign-in throttled, waiting {0} s)' -f ($response.RetryAfter + 1)) -ForegroundColor DarkGray
        Start-Sleep -Seconds ($response.RetryAfter + 1)
        $response = Invoke-Api -Method POST -Path '/api/login' -Json @{ school_id = $SchoolId; password = $Password }
    }
    $login = [pscustomobject]@{ Response = $response; Token = $null; User = $null }
    if ($response.Status -eq 200 -and $null -ne $response.Data -and $response.Data.PSObject.Properties['access_token']) {
        $login.Token = [string]$response.Data.access_token
        $login.User = $response.Data.user
    }
    return $login
}

function Get-Json {
    param([string]$Path, [string]$Token)
    return Invoke-Api -Method GET -Path $Path -Token $Token
}

function Test-JsonOk {
    param($Response)
    return ($Response.Status -eq 200 -and $Response.ContentType -like '*json*' -and $null -ne $Response.Data)
}

function Get-RecordCount {
    param($Data)
    if ($null -eq $Data) { return $null }
    if ($Data.PSObject.Properties['total']) { return [int]$Data.total }
    if ($Data.PSObject.Properties['data']) { return @($Data.data).Count }
    return @($Data).Count
}

function Test-TlsCertificate {
    $uri = [Uri]$Url
    if ($uri.Scheme -ne 'https') {
        Add-Row 'TLS certificate' 'SKIP' 'URL is not https'
        return
    }
    $port = if ($uri.Port -gt 0) { $uri.Port } else { 443 }
    $tcp = New-Object System.Net.Sockets.TcpClient
    try {
        $pending = $tcp.BeginConnect($uri.Host, $port, $null, $null)
        if (-not $pending.AsyncWaitHandle.WaitOne($TimeoutSec * 1000)) { throw 'connect timeout' }
        $tcp.EndConnect($pending)
        $stream = New-Object System.Net.Security.SslStream($tcp.GetStream(), $false)
        $stream.ReadTimeout = $TimeoutSec * 1000
        $stream.WriteTimeout = $TimeoutSec * 1000
        $stream.AuthenticateAsClient($uri.Host)
        $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($stream.RemoteCertificate)
        $left = ($cert.NotAfter.ToUniversalTime() - [DateTime]::UtcNow).TotalDays
        $lifetime = ($cert.NotAfter - $cert.NotBefore).TotalDays
        $detail = 'valid, expires {0:yyyy-MM-dd HH:mm} UTC, {1:N1} days left (lifetime {2:N0} days)' -f $cert.NotAfter.ToUniversalTime(), $left, $lifetime
        if ($left -lt 1) { Add-Row 'TLS certificate' 'FAIL' $detail }
        elseif ($left -lt ($lifetime * 0.25)) { Add-Row 'TLS certificate' 'WARN' ($detail + '; renewal is due, check certbot') }
        else { Add-Row 'TLS certificate' 'PASS' $detail }
    } catch {
        Add-Row 'TLS certificate' 'FAIL' (Limit-Text (Get-InnerMessage $_))
    } finally {
        $tcp.Close()
    }
}

# Read-only server checks over SSH. Returns the raw output lines or $null.
function Invoke-SshRead {
    $keyPath = if ($env:HIUSA_SSH_KEY) { $env:HIUSA_SSH_KEY } else { Join-Path $env:USERPROFILE '.ssh\hiusa-lightsail.pem' }
    if (-not (Test-Path -LiteralPath $keyPath)) { return @{ Error = 'SSH key file not found (set HIUSA_SSH_KEY)' } }
    if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) { return @{ Error = 'ssh client not found on PATH' } }
    $remote = 'for s in hiusa-ai hiusa-queue hiusa-scheduler nginx php8.3-fpm mysql; do echo UNIT $s $(systemctl is-active $s); done; ' +
        'echo DISK $(df --output=pcent / | tail -1); ' +
        'echo AI $(curl -s -m 5 http://127.0.0.1:8001/health); ' +
        'echo JOURNAL; journalctl -u hiusa-scheduler -n 2 --no-pager'
    $hostName = ([Uri]$Url).Host
    $outFile = Join-Path $env:TEMP ('demo-smoke-ssh-out-{0}.txt' -f $PID)
    $errFile = Join-Path $env:TEMP ('demo-smoke-ssh-err-{0}.txt' -f $PID)
    [void]$script:TempFiles.Add($outFile)
    [void]$script:TempFiles.Add($errFile)
    $arguments = '-i "{0}" -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout={1} -o StrictHostKeyChecking=accept-new {2}@{3} "{4}"' -f $keyPath, $TimeoutSec, $SshUser, $hostName, $remote
    $process = Start-Process -FilePath 'ssh' -ArgumentList $arguments -NoNewWindow -PassThru -RedirectStandardOutput $outFile -RedirectStandardError $errFile
    if (-not $process.WaitForExit(($TimeoutSec + 10) * 1000)) {
        try { $process.Kill() } catch { }
        return @{ Error = 'ssh did not finish within {0} s' -f ($TimeoutSec + 10) }
    }
    if ($process.ExitCode -ne 0 -and -not (Test-Path -LiteralPath $outFile)) {
        return @{ Error = 'ssh failed (exit {0})' -f $process.ExitCode }
    }
    $lines = @(Get-Content -LiteralPath $outFile -ErrorAction SilentlyContinue)
    if ($lines.Count -eq 0) {
        $firstError = @(Get-Content -LiteralPath $errFile -ErrorAction SilentlyContinue | Select-Object -First 1)
        $reason = if ($firstError.Count -gt 0) { Limit-Text ([string]$firstError[0]) 90 } else { 'no output' }
        return @{ Error = 'ssh failed: ' + $reason }
    }
    return @{ Lines = $lines }
}

# One multipart POST of a fake PDF of the given size. Every probe is built so Laravel
# refuses it with 422 (an empty required field), so nothing is ever created.
# The temp file is removed in finally.
function Invoke-UploadProbe {
    param([long]$SizeBytes, [string]$Tag, [string]$Path, [string]$Token, [string]$FileField, [string]$FileName, [hashtable]$Fields)
    $file = Join-Path $env:TEMP ('demo-smoke-upload-{0}-{1}.pdf' -f $Tag, $PID)
    [void]$script:TempFiles.Add($file)
    $reader = $null
    $form = $null
    try {
        $writer = [IO.File]::Create($file)
        try {
            $head = [Text.Encoding]::ASCII.GetBytes('%PDF-1.4 demo smoke fake pdf')
            $writer.Write($head, 0, $head.Length)
            $writer.SetLength($SizeBytes)
        } finally { $writer.Dispose() }
        $reader = [IO.File]::OpenRead($file)
        $form = New-Object System.Net.Http.MultipartFormDataContent
        foreach ($key in $Fields.Keys) { $form.Add((New-Object System.Net.Http.StringContent([string]$Fields[$key])), $key) }
        $part = New-Object System.Net.Http.StreamContent($reader)
        $part.Headers.ContentType = New-Object System.Net.Http.Headers.MediaTypeHeaderValue('application/pdf')
        $form.Add($part, $FileField, 'demo-smoke.pdf')
        return Invoke-Api -Method POST -Path $Path -Token $Token -Content $form -Timeout $UploadTimeoutSec
    } finally {
        if ($form) { $form.Dispose() }
        if ($reader) { $reader.Dispose() }
        if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue }
    }
}

# All validation messages Laravel returned for one field of a 422 (for example
# 'informative_letter'), joined into one string.
function Get-FieldErrors {
    param($Response, [string]$Field)
    $found = @()
    if ($null -ne $Response.Data -and $Response.Data.PSObject.Properties['errors'] -and $Response.Data.errors) {
        foreach ($property in $Response.Data.errors.PSObject.Properties) {
            if ($property.Name -like ($Field + '*')) { $found += @($property.Value) | ForEach-Object { [string]$_ } }
        }
    }
    return ($found -join ' | ')
}

# A read-only GET whose body may legitimately be an empty JSON list. Returns
# the rows (possibly none) or $null when the call failed.
function Get-Rows {
    param([string]$Path, [string]$Token, [string]$Property = '')
    $response = Get-Json -Path $Path -Token $Token
    if ($response.Status -ne 200 -or $response.ContentType -notlike '*json*') { return @{ Error = (Describe-Failure $response) } }
    $data = $response.Data
    if ($Property -and $null -ne $data -and $data.PSObject.Properties[$Property]) { $data = $data.$Property }
    return @{ Rows = @($data | Where-Object { $null -ne $_ }); Raw = $response.Data }
}

$exitCode = 1
$verdict = 'NOT READY: the script stopped before finishing'

try {
    Write-Host ('HIUSA demo smoke check against {0}' -f $Url) -ForegroundColor White
    $saoPassword = Get-SaoPassword
    $sshResult = $null

    # ---- 1 Site, /up, TLS -------------------------------------------------
    Start-Step '1' 'site, /up and TLS'
    $landing = Invoke-Api -Method GET -Path '/' -Accept 'text/html'
    $unreachable = ($landing.Status -eq 0)
    if ($landing.Status -eq 200 -and $landing.Body -match 'id="root"') {
        Add-Row 'GET / serves the app' 'PASS' ('200, body has id="root" ({0} ms)' -f $landing.Ms)
    } elseif ($landing.Status -eq 200) {
        Add-Row 'GET / serves the app' 'FAIL' '200 but the body has no id="root" (not the React index page)'
    } else {
        Add-Row 'GET / serves the app' 'FAIL' (Describe-Failure $landing)
    }
    $up = Invoke-Api -Method GET -Path '/up' -Accept 'text/html'
    if ($up.Status -eq 200) { Add-Row 'GET /up' 'PASS' ('200 ({0} ms)' -f $up.Ms) }
    else { Add-Row 'GET /up' 'FAIL' ('expected 200, got ' + (Describe-Failure $up)) }
    Test-TlsCertificate

    if ($unreachable) {
        $script:Step = '2-8'
        Add-Row 'All other checks' 'FAIL' ('not attempted: {0} is unreachable' -f $Url)
    } else {
        # ---- 2 Sign in as every role ------------------------------------
        Start-Step '2' 'sign in for the six roles'
        $accounts = @(
            @{ Key = 'SAO'; Label = 'SAO 990001'; Id = 990001; Password = $saoPassword; Role = 'SUPER_ADMIN' },
            @{ Key = 'DH'; Label = 'Department Head 940001'; Id = 940001; Password = $DemoPassword; Role = 'DEPARTMENT_HEAD' },
            @{ Key = 'ADMIN'; Label = 'Admin 900001'; Id = 900001; Password = $DemoPassword; Role = 'ADMIN' },
            @{ Key = 'OFFICER'; Label = 'Officer 900004'; Id = 900004; Password = $DemoPassword; Role = 'SBO_OFFICER' },
            @{ Key = 'STUDENT'; Label = 'Student 2100142'; Id = 2100142; Password = $DemoPassword; Role = 'STUDENT' },
            @{ Key = 'ADVISER'; Label = 'Adviser 990002'; Id = 990002; Password = $AdviserPassword; Role = 'ADMIN' }
        )
        foreach ($account in $accounts) {
            $name = 'Login ' + $account.Label
            if (-not $account.Password) {
                if ($NoPrompt) {
                    Add-Row $name 'WARN' 'skipped on purpose (-NoPrompt): no SAO password, so the SAO checks did not run'
                } else {
                    Add-Row $name 'FAIL' 'no SAO password supplied: set HIUSA_SAO_PW or type it at the prompt (-NoPrompt skips the SAO checks on purpose)'
                }
                continue
            }
            $login = Invoke-Login -SchoolId $account.Id -Password $account.Password
            if ($login.Token) {
                $role = [string]$login.User.role
                if ($role -ne $account.Role) {
                    Add-Row $name 'FAIL' ('signed in but the role is {0}, expected {1}' -f $role, $account.Role)
                } else {
                    $script:Tokens[$account.Key] = $login.Token
                    Add-Row $name 'PASS' ('200, role {0} ({1} ms)' -f $role, $login.Response.Ms)
                }
            } elseif ($login.Response.Status -eq 429) {
                Add-Row $name 'FAIL' 'HTTP 429 sign-in rate limit; wait a minute (or 15 minutes if the account is locked) and run again'
            } else {
                Add-Row $name 'FAIL' (Describe-Failure $login.Response)
            }
        }
        $old = $null
        if ($script:Tokens.ContainsKey('SAO')) {
            # A wrong password counts toward the 5 failures that lock the account for 15 minutes. Only probe
            # right after a successful SAO sign-in above, which clears that counter.
            $old = Invoke-Login -SchoolId 990001 -Password $OldDefaultSaoPassword
        }
        if ($null -eq $old) {
            Add-Row 'Old default SAO password rejected' 'WARN' 'not probed: it needs a successful SAO sign-in first (a wrong password counts toward the account lockout)'
        } elseif ($old.Token) {
            Add-Row 'Old default SAO password rejected' 'FAIL' 'HTTP 200: 990001 still accepts the public default password, change it now'
            [void](Invoke-Api -Method POST -Path '/api/logout' -Token $old.Token)
        } elseif ($old.Response.Status -eq 422) {
            Add-Row 'Old default SAO password rejected' 'PASS' '422, 990001 is not on the public default'
        } elseif ($old.Response.Status -eq 429) {
            Add-Row 'Old default SAO password rejected' 'WARN' '429 rate limited or locked, could not verify; wait and run again'
        } else {
            Add-Row 'Old default SAO password rejected' 'FAIL' ('expected 422, got ' + (Describe-Failure $old.Response))
        }

        # ---- 3 Dashboard data per role ----------------------------------
        Start-Step '3' 'dashboard data per role'
        $dashboards = @(
            @{ Key = 'SAO'; Label = 'SAO'; Paths = @('/api/system/agency', '/api/dashboard/briefing') },
            @{ Key = 'DH'; Label = 'Department Head'; Paths = @('/api/college/organizations', '/api/dashboard/briefing') },
            @{ Key = 'ADMIN'; Label = 'Admin'; Paths = @('/api/admin/dashboard', '/api/budgets', '/api/dashboard/briefing') },
            @{ Key = 'OFFICER'; Label = 'Officer'; Paths = @('/api/orders', '/api/dashboard/briefing') },
            @{ Key = 'STUDENT'; Label = 'Student'; Paths = @('/api/student/feed', '/api/events', '/api/dashboard/briefing') },
            @{ Key = 'ADVISER'; Label = 'Adviser'; Paths = @('/api/admin/dashboard', '/api/dashboard/briefing') }
        )
        foreach ($dashboard in $dashboards) {
            $name = 'Dashboard data: ' + $dashboard.Label
            if (-not $script:Tokens.ContainsKey($dashboard.Key)) {
                Add-Row $name 'WARN' 'skipped: not signed in'
                continue
            }
            $failures = @()
            $totalMs = 0
            foreach ($path in $dashboard.Paths) {
                $response = Get-Json -Path $path -Token $script:Tokens[$dashboard.Key]
                $totalMs += $response.Ms
                if (-not (Test-JsonOk $response)) {
                    $failures += ('{0} -> {1}' -f $path, (Describe-Failure $response))
                    if ($response.Status -eq 200) { $failures[-1] = ('{0} -> 200 but not JSON' -f $path) }
                }
            }
            if ($failures.Count -eq 0) {
                Add-Row $name 'PASS' ('{0}/{0} reads 200 JSON ({1} ms)' -f $dashboard.Paths.Count, $totalMs)
            } else {
                Add-Row $name 'FAIL' (Limit-Text ($failures -join '; ') 160)
            }
        }

        # ---- 4 Engines --------------------------------------------------
        Start-Step '4' 'engines'
        Add-Row 'Forecast generation' 'SKIP' 'not called: POST /api/forecasts/generate writes a forecast and an ai_outputs row every time'
        if ($Ssh) { $sshResult = Invoke-SshRead }
        if (-not $Ssh) {
            Add-Row 'AI engine health' 'SKIP' 'the AI service listens on localhost:8001 only; run with -Ssh to read its /health'
        } elseif ($sshResult.ContainsKey('Error')) {
            Add-Row 'AI engine health' 'FAIL' $sshResult.Error
        } else {
            $aiLine = @($sshResult.Lines | Where-Object { $_ -like 'AI *' } | Select-Object -First 1)
            if ($aiLine.Count -gt 0 -and $aiLine[0] -match '"status"\s*:\s*"ok"') {
                Add-Row 'AI engine health' 'PASS' 'GET :8001/health returned status ok (read only)'
            } else {
                $shown = if ($aiLine.Count -gt 0) { Limit-Text ([string]$aiLine[0]) 90 } else { 'no AI line in the output' }
                Add-Row 'AI engine health' 'FAIL' ('no ok answer from the AI service: ' + $shown)
            }
        }
        if ($script:Tokens.ContainsKey('ADMIN')) {
            $quota = Get-Json -Path '/api/announcements/generation-quota' -Token $script:Tokens['ADMIN']
            if (Test-JsonOk $quota) {
                Add-Row 'Groq draft quota (Admin 900001)' 'INFO' ('{0} used of {1} today, {2} left' -f $quota.Data.used, $quota.Data.limit, $quota.Data.remaining)
            } else {
                Add-Row 'Groq draft quota (Admin 900001)' 'WARN' (Describe-Failure $quota)
            }
            if ($CheckGroq) {
                $draft = Invoke-Api -Method POST -Path '/api/announcements/generate-draft' -Token $script:Tokens['ADMIN'] `
                    -Json @{ title = 'Demo smoke check'; target_role = 'all'; category = 'general'; details = 'Reply with one short sentence.' }
                if ($draft.Status -eq 200) {
                    Add-Row 'Groq announcement draft' 'PASS' ('200 in {0} ms' -f $draft.Ms)
                } elseif ($draft.Status -eq 503) {
                    Add-Row 'Groq announcement draft' 'FAIL' ('503 Groq unavailable after {0} ms (key, network or Groq outage)' -f $draft.Ms)
                } else {
                    Add-Row 'Groq announcement draft' 'FAIL' (Describe-Failure $draft)
                }
            } else {
                Add-Row 'Groq announcement draft' 'SKIP' 'not called (spends Groq quota); use -CheckGroq'
            }
        } else {
            Add-Row 'Groq draft quota and draft' 'WARN' 'skipped: Admin not signed in'
        }

        # ---- 5 Upload limit ---------------------------------------------
        Start-Step '5' 'upload limit'
        if (-not $script:Tokens.ContainsKey('DH')) {
            Add-Row 'Upload limit 15 MB' 'WARN' 'skipped: Department Head not signed in'
        } else {
            $limitHint = 'nginx client_max_body_size or PHP post_max_size too small'
            $upload = Invoke-UploadProbe -SizeBytes 15MB -Tag 'big' -Path '/api/college/organizations' -Token $script:Tokens['DH'] `
                -FileField 'files[1]' -Fields @{ name = ''; acronym = 'SMOKE' }
            if ($upload.Status -eq 422) {
                Add-Row 'Upload limit 15 MB' 'PASS' ('422, the 15 MB body reached Laravel and was refused on validation ({0} ms)' -f $upload.Ms)
            } elseif ($upload.Status -eq 413) {
                Add-Row 'Upload limit 15 MB' 'FAIL' ('413: ' + $limitHint)
            } elseif ($upload.Status -eq 0) {
                Add-Row 'Upload limit 15 MB' 'FAIL' ('no answer: {0}. A reset while uploading usually means: {1}' -f (Limit-Text $upload.Error 60), $limitHint)
            } else {
                Add-Row 'Upload limit 15 MB' 'FAIL' ('expected 422, got ' + (Describe-Failure $upload))
            }
        }

        # The 15 MB body is refused by PHP itself (upload_max_filesize 12M), so it proves nginx and post_max_size
        # but not the per-file limit. The largest legitimate file is 10 MB (Laravel rule max:10240), so an 11 MB
        # file must get past PHP and be refused by that Laravel rule instead.
        # Endpoint: POST /api/elections as the Admin, not the registration endpoint, because that one answers
        # "SAO must activate a semester first" before it validates any file whenever no semester is active, which
        # is the state the demo starts in. The election endpoint validates the file first, and the missing title
        # makes the request 422 so nothing is created. It does answer 409 when semesters exist but none is active.
        # How PHP and Laravel are told apart: the 422 carries errors keyed informative_letter. If PHP accepted the
        # file, the message is the size rule ("must not be greater than 10240 kilobytes"). If PHP dropped it
        # (upload_max_filesize below 11 MB) the file arrives with an upload error and the message is "failed to
        # upload" or "must be a file" instead.
        if (-not $script:Tokens.ContainsKey('ADMIN')) {
            Add-Row 'Upload limit 11 MB (PHP per file)' 'WARN' 'skipped: Admin not signed in'
        } else {
            $mid = Invoke-UploadProbe -SizeBytes 11MB -Tag 'mid' -Path '/api/elections' -Token $script:Tokens['ADMIN'] `
                -FileField 'informative_letter' -Fields @{ title = '' }
            $fileErrors = Get-FieldErrors $mid 'informative_letter'
            if ($mid.Status -eq 413) {
                Add-Row 'Upload limit 11 MB (PHP per file)' 'FAIL' '413: nginx client_max_body_size too small'
            } elseif ($mid.Status -eq 0) {
                Add-Row 'Upload limit 11 MB (PHP per file)' 'FAIL' ('no answer: ' + (Limit-Text $mid.Error 80))
            } elseif ($mid.Status -eq 409) {
                Add-Row 'Upload limit 11 MB (PHP per file)' 'WARN' '409: semesters exist but none is active, the election endpoint refuses before validating; could not tell PHP from Laravel'
            } elseif ($mid.Status -ne 422) {
                Add-Row 'Upload limit 11 MB (PHP per file)' 'FAIL' ('expected 422, got ' + (Describe-Failure $mid))
            } elseif ($fileErrors -match 'kilobytes|greater than') {
                Add-Row 'Upload limit 11 MB (PHP per file)' 'PASS' ('422, PHP passed the 11 MB file and Laravel applied its 10 MB rule ({0} ms)' -f $mid.Ms)
            } elseif ($fileErrors) {
                Add-Row 'Upload limit 11 MB (PHP per file)' 'FAIL' ('422 but the file was refused before the size rule, PHP upload_max_filesize is probably under 11 MB: ' + (Limit-Text $fileErrors 70))
            } else {
                Add-Row 'Upload limit 11 MB (PHP per file)' 'WARN' '422 with no message about the file, so PHP versus Laravel could not be told apart'
            }
        }

        # ---- 6 Server over SSH ------------------------------------------
        Start-Step '6' 'server over SSH'
        if (-not $Ssh) {
            Add-Row 'Server checks' 'SKIP' 'run with -Ssh to check services, disk and the scheduler journal'
        } elseif ($sshResult.ContainsKey('Error')) {
            Add-Row 'Server checks' 'FAIL' $sshResult.Error
        } else {
            foreach ($line in $sshResult.Lines) {
                if ($line -match '^UNIT (\S+) (\S+)') {
                    if ($Matches[2] -eq 'active') { Add-Row ('Service ' + $Matches[1]) 'PASS' 'active' }
                    else { Add-Row ('Service ' + $Matches[1]) 'FAIL' ('systemctl says ' + $Matches[2]) }
                }
            }
            $diskLine = @($sshResult.Lines | Where-Object { $_ -match '^DISK\s+\d+%' } | Select-Object -First 1)
            if ($diskLine.Count -gt 0 -and $diskLine[0] -match '(\d+)%') {
                $used = [int]$Matches[1]
                if ($used -ge 90) { Add-Row 'Disk used' 'FAIL' ('{0}% of /' -f $used) }
                elseif ($used -ge 80) { Add-Row 'Disk used' 'WARN' ('{0}% of /' -f $used) }
                else { Add-Row 'Disk used' 'PASS' ('{0}% of /' -f $used) }
            } else {
                Add-Row 'Disk used' 'WARN' 'could not read df output'
            }
            $marker = [array]::IndexOf($sshResult.Lines, 'JOURNAL')
            if ($marker -ge 0 -and $marker -lt ($sshResult.Lines.Count - 1)) {
                $tail = @($sshResult.Lines[($marker + 1)..($sshResult.Lines.Count - 1)] | Select-Object -Last 2)
                foreach ($journalLine in $tail) { Add-Row 'Scheduler journal' 'INFO' (Limit-Text $journalLine 140) }
            } else {
                Add-Row 'Scheduler journal' 'WARN' 'no journal lines returned'
            }
        }

        # ---- 7 State ----------------------------------------------------
        Start-Step '7' 'state for the demo'
        $stateKey = if ($script:Tokens.ContainsKey('SAO')) { 'SAO' } elseif ($script:Tokens.ContainsKey('ADMIN')) { 'ADMIN' } else { $null }
        if ($null -eq $stateKey) {
            Add-Row 'Academic semesters' 'WARN' 'skipped: neither SAO nor Admin is signed in'
        } else {
            $periods = Get-Json -Path '/api/academic-periods' -Token $script:Tokens[$stateKey]
            if (-not (Test-JsonOk $periods)) {
                Add-Row 'Academic semesters' 'FAIL' (Describe-Failure $periods)
            } else {
                $list = @($periods.Data)
                $active = @($list | Where-Object { $_.status -eq 'active' })
                $viaNote = if ($stateKey -eq 'SAO') { '' } else { ' (read with the Admin token, upcoming ones are hidden)' }
                $counts = '{0} listed: {1} upcoming, {2} active, {3} closed' -f $list.Count,
                    @($list | Where-Object { $_.status -eq 'upcoming' }).Count, $active.Count, @($list | Where-Object { $_.status -eq 'closed' }).Count
                if ($active.Count -eq 0) {
                    Add-Row 'Active semester' 'INFO' ('no active semester yet (expected before the demo); ' + $counts + $viaNote)
                } else {
                    $label = '{0} semester {1}' -f $active[0].academic_year.label, $active[0].number
                    $activeDetail = 'a semester is already active ({0}): run scripts\reseed-staging.ps1 -Execute (or pass -AllowActiveSemester to accept this state). {1}' -f $label, $counts
                    if ($AllowActiveSemester) {
                        Add-Row 'Active semester' 'WARN' ('accepted with -AllowActiveSemester: a semester is already active ({0}); the demo expects to activate it live. {1}' -f $label, $counts)
                    } else {
                        Add-Row 'Active semester' 'FAIL' $activeDetail
                    }
                }
            }
        }
        $orgDetail = $null
        if ($script:Tokens.ContainsKey('SAO')) {
            $overview = Get-Json -Path '/api/system/overview' -Token $script:Tokens['SAO']
            if (Test-JsonOk $overview) {
                $orgDetail = '{0} organizations ({1} active), {2} upcoming events, {3} active elections (all organizations)' -f
                    $overview.Data.organizations.total, $overview.Data.organizations.active, $overview.Data.operations.upcoming_events, $overview.Data.operations.active_elections
            }
        }
        if (-not $orgDetail) {
            $public = Invoke-Api -Method GET -Path '/api/organizations'
            if (Test-JsonOk $public) { $orgDetail = '{0} organizations on the public list' -f (Get-RecordCount $public.Data) }
        }
        if ($orgDetail) { Add-Row 'Record counts' 'INFO' $orgDetail } else { Add-Row 'Record counts' 'WARN' 'could not read the organization count' }
        if ($script:Tokens.ContainsKey('ADMIN')) {
            $eventList = Get-Json -Path '/api/events?per_page=1' -Token $script:Tokens['ADMIN']
            $electionList = Get-Json -Path '/api/elections' -Token $script:Tokens['ADMIN']
            if ((Test-JsonOk $eventList) -and (Test-JsonOk $electionList)) {
                Add-Row 'Record counts (PSITS-CCS)' 'INFO' ('{0} events, {1} elections in Admin 900001 scope' -f (Get-RecordCount $eventList.Data), (Get-RecordCount $electionList.Data))
            } else {
                Add-Row 'Record counts (PSITS-CCS)' 'WARN' 'could not read events or elections'
            }
        }

        # ---- 8 Demo state -----------------------------------------------
        # What scripts\reseed-staging.ps1 step 10 and the seed leave behind. Read-only GETs, one per question.
        # With a semester active these lists are scoped to it and the seeded rows are hidden, so they FAIL too.
        Start-Step '8' 'demo state'
        $demoElection = 'Demo Student Council Election'
        $demoTask = 'Prepare the registration desk'
        if (-not $script:Tokens.ContainsKey('STUDENT')) {
            Add-Row 'Demo election visible to 2100142' 'WARN' 'skipped: Student not signed in'
        } else {
            # GET /api/elections as a student lists only finalized ACTIVE elections (and ones with released results).
            $elections = Get-Rows -Path '/api/elections' -Token $script:Tokens['STUDENT']
            if ($elections.ContainsKey('Error')) {
                Add-Row 'Demo election visible to 2100142' 'FAIL' $elections.Error
            } else {
                $ballot = @($elections.Rows | Where-Object { $_.title -eq $demoElection -and $_.status -eq 'active' -and $_.finalized_at }) | Select-Object -First 1
                if ($ballot) {
                    Add-Row 'Demo election visible to 2100142' 'PASS' ("'{0}' id {1} is active and finalized, ends {2}" -f $demoElection, $ballot.id, $ballot.end_time)
                } else {
                    $titles = @($elections.Rows | ForEach-Object { $_.title })
                    $seen = if ($titles.Count -gt 0) { 'the student sees: ' + (Limit-Text ($titles -join ', ') 60) } else { 'the student sees no election' }
                    Add-Row 'Demo election visible to 2100142' 'FAIL' ("no active, finalized '{0}' (no demo ballot); {1}. Run scripts\reseed-staging.ps1 -Execute" -f $demoElection, $seen)
                }
            }
        }
        if (-not $script:Tokens.ContainsKey('OFFICER')) {
            Add-Row 'Open task for officer 900004' 'WARN' 'skipped: Officer not signed in'
        } else {
            # GET /api/tasks as an officer is already limited to that officer's own tasks.
            $tasks = Get-Rows -Path '/api/tasks?per_page=100' -Token $script:Tokens['OFFICER'] -Property 'data'
            if ($tasks.ContainsKey('Error')) {
                Add-Row 'Open task for officer 900004' 'FAIL' $tasks.Error
            } else {
                $open = @($tasks.Rows | Where-Object { @('pending', 'in_progress', 'overdue') -contains $_.status })
                $named = @($open | Where-Object { $_.title -eq $demoTask }) | Select-Object -First 1
                if ($named) {
                    Add-Row 'Open task for officer 900004' 'PASS' ("'{0}' is {1}, due {2}" -f $demoTask, $named.status, $named.deadline)
                } elseif ($open.Count -gt 0) {
                    Add-Row 'Open task for officer 900004' 'PASS' ("no task titled '{0}', but {1} open task(s): '{2}' is {3}" -f $demoTask, $open.Count, (Limit-Text ([string]$open[0].title) 40), $open[0].status)
                } else {
                    Add-Row 'Open task for officer 900004' 'FAIL' ("officer 900004 has no open task ({0} listed in total); Officer step 3 has nothing to start. Run scripts\reseed-staging.ps1 -Execute" -f $tasks.Rows.Count)
                }
            }
        }
        if (-not $script:Tokens.ContainsKey('STUDENT')) {
            Add-Row 'Seeded events for the demo' 'WARN' 'skipped: Student not signed in'
        } else {
            $leadership = Get-Rows -Path '/api/events?search=Leadership%20Seminar&per_page=100' -Token $script:Tokens['STUDENT'] -Property 'data'
            if ($leadership.ContainsKey('Error')) {
                Add-Row 'Event Leadership Seminar ongoing' 'FAIL' $leadership.Error
            } else {
                $seminar = @($leadership.Rows | Where-Object { $_.title -eq 'Leadership Seminar 2024' }) | Select-Object -First 1
                if ($seminar -and $seminar.status -eq 'ongoing') {
                    Add-Row 'Event Leadership Seminar ongoing' 'PASS' ('ongoing until {0}' -f $seminar.end_time)
                } elseif ($seminar) {
                    Add-Row 'Event Leadership Seminar ongoing' 'FAIL' ("status is '{0}', expected ongoing (the Officer check-in has no event to use)" -f $seminar.status)
                } else {
                    Add-Row 'Event Leadership Seminar ongoing' 'FAIL' "'Leadership Seminar 2024' is not in the student event list"
                }
            }
            $sports = Get-Rows -Path '/api/events?search=Sports%20Fest&per_page=100' -Token $script:Tokens['STUDENT'] -Property 'data'
            $fest = $null
            if ($sports.ContainsKey('Error')) {
                Add-Row 'Event Sports Fest approved' 'FAIL' $sports.Error
            } else {
                $fest = @($sports.Rows | Where-Object { $_.title -eq 'Sports Fest 2024' }) | Select-Object -First 1
                if (-not $fest) {
                    Add-Row 'Event Sports Fest approved' 'FAIL' "'Sports Fest 2024' is not in the student event list"
                } elseif ($fest.status -ne 'approved') {
                    Add-Row 'Event Sports Fest approved' 'FAIL' ("status is '{0}', expected approved" -f $fest.status)
                } elseif ([DateTimeOffset]::Parse([string]$fest.start_time).UtcDateTime -le [DateTime]::UtcNow) {
                    Add-Row 'Event Sports Fest approved' 'FAIL' ('approved but it already started ({0}); registration is closed' -f $fest.start_time)
                } else {
                    Add-Row 'Event Sports Fest approved' 'PASS' ('approved, starts {0}' -f $fest.start_time)
                }
            }
            # GET /api/me/event-registrations is what the registration panel in the event drawer reads.
            if ($fest) {
                $mine = Get-Rows -Path '/api/me/event-registrations' -Token $script:Tokens['STUDENT']
                if ($mine.ContainsKey('Error')) {
                    Add-Row 'Student 2100142 not on Sports Fest' 'FAIL' $mine.Error
                } else {
                    $registrations = @()
                    foreach ($group in 'upcoming', 'past') {
                        if ($null -ne $mine.Raw -and $mine.Raw.PSObject.Properties[$group]) { $registrations += @($mine.Raw.$group) }
                    }
                    $held = @($registrations | Where-Object { [string]$_.event_id -eq [string]$fest.id -and @('registered', 'attended', 'no_show') -contains $_.status }) | Select-Object -First 1
                    if ($held) {
                        Add-Row 'Student 2100142 not on Sports Fest' 'FAIL' ("already has a '{0}' registration; Student step 1 has nothing to register. Use a back-up student or reseed" -f $held.status)
                    } else {
                        Add-Row 'Student 2100142 not on Sports Fest' 'PASS' 'no active registration, the Register button is available'
                    }
                }
            }
        }
    }

    # ---- Result ----------------------------------------------------------
    $failed = @($script:Rows | Where-Object { $_.Status -eq 'FAIL' })
    if ($failed.Count -eq 0) {
        $verdict = 'READY'
        $exitCode = 0
    } else {
        $verdict = 'NOT READY: ' + ((@($failed | ForEach-Object { $_.Check })) -join '; ')
        $exitCode = 1
    }
} catch {
    $verdict = 'NOT READY: the script itself failed: ' + (Limit-Text (Get-InnerMessage $_) 150)
    $exitCode = 1
} finally {
    foreach ($token in $script:Tokens.Values) {
        try { [void](Invoke-Api -Method POST -Path '/api/logout' -Token $token -Timeout 10) } catch { }
    }
    foreach ($file in $script:TempFiles) {
        if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue }
    }
}

Write-Host ''
Write-Host '=== HIUSA demo smoke result ===' -ForegroundColor White
Write-Host ('{0,-5} {1,-38} {2,-6} {3}' -f 'Step', 'Check', 'Result', 'Detail')
Write-Host ('{0,-5} {1,-38} {2,-6} {3}' -f '----', '-----', '------', '------')
foreach ($row in $script:Rows) {
    $color = switch ($row.Status) { 'PASS' { 'Green' } 'FAIL' { 'Red' } 'WARN' { 'Yellow' } default { 'Gray' } }
    Write-Host ('{0,-5} {1,-38} {2,-6} {3}' -f $row.Step, (Limit-Text $row.Check 38), $row.Status, $row.Detail) -ForegroundColor $color
}
Write-Host ''
$tally = @{}
foreach ($row in $script:Rows) { $tally[$row.Status] = 1 + [int]$tally[$row.Status] }
Write-Host ('PASS {0}  FAIL {1}  WARN {2}  SKIP {3}  INFO {4}' -f [int]$tally['PASS'], [int]$tally['FAIL'], [int]$tally['WARN'], [int]$tally['SKIP'], [int]$tally['INFO'])
Write-Host $verdict -ForegroundColor $(if ($exitCode -eq 0) { 'Green' } else { 'Red' })
exit $exitCode
