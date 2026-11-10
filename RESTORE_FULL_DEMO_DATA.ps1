$ErrorActionPreference = "Stop"
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " HIUSA: RESTORING FULL SEEDED DEMO DATA" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$envFile = Join-Path $PSScriptRoot "server\.env"
$dbHost = $env:DB_HOST
if (-not $dbHost -and (Test-Path $envFile)) {
    $hostLine = Get-Content $envFile | Where-Object { $_ -match '^\s*DB_HOST\s*=' } | Select-Object -Last 1
    if ($hostLine) { $dbHost = ($hostLine -replace '^\s*DB_HOST\s*=\s*', '').Trim().Trim('"').Trim("'") }
}
if ($dbHost -notin @('127.0.0.1', 'localhost')) {
    Write-Host "Refusing to run: the database host is '$dbHost', not 127.0.0.1 or localhost. This script wipes the whole database and reloads the demo data." -ForegroundColor Red
    exit 1
}
$answer = Read-Host "This wipes the whole database and reloads the demo data on $dbHost. Type WIPE to continue"
if ($answer -cne 'WIPE') {
    Write-Host "Cancelled. Nothing was changed." -ForegroundColor Yellow
    exit 1
}

Push-Location "$PSScriptRoot\server"
try {
    php artisan migrate:fresh --seed --force

    $phpCode = @'
<?php
require __DIR__ . '/vendor/autoload.php';
$app = require_once __DIR__ . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\ComplianceRequirementType;
use App\Models\User;
use Illuminate\Support\Facades\Storage;

$sao = User::where('role', 'SUPER_ADMIN')->orderBy('school_id')->first();
$year = AcademicYear::where('is_current', true)->first();
if ($year && $sao) {
    $sem = AcademicSemester::firstOrCreate(
        ['academic_year_id' => $year->id, 'number' => 1],
        [
            'starts_on' => $year->starts_on,
            'ends_on' => $year->starts_on->copy()->addMonths(4),
            'status' => 'active',
            'created_by' => $sao->school_id,
        ]
    );
    $sem->update(['status' => 'active']);

    $samplePdf = "%PDF-1.4\n1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>endobj\ntrailer<< /Root 1 0 R >>\n%%EOF";
    $path = 'compliance-requirement-templates/sample-requirement-format.pdf';
    Storage::disk('local')->put($path, $samplePdf);

    ComplianceRequirementType::where('academic_year', $year->label)->update([
        'academic_semester_id' => $sem->id,
        'template_path' => $path,
        'template_original_name' => 'Sample_Requirement_Format.pdf',
    ]);
}
echo "Full demo dataset with active semester ready!\n";
'@

    $tmpFile = Join-Path $PSScriptRoot "server\full_demo_post_seed.php"
    [System.IO.File]::WriteAllText($tmpFile, $phpCode)
    php $tmpFile
    Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "FULL DEMO DATASET IS ACTIVE!" -ForegroundColor Green
Write-Host "  - Sign-ins:          issued privately"
